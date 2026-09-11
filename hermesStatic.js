'use strict';

/**
 * Hermes static bakeoff enqueue for Control Centre.
 *
 * CHOICE (MVP): always BAKEOFF mode on copy approve → static_production.
 * Creates ONE kanban task per assignee:
 *   don-draper (control) + blade / press / scout / mixer / arena (challengers).
 * Production-only (don-draper alone) is reserved for a future hermesMode=production flag.
 *
 * Dispatch is NOT Web GPT / CoS ChatGPT. Tasks use skill meta-static-ad-production
 * and land under /opt/data/outputs/<client>/...
 *
 * Quiet-to-CoS: Hermes completion updates hermes* fields only. Card stays in
 * static_production (Cooking) until CoS QC promotes to approve_statics (Waiting).
 */

const { spawnSync } = require('child_process');

const BAKEOFF_ASSIGNEES = [
  'don-draper',
  'blade',
  'press',
  'scout',
  'mixer',
  'arena',
];

const SKILL = 'meta-static-ad-production';
const SWIPE_URLS = [
  'https://ads.nik.co/',
  'https://ranonisandpartners.com/team/swipe/',
];

const HERMES_CONTAINER =
  process.env.HERMES_CONTAINER || 'hermes-agent-57r8-hermes-agent-1';
const HERMES_DOCKER_BIN = process.env.HERMES_DOCKER_BIN || 'docker';
const OUTPUTS_ROOT = process.env.HERMES_OUTPUTS_ROOT || '/opt/data/outputs';

function clientSlug(clientId) {
  const id = String(clientId || 'other').trim().toLowerCase() || 'other';
  // FPRO is explicitly out of this path — still slug safely if mis-tagged.
  return id.replace(/[^a-z0-9_-]+/g, '-');
}

function extractLockedLines(task) {
  const blobs = [task.result, task.brief, task.title]
    .map((x) => (x == null ? '' : String(x)))
    .filter(Boolean);
  const text = blobs.join('\n\n');
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^\s*(?:\d+[.)]\s+|[-*]\s+)(.+?)\s*$/);
    if (m && m[1] && m[1].length > 2 && m[1].length < 160) {
      lines.push(m[1].trim());
    }
  }
  if (lines.length) return lines;
  // Fallback: treat non-empty result paragraphs as locked copy
  const para = String(task.result || '')
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l && !/^source lines/i.test(l) && !/^drop the/i.test(l) && !/^next:/i.test(l));
  return para.slice(0, 12);
}

function productTruth(task) {
  const brief = String(task.brief || '');
  const result = String(task.result || '');
  const hit = (brief + '\n' + result).match(/PRODUCT TRUTH[:\s]+([\s\S]{10,400}?)(?:\n\n|LOCKED|OUTPUT|REFERENCE|$)/i);
  if (hit) return hit[1].trim();
  if (/impossible-training|possible training|safebounce|train at home/i.test(brief + result + (task.clientId || ''))) {
    return 'Possible Training / SafeBounce: regulation-weight at-home ball training. Show real product truth; no fake logos; no invented claims beyond locked on-image lines.';
  }
  if (/phone-case/i.test(task.clientId || '')) {
    return 'Phone case brand: real case/product pixels; no fake drop claims beyond locked lines.';
  }
  return 'Use only product truth present in the Control Centre brief/result. Do not invent claims. No fake testimonials.';
}

function outputDir(task) {
  const slug = clientSlug(task.clientId);
  const stamp = new Date().toISOString().slice(0, 10);
  const short = String(task.id || 'task').slice(0, 8);
  return `${OUTPUTS_ROOT}/${slug}/cc-${short}-${stamp}`;
}

