'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');

const PORT = Number(process.env.PORT || 3080);
const BASE_PATH = (process.env.BASE_PATH || '/control-centre').replace(/\/$/, '') || '';
const PASSWORD = process.env.CONTROL_CENTRE_PASSWORD || 'change-me';
const CONTROL_TOKEN = process.env.CONTROL_CENTRE_TOKEN || 'change-me-token';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const CHAT_FILE = path.join(DATA_DIR, 'chat.json');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
const SESSION_COOKIE = 'cc_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const CLIENTS = [
  { id: 'my-plate', name: 'My plate', special: true },
  { id: 'bellalab-italy', name: 'BellaLab Italy' },
  { id: 'impossible-training', name: 'Impossible Training' },
  { id: 'dbo', name: 'DBO' },
  { id: 'nojus', name: 'Nojus' },
  { id: 'sodermas', name: 'Soderma' },
  { id: 'blesse', name: 'Blesse' },
  { id: 'gerybiu-ragas', name: 'Gerybiu ragas' },
  { id: 'phone-case', name: 'Phone case brand' },
  { id: 'lab', name: 'Lab experiment' },
  { id: 'ad-factory', name: 'Ad factory' },
  { id: 'other', name: 'Other / internal' },
];

const CLIENT_IDS = new Set(CLIENTS.map((c) => c.id));

const PIPELINE_STAGES = [
  'research',
  'copywriting',
  'approve_copy',
  'static_production',
  'approve_statics',
  'drive_upload',
  'done',
];
const VALID_STAGES = new Set(PIPELINE_STAGES);

/** Legacy Kanban status → pipeline stage */
const STATUS_TO_STAGE = {
  queued: 'research',
  inbox: 'research',
  in_progress: 'copywriting',
  cooking: 'copywriting',
  waiting: 'approve_copy',
  done: 'done',
};

/** Soft reverse map: pipeline stage → Home/client Kanban column (see UX-LAYOUT.md) */
const STAGE_TO_STATUS = {
  research: 'inbox',
  copywriting: 'cooking',
  approve_copy: 'waiting',
  static_production: 'cooking',
  approve_statics: 'waiting',
  drive_upload: 'cooking',
  done: 'done',
};

const KANBAN_COLUMNS = ['inbox', 'cooking', 'waiting', 'done'];

fs.mkdirSync(DATA_DIR, { recursive: true });

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

function normalizeStage(raw, fallbackStatus) {
  if (raw != null && String(raw).trim()) {
    const key = String(raw).trim().toLowerCase();
    if (VALID_STAGES.has(key)) return key;
    if (STATUS_TO_STAGE[key]) return STATUS_TO_STAGE[key];
  }
  if (fallbackStatus != null) {
    const s = String(fallbackStatus).trim().toLowerCase();
    if (VALID_STAGES.has(s)) return s;
    if (STATUS_TO_STAGE[s]) return STATUS_TO_STAGE[s];
  }
  return 'research';
}

function statusFromStage(stage) {
  return STAGE_TO_STATUS[stage] || 'inbox';
}

function normalizeImageEntry(raw, idx) {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const url = String(raw).trim();
    if (!url) return null;
    return { id: 'img-' + idx + '-' + url.slice(0, 24), url, status: 'pending', note: '' };
  }
  if (typeof raw === 'object') {
    const url = String(raw.url || raw.href || '').trim();
    if (!url) return null;
    const status = ['approved', 'rejected', 'pending'].includes(raw.status) ? raw.status : 'pending';
    return {
      id: String(raw.id || ('img-' + idx)),
      url,
      status,
      note: raw.note != null ? String(raw.note) : '',
    };
  }
  return null;
}

function normalizeImages(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  list.forEach((raw, idx) => {
    const entry = normalizeImageEntry(raw, idx);
    if (entry) out.push(entry);
  });
  return out;
}

function publicTask(t) {
  const stage = normalizeStage(t.stage, t.status);
  return {
    ...t,
    stage,
    status: statusFromStage(stage),
    resultLinks: Array.isArray(t.resultLinks) ? t.resultLinks.map(String) : [],
    images: normalizeImages(t.images),
    driveUrl: t.driveUrl != null ? String(t.driveUrl) : '',
  };
}

