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

function ensureSeedData() {
  if (!fs.existsSync(CHAT_FILE)) {
    writeJson(CHAT_FILE, {
      messages: [
        {
          id: uuidv4(),
          role: 'cos',
          text: 'Control Centre is live. Chat here, delegate work, and check Cooking vs Results. I poll this queue on a short routine — not live token streaming.',
          at: new Date().toISOString(),
        },
      ],
    });
  }
  if (!fs.existsSync(TASKS_FILE)) {
    const now = new Date().toISOString();
    writeJson(TASKS_FILE, {
      tasks: [
        {
          id: uuidv4(),
          title: 'Possible Training — final five ad lines (example)',
          brief:
            'Ad factory pilot for Possible Training Train At Home Regulation. Research → craft → Judge kill/select. FPRO out. Static Meta. Deliver 5 launch-ready lines with picture sentences.',
          priority: 'high',
          status: 'done',
          result:
            'Example result (pilot 2026-09-10).\n\n1. House dribbling. No slam on the floor.\n2. Everyone says no gym needed. Almost nobody fixes the house ban.\n3. Quiet practice on a toy bounce is still fake practice.\n4. A few weeks in. You can see the handle change.\n5. Twenty minutes. You don\'t invent the drills.\n\nSource: ad-factory-brain / possible-training-regulation-20260910 / final_five.md',
          resultLinks: [],
          example: true,
          createdAt: now,
          updatedAt: now,
          completedAt: now,
        },
        {
          id: uuidv4(),
          title: 'Possible Training — house-ban creative brief (example)',
          brief:
            'Turn H1 into a static Meta creative brief: picture must match the line; kid dribbling indoors; parent calm; no hoop; mute claim readable in one second.',
          priority: 'medium',
          status: 'done',
          result:
            'Example brief locked: living-room / hallway wood floor, regulation ball, parent in frame not covering ears, no gym stock. Builder ≠ Judge. Send-gate: 9/10 = clear in one second.',
          resultLinks: [],
          example: true,
          createdAt: now,
          updatedAt: now,
          completedAt: now,
        },
      ],
    });
  }
}

ensureSeedData();

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

router.get('/api/chat', requireApiAccess, (_req, res) => {
  const data = readJson(CHAT_FILE, { messages: [] });
  res.json(data);
});

router.post('/api/chat', requireUiAuth, (req, res) => {
  const text = String((req.body && req.body.text) || '').trim();
  if (!text) return res.status(400).json({ error: 'text required' });
  const data = readJson(CHAT_FILE, { messages: [] });
  const msg = {
    id: uuidv4(),
    role: 'user',
    text,
    at: new Date().toISOString(),
  };
  data.messages.push(msg);
  writeJson(CHAT_FILE, data);
  res.status(201).json(msg);
});

router.post('/api/chat/reply', requireApiAccess, (req, res) => {
  const text = String((req.body && req.body.text) || '').trim();
  if (!text) return res.status(400).json({ error: 'text required' });
  const data = readJson(CHAT_FILE, { messages: [] });
  const msg = {
    id: uuidv4(),
    role: 'cos',
    text,
    at: new Date().toISOString(),
  };
  data.messages.push(msg);
  writeJson(CHAT_FILE, data);
  res.status(201).json(msg);
});

router.get('/api/tasks', requireApiAccess, (req, res) => {
  const data = readJson(TASKS_FILE, { tasks: [] });
  let tasks = data.tasks || [];
  const status = req.query.status;
  if (status) {
    const wanted = String(status)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    tasks = tasks.filter((t) => wanted.includes(t.status));
  }
  res.json({ tasks });
});

router.post('/api/tasks', requireUiAuth, (req, res) => {
  const title = String((req.body && req.body.title) || '').trim();
  const brief = String((req.body && req.body.brief) || '').trim();
  const priority = String((req.body && req.body.priority) || 'medium').toLowerCase();
  if (!title || !brief) return res.status(400).json({ error: 'title and brief required' });
  if (!['low', 'medium', 'high'].includes(priority)) {
    return res.status(400).json({ error: 'priority must be low|medium|high' });
  }
  const now = new Date().toISOString();
  const task = {
    id: uuidv4(),
    title,
    brief,
    priority,
    status: 'queued',
    result: '',
    resultLinks: [],
    example: false,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
  const data = readJson(TASKS_FILE, { tasks: [] });
  data.tasks.unshift(task);
  writeJson(TASKS_FILE, data);
  res.status(201).json(task);
});

router.patch('/api/tasks/:id', requireApiAccess, (req, res) => {
  const data = readJson(TASKS_FILE, { tasks: [] });
  const idx = data.tasks.findIndex((t) => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  const task = data.tasks[idx];
  const body = req.body || {};
  if (body.status !== undefined) {
    const status = String(body.status).toLowerCase();
    if (!['queued', 'in_progress', 'done'].includes(status)) {
      return res.status(400).json({ error: 'status must be queued|in_progress|done' });
    }
    task.status = status;
    if (status === 'done') task.completedAt = new Date().toISOString();
  }
  if (body.result !== undefined) task.result = String(body.result);
  if (body.resultLinks !== undefined) {
    task.resultLinks = Array.isArray(body.resultLinks)
      ? body.resultLinks.map(String)
      : [];
  }
  if (body.title !== undefined) task.title = String(body.title).trim();
  if (body.brief !== undefined) task.brief = String(body.brief).trim();
  if (body.priority !== undefined) {
    const priority = String(body.priority).toLowerCase();
    if (!['low', 'medium', 'high'].includes(priority)) {
      return res.status(400).json({ error: 'priority must be low|medium|high' });
    }
    task.priority = priority;
  }
  task.updatedAt = new Date().toISOString();
  data.tasks[idx] = task;
  writeJson(TASKS_FILE, data);
  res.json(task);
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