function buildTaskBody(task, assignee) {
  const lines = extractLockedLines(task);
  const lockedBlock = lines.length
    ? lines.map((l, i) => `${i + 1}. ${l}`).join('\n')
    : '(No numbered lines found — use the Control Centre result/brief verbatim; do not invent headlines.)';
  const out = outputDir(task);
  const client = clientSlug(task.clientId);
  const title = String(task.title || 'Static production').trim();

  return [
    `CONTROL CENTRE TASK: ${task.id}`,
    `CLIENT: ${client}`,
    `CC TITLE: ${title}`,
    `ASSIGNEE ROLE: ${assignee === 'don-draper' ? 'control (bakeoff lead)' : 'bakeoff challenger'}`,
    '',
    'LOCKED ON-IMAGE LINES (exact — do not rewrite):',
    lockedBlock,
    '',
    'PRODUCT TRUTH:',
    productTruth(task),
    '',
    'DUAL SWIPE (read-only inspiration — steal structure, not brand/copy):',
    `- ${SWIPE_URLS[0]}`,
    `- ${SWIPE_URLS[1]}`,
    '',
    'OUTPUT PATH (durable):',
    out,
    'Write finished PNG(s) under that directory (create if missing).',
    '',
    'DRIVE:',
    'If you can upload to the client Drive folder, do so and report the real https://drive.google.com link.',
    'If you cannot upload, leave Drive blank — do NOT invent placeholder Drive links.',
    '',
    'RULES:',
    '- Skill: meta-static-ad-production',
    '- Do NOT call the work "approved" — human OK on final ads happens later in Control Centre.',
    '- Do NOT use Web GPT / computerUse ChatGPT browser path from CoS.',
    '- FPRO is out of scope for this enqueue path.',
    '- Return MEDIA with absolute local path(s) in your task result when done.',
    '- Quiet to CoS: ship craft only; Donatas sees Waiting only after CoS QC.',
  ].join('\n');
}

function buildTaskTitle(task, assignee) {
  const client = clientSlug(task.clientId);
  const base = String(task.title || 'statics').trim().slice(0, 72);
  return `CC bakeoff [${assignee}] ${client}: ${base}`;
}

function assigneesForMode(mode) {
  // Default / bakeoff: control + five challengers. production: don-draper only.
  if (String(mode || 'bakeoff').toLowerCase() === 'production') {
    return ['don-draper'];
  }
  return BAKEOFF_ASSIGNEES.slice();
}

function dockerAvailable() {
  const r = spawnSync(HERMES_DOCKER_BIN, ['info'], {
    encoding: 'utf8',
    timeout: 8000,
  });
  return r.status === 0;
}