function migrateTasksOnce() {
  if (!fs.existsSync(TASKS_FILE)) {
    writeJson(TASKS_FILE, { tasks: [], migratedV2: true, migratedPipeline: true, migratedAt: new Date().toISOString() });
    return;
  }
  const data = readJson(TASKS_FILE, { tasks: [] });

  if (!data.migratedV2) {
    const tasks = (data.tasks || [])
      .filter((t) => !t.example)
      .map((t) => {
        const stage = normalizeStage(t.stage, t.status);
        return {
          id: t.id || uuidv4(),
          title: String(t.title || '').trim() || 'Untitled',
          brief: String(t.brief || '').trim(),
          clientId: CLIENT_IDS.has(t.clientId) ? t.clientId : 'my-plate',
          assignee: t.assignee ? String(t.assignee) : 'cos',
          stage,
          status: statusFromStage(stage),
          result: t.result != null ? String(t.result) : '',
          resultLinks: Array.isArray(t.resultLinks) ? t.resultLinks.map(String) : [],
          progress: t.progress != null ? String(t.progress) : '',
          priority: t.priority || 'medium',
          createdAt: t.createdAt || new Date().toISOString(),
          updatedAt: t.updatedAt || t.createdAt || new Date().toISOString(),
          completedAt: stage === 'done' ? (t.completedAt || t.updatedAt || new Date().toISOString()) : null,
        };
      });

    writeJson(TASKS_FILE, {
      tasks,
      migratedV2: true,
      migratedPipeline: true,
      migratedAt: new Date().toISOString(),
    });
    return;
  }

  if (data.migratedPipeline) return;

  const tasks = (data.tasks || []).map((t) => {
    const stage = normalizeStage(t.stage, t.status);
    return {
      ...t,
      stage,
      status: statusFromStage(stage),
      completedAt: stage === 'done' ? (t.completedAt || t.updatedAt || new Date().toISOString()) : null,
    };
  });

  writeJson(TASKS_FILE, {
    ...data,
    tasks,
    migratedPipeline: true,
    migratedPipelineAt: new Date().toISOString(),
  });
}

function migrateChatOnce() {
  const welcome =
    'Pick a client on the left, or chat here to put something on your plate.';

  if (!fs.existsSync(CHAT_FILE)) {
    writeJson(CHAT_FILE, {
      threads: {
        cos: {
          messages: [
            {
              id: uuidv4(),
              role: 'cos',
              text: welcome,
              at: new Date().toISOString(),
            },
          ],
        },
      },
      migratedV2: true,
    });
    return;
  }

  const data = readJson(CHAT_FILE, {});
  if (data.migratedV2 && data.threads) return;

  const threads = data.threads && typeof data.threads === 'object' ? { ...data.threads } : {};

  if (Array.isArray(data.messages) && data.messages.length) {
    if (!threads.cos) threads.cos = { messages: [] };
    for (const m of data.messages) {
      threads.cos.messages.push({
        id: m.id || uuidv4(),
        role: m.role === 'cos' ? 'cos' : 'user',
        text: String(m.text || ''),
        at: m.at || new Date().toISOString(),
        clientId: m.clientId || 'cos',
      });
    }
  }

  if (!threads.cos) threads.cos = { messages: [] };
  if (!threads.cos.messages.length) {
    threads.cos.messages.push({
      id: uuidv4(),
      role: 'cos',
      text: welcome,
      at: new Date().toISOString(),
    });
  }

  for (const key of Object.keys(threads)) {
    if (!threads[key] || !Array.isArray(threads[key].messages)) {
      threads[key] = { messages: [] };
    }
  }

  writeJson(CHAT_FILE, { threads, migratedV2: true });
}


const LOCKED_PT_LINES_ID = 'locked-pt-house-lines-20260910';

