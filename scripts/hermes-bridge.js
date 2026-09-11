'use strict';

/**
 * Host / compose sidecar: drains Control Centre cards with hermesStatus=pending_enqueue
 * by docker-exec into Hermes, then polls hermes kanban show to attach local output paths.
 *
 * Runs in the ranonis-control-center compose project only. Needs docker.sock.
 * Does NOT invent Drive links. Does NOT move cards to approve_statics (CoS QC does that).
 */

const hermes = require('../hermesStatic');

const CC_BASE = (process.env.CC_URL || 'http://control-centre:3080/control-centre').replace(/\/$/, '');
const TOKEN = process.env.CONTROL_CENTRE_TOKEN || '';
const POLL_SECONDS = Number(process.env.POLL_SECONDS || 30);

async function api(path, opts = {}) {
  const url = CC_BASE + path;
  const headers = Object.assign(
    { 'Content-Type': 'application/json', Accept: 'application/json' },
    opts.headers || {}
  );
  if (TOKEN) headers['X-Control-Token'] = TOKEN;
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(data.error || data.raw || res.statusText);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function drainPending() {
  const { tasks } = await api('/api/tasks?stage=static_production');
  const pending = (tasks || []).filter((t) => t.hermesStatus === 'pending_enqueue');
  for (const task of pending) {
    console.log('[bridge] enqueue', task.id, task.title);
    const result = hermes.enqueueHermesForTask(task, {
      mode: task.hermesMode || 'bakeoff',
      dispatch: true,
    });
    if (result.pending) {
      console.warn('[bridge] still pending (no docker?)', result.error);
      continue;
    }
    const patch = {
      hermesStatus: result.ok ? 'dispatched' : 'enqueue_failed',
      hermesMode: result.mode,
      hermes_task_ids: result.hermes_task_ids || [],
      hermesOutputPath: result.outputPath || '',
      hermesEnqueuedAt: new Date().toISOString(),
      hermesError: result.ok ? '' : JSON.stringify(result.errors || result.error || ''),
      progress: result.ok
        ? 'Making ad images (Hermes bakeoff running)'
        : 'Hermes enqueue failed — CoS to retry',
    };
    await api('/api/tasks/' + task.id, { method: 'PATCH', body: patch });
    console.log('[bridge] patched', task.id, patch.hermesStatus, patch.hermes_task_ids);
  }
}

async function pollDispatched() {
  const { tasks } = await api('/api/tasks?stage=static_production');
  const watching = (tasks || []).filter(
    (t) =>
      (t.hermesStatus === 'dispatched' || t.hermesStatus === 'running') &&
      Array.isArray(t.hermes_task_ids) &&
      t.hermes_task_ids.length
  );
  for (const task of watching) {
    const summaries = [];
    for (const id of task.hermes_task_ids) {
      const shown = hermes.showKanbanTask(id);
      if (shown.ok) summaries.push(hermes.summarizeHermesShow(shown.task));
      else summaries.push({ id, error: shown.error });
    }
    const localPaths = [
      ...new Set(summaries.flatMap((s) => (s && s.localPaths) || [])),
    ];
    const allDone = summaries.length && summaries.every((s) => s && s.completed);
    const anyBlocked = summaries.some((s) => s && s.blocked);
    const hermesStatus = allDone ? 'complete' : anyBlocked ? 'blocked' : 'running';
    const patch = {
      hermesStatus,
      hermesPollAt: new Date().toISOString(),
      hermesLocalOutputs: localPaths,
      hermesTaskSummaries: summaries,
    };
    if (allDone) {
      patch.progress = localPaths.length
        ? 'Hermes bakeoff done — local files ready for CoS QC'
        : 'Hermes bakeoff tasks done — waiting CoS to attach images';
    } else if (hermesStatus === 'running') {
      patch.progress = 'Making ad images (Hermes bakeoff running)';
    }
    await api('/api/tasks/' + task.id, { method: 'PATCH', body: patch });
    console.log('[bridge] poll', task.id, hermesStatus, 'paths=', localPaths.length);
  }
}

async function tick() {
  try {
    if (!hermes.dockerAvailable()) {
      console.warn('[bridge] docker not available yet');
      return;
    }
    await drainPending();
    await pollDispatched();
  } catch (err) {
    console.error('[bridge] tick error', err.message || err);
  }
}

console.log('[bridge] starting', { CC_BASE, POLL_SECONDS, container: process.env.HERMES_CONTAINER });
tick();
setInterval(tick, Math.max(10, POLL_SECONDS) * 1000);