function hermesExec(args, opts = {}) {
  const dockerArgs = ['exec', HERMES_CONTAINER, 'hermes', ...args];
  const r = spawnSync(HERMES_DOCKER_BIN, dockerArgs, {
    encoding: 'utf8',
    timeout: opts.timeout || 60000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return {
    ok: r.status === 0,
    status: r.status,
    stdout: (r.stdout || '').trim(),
    stderr: (r.stderr || '').trim(),
  };
}

function createKanbanTask({ title, body, assignee, idempotencyKey, initialStatus }) {
  const args = [
    'kanban',
    'create',
    '--json',
    '--assignee',
    assignee,
    '--skill',
    SKILL,
    '--goal',
    '--body',
    body,
    '--idempotency-key',
    idempotencyKey,
    '--created-by',
    'control-centre',
  ];
  if (initialStatus) {
    args.push('--initial-status', initialStatus);
  }
  args.push(title);
  const r = hermesExec(args);
  if (!r.ok) {
    return { ok: false, error: r.stderr || r.stdout || 'hermes create failed', raw: r };
  }
  try {
    const parsed = JSON.parse(r.stdout);
    return { ok: true, id: parsed.id, task: parsed };
  } catch (err) {
    // Some CLI versions print non-JSON; try to scrape id
    const m = r.stdout.match(/t_[a-f0-9]+/i);
    if (m) return { ok: true, id: m[0], raw: r.stdout };
    return { ok: false, error: 'could not parse hermes create JSON', stdout: r.stdout };
  }
}

function dispatchKanban() {
  return hermesExec(['kanban', 'dispatch'], { timeout: 120000 });
}

function showKanbanTask(id) {
  const r = hermesExec(['kanban', 'show', '--json', String(id)]);
  if (!r.ok) return { ok: false, error: r.stderr || r.stdout };
  try {
    return { ok: true, task: JSON.parse(r.stdout) };
  } catch {
    return { ok: false, error: 'parse show failed', stdout: r.stdout };
  }
}

/**
 * Create bakeoff (or production) Hermes tasks for a CC card.
 * @param {object} task CC task
 * @param {{ dryRun?: boolean, initialStatus?: string, dispatch?: boolean, mode?: string }} options
 */
function enqueueHermesForTask(task, options = {}) {
  const mode = options.mode || task.hermesMode || 'bakeoff';
  const assignees = assigneesForMode(mode);
  const dryRun = !!options.dryRun;
  const initialStatus = options.initialStatus || null; // null = normal ready path
  const shouldDispatch = options.dispatch !== false && !dryRun && !initialStatus;

  if (!dryRun && !dockerAvailable()) {
    return {
      ok: false,
      pending: true,
      error: 'docker not available in this process — leave hermesStatus=pending_enqueue for bridge',
      assignees,
      mode,
    };
  }

  const created = [];
  const errors = [];
  const outPath = outputDir(task);

  for (const assignee of assignees) {
    const title = buildTaskTitle(task, assignee);
    const body = buildTaskBody(task, assignee);
    const idempotencyKey = `cc-${task.id}-${assignee}-v1`;
    if (dryRun) {
      created.push({
        assignee,
        title,
        idempotencyKey,
        bodyPreview: body.slice(0, 280) + '…',
      });
      continue;
    }
    const res = createKanbanTask({
      title,
      body,
      assignee,
      idempotencyKey,
      initialStatus,
    });
    if (res.ok) {
      created.push({
        id: res.id,
        assignee,
        title,
        status: (res.task && res.task.status) || initialStatus || 'todo',
      });
    } else {
      errors.push({ assignee, error: res.error });
    }
  }

  let dispatched = false;
  if (shouldDispatch && created.length && !errors.length) {
    const d = dispatchKanban();
    dispatched = d.ok;
    if (!d.ok) {
      errors.push({ assignee: '_dispatch', error: d.stderr || d.stdout || 'dispatch failed' });
    }
  }

  return {
    ok: errors.length === 0 && (dryRun || created.length > 0),
    dryRun,
    mode,
    assignees,
    outputPath: outPath,
    hermes_task_ids: created.map((c) => c.id).filter(Boolean),
    created,
    errors,
    dispatched,
  };
}

function summarizeHermesShow(showTask) {
  if (!showTask || typeof showTask !== 'object') return null;
  const status = String(showTask.status || '');
  const result = showTask.result != null ? String(showTask.result) : '';
  const paths = [];
  const mediaRe = /(?:MEDIA|path)[:\s]+(\/[^\s\n]+\.(?:png|jpg|jpeg|webp))/gi;
  let m;
  while ((m = mediaRe.exec(result))) paths.push(m[1]);
  const absRe = /(\/opt\/data\/[^\s\n]+\.(?:png|jpg|jpeg|webp))/gi;
  while ((m = absRe.exec(result))) paths.push(m[1]);
  const uniq = [...new Set(paths)];
  return {
    id: showTask.id,
    assignee: showTask.assignee,
    status,
    resultPreview: result.slice(0, 500),
    localPaths: uniq,
    completed: status === 'done' || status === 'completed',
    blocked: status === 'blocked',
  };
}

module.exports = {
  BAKEOFF_ASSIGNEES,
  SKILL,
  SWIPE_URLS,
  clientSlug,
  extractLockedLines,
  buildTaskBody,
  buildTaskTitle,
  assigneesForMode,
  dockerAvailable,
  enqueueHermesForTask,
  showKanbanTask,
  summarizeHermesShow,
  dispatchKanban,
  outputDir,
};