function ensureLockedBoardCards() {
  const taskData = readJson(TASKS_FILE, { tasks: [] });
  const tasks = taskData.tasks || [];
  if (!tasks.some((t) => t.id === LOCKED_PT_LINES_ID)) {
    const now = new Date().toISOString();
    const result = [
      'Possible Training house-permission lines (for the ad image).',
      'Angle: want indoor handle reps; real ball banned for noise.',
      '',
      '1. Not in the house. Until now.',
      '2. Indoor dribbles. No floor fight.',
      '3. Quiet enough for hardwood.',
      '4. Handle reps the house allows.',
      '5. Real bounce. Neighbor-safe.',
      '6. Practice inside. Keep the peace.',
      '7. The ban was the bounce.',
      '8. Hallway handles. No slam.',
      '9. Loud ball stays outside.',
      '10. Unlock indoor handle work.',
      '',
      'Next: make 10 ad images, then OK them here.',
    ].join('\n');
    tasks.unshift({
      id: LOCKED_PT_LINES_ID,
      title: 'PT house-permission — 10 ad lines (need your OK)',
      brief:
        'House-permission angle for Possible Training Train At Home Regulation. Short Obvi/IM8-style on-image lines. Research locked. Synced from CoS chat 2026-09-10.',
      clientId: 'impossible-training',
      assignee: 'cos',
      priority: 'high',
      stage: 'approve_copy',
      status: 'waiting',
      progress: 'Lines ready with Donatas. Needs your OK on copy, then 10 ad images.',
      result,
      resultLinks: [],
      example: false,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    });
    taskData.tasks = tasks;
    writeJson(TASKS_FILE, taskData);
  } else {
    // Ensure existing locked card has pipeline stage
    const idx = tasks.findIndex((t) => t.id === LOCKED_PT_LINES_ID);
    if (idx >= 0) {
      const t = tasks[idx];
      if (!t.stage || !VALID_STAGES.has(t.stage)) {
        t.stage = normalizeStage(t.stage, t.status || 'waiting');
        t.status = statusFromStage(t.stage);
        taskData.tasks = tasks;
        writeJson(TASKS_FILE, taskData);
      }
    }
  }

  const chatData = readJson(CHAT_FILE, { threads: {} });
  if (!chatData.threads) chatData.threads = {};
  const note =
    'Board note: 10 PT house-permission ad lines are on Impossible Training and need your OK on copy. Send a chat message anytime — I reply when free.';
  for (const key of ['cos', 'impossible-training']) {
    if (!chatData.threads[key] || !Array.isArray(chatData.threads[key].messages)) {
      chatData.threads[key] = { messages: [] };
    }
    const msgs = chatData.threads[key].messages;
    if (!msgs.some((m) => m.syncNote === LOCKED_PT_LINES_ID)) {
      msgs.push({
        id: uuidv4(),
        role: 'cos',
        text: note,
        at: new Date().toISOString(),
        clientId: key,
        syncNote: LOCKED_PT_LINES_ID,
      });
    }
  }
  writeJson(CHAT_FILE, chatData);
}

function ensureBootData() {
  migrateTasksOnce();
  migrateChatOnce();
  ensureLockedBoardCards();
}

ensureBootData();

const sessions = new Map();

function issueSession() {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

function sessionValid(token) {
  if (!token) return false;
  const exp = sessions.get(token);
  if (!exp) return false;
  if (Date.now() > exp) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function isLocalhost(req) {
  const ip = req.ip || '';
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1' ||
    req.hostname === 'localhost'
  );
}

function hasControlToken(req) {
  const header = req.get('x-control-token') || '';
  return header && header === CONTROL_TOKEN;
}

function requireUiAuth(req, res, next) {
  if (sessionValid(req.cookies[SESSION_COOKIE])) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return res.redirect(`${BASE_PATH}/login`);
}

function requireApiAccess(req, res, next) {
  if (sessionValid(req.cookies[SESSION_COOKIE])) return next();
  if (hasControlToken(req)) return next();
  if (isLocalhost(req)) return next();
  return res.status(401).json({ error: 'Unauthorized — need session, X-Control-Token, or localhost' });
}

function chatThreadKey(clientId) {
  if (!clientId || clientId === 'my-plate' || clientId === 'cos') return 'cos';
  return String(clientId);
}

function readChat() {
  const data = readJson(CHAT_FILE, { threads: { cos: { messages: [] } } });
  if (!data.threads) data.threads = { cos: { messages: [] } };
  if (!data.threads.cos) data.threads.cos = { messages: [] };
  return data;
}

function ensureThread(data, key) {
  if (!data.threads[key]) data.threads[key] = { messages: [] };
  if (!Array.isArray(data.threads[key].messages)) data.threads[key].messages = [];
  return data.threads[key];
}

function readTasks() {
  const data = readJson(TASKS_FILE, { tasks: [] });
  if (!Array.isArray(data.tasks)) data.tasks = [];
  return data;
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

const router = express.Router();

router.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'ranonis-control-center',
    basePath: BASE_PATH || '/',
    stages: PIPELINE_STAGES,
    columns: KANBAN_COLUMNS,
    time: new Date().toISOString(),
  });
});

