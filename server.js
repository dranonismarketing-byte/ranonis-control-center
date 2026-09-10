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
const VALID_STATUSES = new Set(['inbox', 'cooking', 'waiting', 'done']);

const STATUS_MAP = {
  queued: 'inbox',
  in_progress: 'cooking',
  inbox: 'inbox',
  cooking: 'cooking',
  waiting: 'waiting',
  done: 'done',
};

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

function normalizeStatus(status) {
  const key = String(status || 'inbox').toLowerCase();
  return STATUS_MAP[key] || 'inbox';
}

function migrateTasksOnce() {
  if (!fs.existsSync(TASKS_FILE)) {
    writeJson(TASKS_FILE, { tasks: [], migratedAt: new Date().toISOString() });
    return;
  }
  const data = readJson(TASKS_FILE, { tasks: [] });
  if (data.migratedV2) return;

  const tasks = (data.tasks || [])
    .filter((t) => !t.example)
    .map((t) => {
      const status = normalizeStatus(t.status);
      return {
        id: t.id || uuidv4(),
        title: String(t.title || '').trim() || 'Untitled',
        brief: String(t.brief || '').trim(),
        clientId: CLIENT_IDS.has(t.clientId) ? t.clientId : 'my-plate',
        assignee: t.assignee ? String(t.assignee) : 'cos',
        status,
        result: t.result != null ? String(t.result) : '',
        resultLinks: Array.isArray(t.resultLinks) ? t.resultLinks.map(String) : [],
        progress: t.progress != null ? String(t.progress) : '',
        priority: t.priority || 'medium',
        createdAt: t.createdAt || new Date().toISOString(),
        updatedAt: t.updatedAt || t.createdAt || new Date().toISOString(),
        completedAt: status === 'done' ? (t.completedAt || t.updatedAt || new Date().toISOString()) : null,
      };
    });

  writeJson(TASKS_FILE, {
    tasks,
    migratedV2: true,
    migratedAt: new Date().toISOString(),
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

function ensureBootData() {
  migrateTasksOnce();
  migrateChatOnce();
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

router.post('/api/chat', requireUiAuth, (req, res) => {
  const text = String((req.body && req.body.text) || '').trim();
  if (!text) return res.status(400).json({ error: 'text required' });
  const key = chatThreadKey(req.body && req.body.clientId);
  const data = readChat();
  const thread = ensureThread(data, key);
  const msg = {
    id: uuidv4(),
    role: 'user',
    text,
    at: new Date().toISOString(),
    clientId: key,
  };
  thread.messages.push(msg);
  writeJson(CHAT_FILE, data);
  res.status(201).json(msg);
});

router.post('/api/chat/reply', requireApiAccess, (req, res) => {
  const text = String((req.body && req.body.text) || '').trim();
  if (!text) return res.status(400).json({ error: 'text required' });
  const key = chatThreadKey(req.body && req.body.clientId);
  const data = readChat();
  const thread = ensureThread(data, key);
  const msg = {
    id: uuidv4(),
    role: 'cos',
    text,
    at: new Date().toISOString(),
    clientId: key,
  };
  thread.messages.push(msg);
  writeJson(CHAT_FILE, data);
  res.status(201).json(msg);
});

router.get('/api/tasks', requireApiAccess, (req, res) => {
  const data = readTasks();
  let tasks = data.tasks || [];
  const status = req.query.status;
  const clientId = req.query.clientId;

  if (status) {
    const wanted = String(status)
      .split(',')
      .map((s) => normalizeStatus(s.trim()))
      .filter(Boolean);
    tasks = tasks.filter((t) => wanted.includes(normalizeStatus(t.status)));
  }

  if (clientId && clientId !== 'my-plate') {
    tasks = tasks.filter((t) => t.clientId === clientId);
  }

  res.json({ tasks });
});

router.post('/api/tasks', requireUiAuth, (req, res) => {
  const body = req.body || {};
  const title = String(body.title || '').trim();
  const brief = String(body.brief || '').trim();
  let clientId = String(body.clientId || '').trim();
  if (!title || !brief) return res.status(400).json({ error: 'title and brief required' });
  if (!clientId) return res.status(400).json({ error: 'clientId required' });
  if (!CLIENT_IDS.has(clientId)) {
    return res.status(400).json({ error: 'unknown clientId' });
  }

  let status = body.status != null ? normalizeStatus(body.status) : 'inbox';
  if (!VALID_STATUSES.has(status)) {
    return res.status(400).json({ error: 'status must be inbox|cooking|waiting|done' });
  }

  const assignee = body.assignee != null ? String(body.assignee).trim() || 'cos' : 'cos';
  const now = new Date().toISOString();
  const task = {
    id: uuidv4(),
    title,
    brief,
    clientId,
    assignee,
    status,
    result: '',
    resultLinks: [],
    progress: body.progress != null ? String(body.progress) : '',
    priority: body.priority ? String(body.priority).toLowerCase() : 'medium',
    createdAt: now,
    updatedAt: now,
    completedAt: status === 'done' ? now : null,
  };

  const data = readTasks();
  data.tasks.unshift(task);
  writeJson(TASKS_FILE, data);
  res.status(201).json(task);
});

router.patch('/api/tasks/:id', requireApiAccess, (req, res) => {
  const data = readTasks();
  const idx = data.tasks.findIndex((t) => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  const task = data.tasks[idx];
  const body = req.body || {};

  if (body.status !== undefined) {
    const status = normalizeStatus(body.status);
    if (!VALID_STATUSES.has(status)) {
      return res.status(400).json({ error: 'status must be inbox|cooking|waiting|done' });
    }
    task.status = status;
    if (status === 'done') task.completedAt = new Date().toISOString();
    if (status !== 'done') task.completedAt = null;
  }
  if (body.result !== undefined) task.result = String(body.result);
  if (body.resultLinks !== undefined) {
    task.resultLinks = Array.isArray(body.resultLinks)
      ? body.resultLinks.map(String)
      : [];
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

  task.updatedAt = new Date().toISOString();
  data.tasks[idx] = task;
  writeJson(TASKS_FILE, data);
  res.json(task);
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
  const status = body.status === 'inbox' ? 'inbox' : 'cooking';
  const assignee = body.assignee != null ? String(body.assignee).trim() || 'cos' : 'cos';
  const now = new Date().toISOString();

  const task = {
    id: uuidv4(),
    title,
    brief,
    clientId,
    assignee,
    status,
    result: '',
    resultLinks: [],
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

  res.status(201).json({ task, message: msg });
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