router.get('/login', (req, res) => {
  if (sessionValid(req.cookies[SESSION_COOKIE])) {
    return res.redirect(`${BASE_PATH}/`);
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

router.post('/api/login', (req, res) => {
  const password = (req.body && req.body.password) || '';
  if (password !== PASSWORD) {
    return res.status(401).json({ error: 'Wrong password' });
  }
  const token = issueSession();
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_TTL_MS,
    path: BASE_PATH || '/',
  });
  res.json({ ok: true });
});

router.post('/api/logout', (req, res) => {
  const token = req.cookies[SESSION_COOKIE];
  if (token) sessions.delete(token);
  res.clearCookie(SESSION_COOKIE, { path: BASE_PATH || '/' });
  res.json({ ok: true });
});

router.get('/api/clients', requireApiAccess, (_req, res) => {
  res.json({ clients: CLIENTS });
});

router.get('/api/chat', requireApiAccess, (req, res) => {
  const key = chatThreadKey(req.query.clientId);
  const data = readChat();
  const thread = ensureThread(data, key);
  res.json({ clientId: key, messages: thread.messages });
});

router.post('/api/chat', requireApiAccess, (req, res) => {
  const text = String((req.body && req.body.text) || '').trim();
  if (!text) return res.status(400).json({ error: 'text required' });
  const key = chatThreadKey(req.body && req.body.clientId);
  const data = readChat();
  const thread = ensureThread(data, key);
  const now = new Date().toISOString();
  const msg = {
    id: uuidv4(),
    role: 'user',
    text,
    at: now,
    clientId: key,
    awaitingCos: true,
  };
  thread.messages.push(msg);
  // Clear status bubble — honest waiting state, not a fake CoS answer
  thread.messages.push({
    id: uuidv4(),
    role: 'status',
    text: 'Sent — waiting for a reply',
    at: now,
    clientId: key,
    forMessageId: msg.id,
  });
  writeJson(CHAT_FILE, data);
  res.status(201).json({ message: msg, messages: thread.messages });
});

/** Unanswered user messages for CoS / Grok Bot to poll and reply to */
router.get('/api/chat/pending', requireApiAccess, (_req, res) => {
  const data = readChat();
  const pending = [];
  for (const [threadId, thread] of Object.entries(data.threads || {})) {
    const msgs = Array.isArray(thread.messages) ? thread.messages : [];
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      if (!m || m.role !== 'user') continue;
      const later = msgs.slice(i + 1);
      const answered = later.some(
        (x) => x && x.role === 'cos' && !x.autoAck && !x.status
      );
      if (!answered) {
        pending.push({
          id: m.id,
          text: m.text,
          at: m.at,
          clientId: threadId,
          threadId,
        });
      }
    }
  }
  pending.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  res.json({ pending });
});

router.post('/api/chat/reply', requireApiAccess, (req, res) => {
  const text = String((req.body && req.body.text) || '').trim();
  if (!text) return res.status(400).json({ error: 'text required' });
  const key = chatThreadKey(req.body && req.body.clientId);
  const data = readChat();
  const thread = ensureThread(data, key);
  const replyToId = req.body && req.body.replyToId ? String(req.body.replyToId) : null;

  // Mark unanswered user msgs as answered; drop "waiting" status bubbles
  thread.messages = thread.messages.filter((m) => {
    if (m && m.role === 'status' && String(m.text || '').startsWith('Sent')) {
      if (!replyToId || m.forMessageId === replyToId) return false;
    }
    return true;
  });
  for (const m of thread.messages) {
    if (m.role !== 'user') continue;
    if (replyToId && m.id !== replyToId) continue;
    if (m.awaitingCos) m.awaitingCos = false;
  }

  const msg = {
    id: uuidv4(),
    role: 'cos',
    text,
    at: new Date().toISOString(),
    clientId: key,
    replyToId: replyToId || undefined,
  };
  thread.messages.push(msg);
  writeJson(CHAT_FILE, data);
  res.status(201).json(msg);
});

router.get('/api/tasks', requireApiAccess, (req, res) => {
  const data = readTasks();
  let tasks = (data.tasks || []).map(publicTask);
  const stage = req.query.stage;
  const status = req.query.status;
  const clientId = req.query.clientId;

  if (stage) {
    const wanted = String(stage)
      .split(',')
      .map((s) => normalizeStage(s.trim()))
      .filter(Boolean);
    tasks = tasks.filter((t) => wanted.includes(t.stage));
  } else if (status) {
    // Legacy filter: expand old Kanban status to all stages that reverse-map to it
    const wantedStatuses = String(status)
      .split(',')
      .map((s) => String(s).trim().toLowerCase())
      .filter(Boolean)
      .map((s) => STATUS_TO_STAGE[s] ? statusFromStage(STATUS_TO_STAGE[s]) : (STAGE_TO_STATUS[s] || s));
    tasks = tasks.filter((t) => wantedStatuses.includes(t.status) || wantedStatuses.includes(statusFromStage(t.stage)));
  }

  if (clientId && clientId !== 'my-plate') {
    tasks = tasks.filter((t) => t.clientId === clientId);
  }

  res.json({ tasks, stages: PIPELINE_STAGES });
});

router.post('/api/tasks', requireApiAccess, (req, res) => {
  const body = req.body || {};
  const title = String(body.title || '').trim();
  const brief = String(body.brief || '').trim();
  let clientId = String(body.clientId || '').trim();
  if (!title || !brief) return res.status(400).json({ error: 'title and brief required' });
  if (!clientId) return res.status(400).json({ error: 'clientId required' });
  if (!CLIENT_IDS.has(clientId)) {
    return res.status(400).json({ error: 'unknown clientId' });
  }

  let stage = 'research';
  if (body.stage != null) {
    stage = normalizeStage(body.stage);
  } else if (body.status != null) {
    stage = normalizeStage(null, body.status);
  }
  if (!VALID_STAGES.has(stage)) {
    return res.status(400).json({
      error: 'stage must be ' + PIPELINE_STAGES.join('|'),
    });
  }

  const assignee = body.assignee != null ? String(body.assignee).trim() || 'cos' : 'cos';
  const now = new Date().toISOString();
  const task = {
    id: uuidv4(),
    title,
    brief,
    clientId,
    assignee,
    stage,
    status: statusFromStage(stage),
    result: '',
    resultLinks: Array.isArray(body.resultLinks) ? body.resultLinks.map(String) : [],
    images: normalizeImages(body.images),
    driveUrl: body.driveUrl != null ? String(body.driveUrl).trim() : '',
    progress: body.progress != null ? String(body.progress) : '',
    priority: body.priority ? String(body.priority).toLowerCase() : 'medium',
    createdAt: now,
    updatedAt: now,
    completedAt: stage === 'done' ? now : null,
  };

  const data = readTasks();
  data.tasks.unshift(task);
  writeJson(TASKS_FILE, data);
  res.status(201).json(publicTask(task));
});

router.patch('/api/tasks/:id', requireApiAccess, (req, res) => {
  const data = readTasks();
  const idx = data.tasks.findIndex((t) => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  const task = data.tasks[idx];
  const body = req.body || {};

  if (body.stage !== undefined) {
    const stage = normalizeStage(body.stage);
    if (!VALID_STAGES.has(stage)) {
      return res.status(400).json({
        error: 'stage must be ' + PIPELINE_STAGES.join('|'),
      });
    }
    task.stage = stage;
    task.status = statusFromStage(stage);
    if (stage === 'done') task.completedAt = new Date().toISOString();
    else task.completedAt = null;
  } else if (body.status !== undefined) {
    // Legacy: accept status and map to stage
    const stage = normalizeStage(null, body.status);
    if (!VALID_STAGES.has(stage)) {
      return res.status(400).json({ error: 'invalid status/stage' });
    }
    task.stage = stage;
    task.status = statusFromStage(stage);
    if (stage === 'done') task.completedAt = new Date().toISOString();
    else task.completedAt = null;
  }

  if (body.result !== undefined) task.result = String(body.result);
  if (body.resultLinks !== undefined) {
    task.resultLinks = Array.isArray(body.resultLinks)
      ? body.resultLinks.map(String)
      : [];
  }
  if (body.images !== undefined) {
    task.images = normalizeImages(body.images);
  }
  if (body.driveUrl !== undefined) {
    task.driveUrl = String(body.driveUrl || '').trim();
  }
  if (body.title !== undefined) task.title = String(body.title).trim();
  if (body.brief !== undefined) task.brief = String(body.brief).trim();
  if (body.clientId !== undefined) {
    const clientId = String(body.clientId).trim();
    if (!CLIENT_IDS.has(clientId)) {
      return res.status(400).json({ error: 'unknown clientId' });
    }
    task.clientId = clientId;
  }
  if (body.assignee !== undefined) {
    task.assignee = String(body.assignee).trim() || 'cos';
  }
  if (body.progress !== undefined) {
    task.progress = String(body.progress);
  }
  if (body.priority !== undefined) {
    task.priority = String(body.priority).toLowerCase();
  }

  // Ensure stage always present
  task.stage = normalizeStage(task.stage, task.status);
  task.status = statusFromStage(task.stage);

  task.updatedAt = new Date().toISOString();
  data.tasks[idx] = task;
  writeJson(TASKS_FILE, data);
  res.json(publicTask(task));
});

router.delete('/api/tasks/:id', requireApiAccess, (req, res) => {
  const data = readTasks();
  const idx = data.tasks.findIndex((t) => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  const [removed] = data.tasks.splice(idx, 1);
  writeJson(TASKS_FILE, data);
  res.json({ ok: true, deleted: publicTask(removed) });
});

router.post('/api/delegate', requireUiAuth, (req, res) => {
  const body = req.body || {};
  const text = String(body.text || body.brief || '').trim();
  let clientId = String(body.clientId || '').trim();
  if (!text) return res.status(400).json({ error: 'text required' });
  if (!clientId) return res.status(400).json({ error: 'clientId required' });
  if (!CLIENT_IDS.has(clientId)) {
    return res.status(400).json({ error: 'unknown clientId' });
  }

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const title =
    String(body.title || '').trim() ||
    (lines[0] ? lines[0].slice(0, 120) : 'Delegated task');
  const brief = text;

  let stage = 'copywriting';
  if (body.stage != null) {
    stage = normalizeStage(body.stage);
  } else if (body.status === 'inbox') {
    stage = 'research';
  } else if (body.status != null) {
    stage = normalizeStage(null, body.status);
  }
  if (!VALID_STAGES.has(stage)) stage = 'copywriting';

  const assignee = body.assignee != null ? String(body.assignee).trim() || 'cos' : 'cos';
  const now = new Date().toISOString();

  const task = {
    id: uuidv4(),
    title,
    brief,
    clientId,
    assignee,
    stage,
    status: statusFromStage(stage),
    result: '',
    resultLinks: [],
    images: [],
    driveUrl: '',
    progress: '',
    priority: 'medium',
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };

  const tasksData = readTasks();
  tasksData.tasks.unshift(task);
  writeJson(TASKS_FILE, tasksData);

  const chatKey = chatThreadKey(clientId);
  const chatData = readChat();
  const thread = ensureThread(chatData, chatKey);
  const msg = {
    id: uuidv4(),
    role: 'user',
    text,
    at: now,
    clientId: chatKey,
    delegatedTaskId: task.id,
  };
  thread.messages.push(msg);
  writeJson(CHAT_FILE, chatData);

  res.status(201).json({ task: publicTask(task), message: msg });
});

// Static assets (css/js) are public; HTML shell stays behind the password gate.
router.use(express.static(path.join(__dirname, 'public'), { index: false }));
router.get('/', requireUiAuth, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(BASE_PATH, router);

if (!BASE_PATH) {
  app.get('/', (_req, res) => res.redirect('/control-centre/'));
} else {
  app.get('/', (_req, res) => res.redirect(`${BASE_PATH}/`));
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`ranonis-control-center listening on :${PORT}${BASE_PATH || ''}`);
});
