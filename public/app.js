(() => {
  const BASE = window.__CC_BASE__ || (() => {
    const path = location.pathname.replace(/\/$/, '');
    if (path.endsWith('/control-centre')) return path;
    const idx = path.lastIndexOf('/control-centre');
    if (idx >= 0) return path.slice(0, idx + '/control-centre'.length);
    return '/control-centre';
  })();

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const PIPELINE_STAGES = [
    'research',
    'copywriting',
    'approve_copy',
    'static_production',
    'approve_statics',
    'drive_upload',
    'done',
  ];

  const STAGE_LABELS = {
    research: 'Research',
    copywriting: 'Copywriting',
    approve_copy: 'Approve copy',
    static_production: 'Static production',
    approve_statics: 'Approve statics',
    drive_upload: 'Drive upload',
    done: 'Done',
  };

  const HUMAN_STAGES = new Set(['approve_copy', 'approve_statics']);

  const STATUS_TO_STAGE = {
    queued: 'research',
    inbox: 'research',
    in_progress: 'copywriting',
    cooking: 'copywriting',
    waiting: 'approve_copy',
    done: 'done',
  };

  const state = {
    clients: [],
    tasks: [],
    messages: [],
    currentClientId: 'my-plate',
    taskById: new Map(),
    currentTaskId: null,
    pendingDeleteId: null,
  };

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmt(iso) {
    try {
      return new Date(iso).toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return iso || '';
    }
  }

  function preview(text, n = 140) {
    const t = String(text || '').trim();
    if (t.length <= n) return t;
    return t.slice(0, n - 1) + '…';
  }

  function normalizeStage(t) {
    if (t && t.stage && STAGE_LABELS[t.stage]) return t.stage;
    if (t && t.status && STATUS_TO_STAGE[t.status]) return STATUS_TO_STAGE[t.status];
    if (t && t.status && STAGE_LABELS[t.status]) return t.status;
    return 'research';
  }

  function stageLabel(stage) {
    return STAGE_LABELS[stage] || stage;
  }

  function clientName(id) {
    const c = state.clients.find((x) => x.id === id);
    return c ? c.name : id;
  }

  function chatClientId() {
    return state.currentClientId === 'my-plate' ? 'cos' : state.currentClientId;
  }

  async function api(path, opts = {}) {
    const res = await fetch(BASE + path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      ...opts,
    });
    if (res.status === 401 && !path.includes('/login')) {
      location.href = BASE + '/login';
      throw new Error('Unauthorized');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }

  function activeCountFor(clientId) {
    return state.tasks.filter((t) => {
      const stage = normalizeStage(t);
      if (stage === 'done') return false;
      if (clientId === 'my-plate') return true;
      return t.clientId === clientId;
    }).length;
  }

  function visibleTasks() {
    if (state.currentClientId === 'my-plate') return state.tasks.slice();
    return state.tasks.filter((t) => t.clientId === state.currentClientId);
  }

  function needsYouTasks() {
    return visibleTasks().filter((t) => HUMAN_STAGES.has(normalizeStage(t)));
  }

  function renderNav() {
    const nav = $('#client-nav');
    nav.innerHTML = state.clients.map((c) => {
      const count = activeCountFor(c.id);
      const active = c.id === state.currentClientId ? 'active' : '';
      return `<button type="button" class="client-item ${active}" data-client="${esc(c.id)}">
        <span class="nav-label">${esc(c.name)}</span>
        <span class="badge-count" data-empty="${count ? '0' : '1'}">${count || ''}</span>
      </button>`;
    }).join('');

    nav.querySelectorAll('[data-client]').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectClient(btn.dataset.client);
      });
    });
  }

  function selectClient(id) {
    state.currentClientId = id;
    $('#board-title').textContent = clientName(id);
    $('#board-eyebrow').textContent = id === 'my-plate' ? 'Home' : 'Client';
    $('#chat-title').textContent = id === 'my-plate' ? 'CoS chat' : 'Delegate chat';
    $('#chat-sub').textContent = clientName(id);
    renderNav();
    renderBoard();
    loadChat().catch(() => {});
  }

  function stageChipClass(stage) {
    if (HUMAN_STAGES.has(stage)) return 'chip stage human';
    if (stage === 'done') return 'chip stage done';
    return 'chip stage';
  }

  function taskCard(t, opts = {}) {
    const stage = normalizeStage(t);
    const progress = t.progress
      ? `<div class="progress">${esc(preview(t.progress, 100))}</div>`
      : '';
    const showResult = t.result && (HUMAN_STAGES.has(stage) || stage === 'done');
    const result = showResult
      ? `<div class="result-preview">${esc(preview(t.result, 160))}</div>`
      : '';
    const compact = opts.compact ? ' compact' : '';
    const deleteBtn = opts.showDelete
      ? `<button type="button" class="card-delete" data-delete-id="${esc(t.id)}" title="Delete" aria-label="Delete">✕</button>`
      : '';
    return `<div class="card-wrap${compact}">
      <button type="button" class="card" data-task-id="${esc(t.id)}">
        <div class="card-meta">
          <span class="${stageChipClass(stage)}">${esc(stageLabel(stage))}</span>
          <span class="chip assignee">${esc(t.assignee || 'cos')}</span>
          ${t.clientId && state.currentClientId === 'my-plate' && t.clientId !== 'my-plate'
            ? `<span class="chip">${esc(clientName(t.clientId))}</span>` : ''}
        </div>
        <h3>${esc(t.title)}</h3>
        <p class="brief">${esc(preview(t.brief, 160))}</p>
        ${progress}
        ${result}
      </button>
      ${deleteBtn}
    </div>`;
  }

  function renderPipelineViz(tasks) {
    const counts = {};
    for (const s of PIPELINE_STAGES) counts[s] = 0;
    for (const t of tasks) {
      const s = normalizeStage(t);
      if (counts[s] != null) counts[s] += 1;
      else counts.research += 1;
    }

    const flow = $('#pipeline-flow');
    flow.innerHTML = PIPELINE_STAGES.map((s, i) => {
      const human = HUMAN_STAGES.has(s) ? ' human' : '';
      const done = s === 'done' ? ' done' : '';
      const has = counts[s] > 0 ? ' has-tasks' : '';
      const arrow = i < PIPELINE_STAGES.length - 1
        ? '<span class="pipe-arrow" aria-hidden="true">→</span>'
        : '';
      return `<div class="pipe-step${human}${done}${has}" data-stage="${esc(s)}">
        <span class="pipe-count">${counts[s]}</span>
        <span class="pipe-label">${esc(stageLabel(s))}</span>
      </div>${arrow}`;
    }).join('');
  }

  function bindCardEvents(root) {
    (root || document).querySelectorAll('.card[data-task-id]').forEach((btn) => {
      btn.addEventListener('click', () => openTask(btn.dataset.taskId));
    });
    (root || document).querySelectorAll('[data-delete-id]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openDeleteConfirm(btn.dataset.deleteId);
      });
    });
  }

  function renderBoard() {
    const tasks = visibleTasks();
    const needs = needsYouTasks();

    const needsSection = $('#needs-you');
    const needsList = $('#needs-you-list');
    $('#needs-you-count').textContent = String(needs.length);
    if (!needs.length) {
      needsSection.hidden = true;
      needsList.innerHTML = '';
    } else {
      needsSection.hidden = false;
      needsList.innerHTML = needs.map((t) => taskCard(t, { compact: true, showDelete: true })).join('');
    }

    renderPipelineViz(tasks);

    const sorted = tasks.slice().sort((a, b) => {
      const ia = PIPELINE_STAGES.indexOf(normalizeStage(a));
      const ib = PIPELINE_STAGES.indexOf(normalizeStage(b));
      if (ia !== ib) return ia - ib;
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    });

    $('#task-list-count').textContent = String(sorted.length);
    const list = $('#task-list');
    if (!sorted.length) {
      list.innerHTML = '<div class="empty-slot">Nothing on this plate yet. Delegate something.</div>';
    } else {
      list.innerHTML = sorted.map((t) => taskCard(t, { showDelete: true })).join('');
    }

    bindCardEvents(document);
  }

  function renderChat(messages) {
    const chatList = $('#chat-list');
    if (!messages.length) {
      chatList.innerHTML = '<div class="empty-slot">No messages yet.</div>';
      return;
    }
    chatList.innerHTML = messages.map((m) => {
      const who = m.role === 'cos' ? 'CoS' : 'You';
      return `<article class="bubble ${esc(m.role)}"><span class="meta">${esc(who)} · ${esc(fmt(m.at))}</span>${esc(m.text)}</article>`;
    }).join('');
    chatList.scrollTop = chatList.scrollHeight;
  }

  function renderModalStageTrack(current) {
    const el = $('#modal-stage-track');
    const idx = PIPELINE_STAGES.indexOf(current);
    el.innerHTML = PIPELINE_STAGES.map((s, i) => {
      let cls = 'track-dot';
      if (i < idx) cls += ' past';
      if (i === idx) cls += ' current';
      if (HUMAN_STAGES.has(s)) cls += ' human';
      return `<span class="${cls}" title="${esc(stageLabel(s))}"></span>`;
    }).join('<span class="track-line"></span>');
  }

  function openTask(id) {
    const t = state.taskById.get(id);
    if (!t) return;
    state.currentTaskId = id;
    const stage = normalizeStage(t);

    $('#modal-title').textContent = t.title;
    $('#modal-assignee').textContent = t.assignee || 'cos';
    $('#modal-stage').textContent = stageLabel(stage);
    $('#modal-client').textContent = clientName(t.clientId);
    $('#modal-brief').textContent = t.brief || '';
    renderModalStageTrack(stage);

    const progWrap = $('#modal-progress-wrap');
    if (t.progress) {
      progWrap.hidden = false;
      $('#modal-progress').textContent = t.progress;
    } else {
      progWrap.hidden = true;
    }

    const resWrap = $('#modal-result-wrap');
    const hasDeliverable = !!(t.result || (t.resultLinks && t.resultLinks.length));
    const showDeliverable = hasDeliverable && (HUMAN_STAGES.has(stage) || stage === 'done' || stage === 'drive_upload');
    if (showDeliverable) {
      resWrap.hidden = false;
      const label = $('#modal-result-label');
      if (label) {
        label.textContent = HUMAN_STAGES.has(stage)
          ? 'What you are approving'
          : stage === 'done'
            ? 'Result'
            : 'Deliverable';
      }
      $('#modal-result').textContent = t.result || '';
      $('#modal-links').innerHTML = (t.resultLinks || [])
        .map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a>`)
        .join('');
    } else {
      resWrap.hidden = true;
      $('#modal-result').textContent = '';
      $('#modal-links').innerHTML = '';
    }

    $('#modal-feedback-wrap').hidden = true;
    $('#modal-feedback').value = '';
    const ok = $('#modal-action-ok');
    ok.hidden = true;
    ok.textContent = '';

    const isHuman = HUMAN_STAGES.has(stage);
    $('#task-approve-btn').hidden = !isHuman;
    $('#task-reject-btn').hidden = !isHuman;
    $('#task-feedback-btn').hidden = !isHuman;

    $('#task-modal').showModal();
  }

  function closeTaskModal() {
    const modal = $('#task-modal');
    if (modal.open) modal.close();
    state.currentTaskId = null;
  }

  function openDeleteConfirm(id) {
    const t = state.taskById.get(id);
    if (!t) return;
    state.pendingDeleteId = id;
    $('#delete-modal-text').textContent =
      `Delete “${t.title}”? This cannot be undone.`;
    $('#delete-modal').showModal();
  }

  function closeDeleteModal() {
    const modal = $('#delete-modal');
    if (modal.open) modal.close();
    state.pendingDeleteId = null;
  }

  async function patchCurrentTask(body) {
    if (!state.currentTaskId) return null;
    const updated = await api('/api/tasks/' + state.currentTaskId, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    await loadTasks();
    return updated;
  }

  function flashModalOk(text) {
    const ok = $('#modal-action-ok');
    ok.textContent = text;
    ok.hidden = false;
  }

  async function loadClients() {
    const data = await api('/api/clients');
    state.clients = data.clients || [];
    renderNav();
  }

  async function loadTasks() {
    const data = await api('/api/tasks');
    state.tasks = (data.tasks || []).map((t) => ({
      ...t,
      stage: normalizeStage(t),
    }));
    state.taskById = new Map(state.tasks.map((t) => [t.id, t]));
    renderNav();
    renderBoard();
  }

  async function loadChat() {
    const cid = chatClientId();
    const data = await api('/api/chat?clientId=' + encodeURIComponent(cid));
    state.messages = data.messages || [];
    renderChat(state.messages);
  }

  async function refresh() {
    await Promise.all([loadTasks(), loadChat()]);
  }

  $('#logout-btn').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST', body: '{}' });
    location.href = BASE + '/login';
  });

  $('#chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const ta = $('#chat-text');
    const text = ta.value.trim();
    if (!text) return;
    ta.value = '';
    await api('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ text, clientId: chatClientId() }),
    });
    await loadChat();
  });

  $('#delegate-this-btn').addEventListener('click', async () => {
    const ta = $('#chat-text');
    const text = ta.value.trim();
    if (!text) {
      ta.focus();
      return;
    }
    const clientId = state.currentClientId === 'my-plate' ? 'other' : state.currentClientId;
    await api('/api/delegate', {
      method: 'POST',
      body: JSON.stringify({ text, clientId }),
    });
    ta.value = '';
    await refresh();
  });

  const delegateModal = $('#delegate-modal');
  function openDelegate() {
    $('#task-title').value = '';
    $('#task-brief').value = '';
    $('#delegate-ok').hidden = true;
    delegateModal.showModal();
    $('#task-brief').focus();
  }
  function closeDelegate() {
    if (delegateModal.open) delegateModal.close();
  }

  $('#delegate-open-btn').addEventListener('click', openDelegate);
  $('#delegate-close-btn').addEventListener('click', closeDelegate);
  $('#delegate-cancel-btn').addEventListener('click', closeDelegate);

  $('#delegate-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = $('#task-title').value.trim();
    const brief = $('#task-brief').value.trim();
    if (!brief) return;
    const clientId = state.currentClientId === 'my-plate' ? 'other' : state.currentClientId;
    await api('/api/delegate', {
      method: 'POST',
      body: JSON.stringify({ title: title || undefined, text: brief, clientId }),
    });
    const ok = $('#delegate-ok');
    ok.textContent = 'On the board.';
    ok.hidden = false;
    await refresh();
    setTimeout(closeDelegate, 500);
  });

  $('#task-modal-close').addEventListener('click', closeTaskModal);

  $('#task-approve-btn').addEventListener('click', async () => {
    const t = state.taskById.get(state.currentTaskId);
    if (!t) return;
    const stage = normalizeStage(t);
    let next;
    let note;
    if (stage === 'approve_copy') {
      next = 'static_production';
      note = 'Copy approved → static production';
    } else if (stage === 'approve_statics') {
      next = 'drive_upload';
      note = 'Statics approved → drive upload (stub)';
    } else {
      return;
    }
    await patchCurrentTask({ stage: next, progress: note });
    flashModalOk(note);
    setTimeout(closeTaskModal, 450);
  });

  $('#task-reject-btn').addEventListener('click', async () => {
    const t = state.taskById.get(state.currentTaskId);
    if (!t) return;
    const stage = normalizeStage(t);
    let next;
    let note;
    if (stage === 'approve_copy') {
      next = 'copywriting';
      note = 'Copy rejected → back to copywriting';
    } else if (stage === 'approve_statics') {
      next = 'static_production';
      note = 'Statics rejected → back to static production';
    } else {
      return;
    }
    await patchCurrentTask({ stage: next, progress: note });
    flashModalOk(note);
    setTimeout(closeTaskModal, 450);
  });

  $('#task-feedback-btn').addEventListener('click', async () => {
    const wrap = $('#modal-feedback-wrap');
    if (wrap.hidden) {
      wrap.hidden = false;
      $('#modal-feedback').focus();
      return;
    }
    const note = $('#modal-feedback').value.trim();
    if (!note) {
      $('#modal-feedback').focus();
      return;
    }
    const t = state.taskById.get(state.currentTaskId);
    if (!t) return;
    const stage = normalizeStage(t);
    const prev = t.progress ? String(t.progress) + '\n' : '';
    // Keep in current human stage; just append feedback
    await patchCurrentTask({
      stage,
      progress: prev + 'Feedback: ' + note,
    });
    flashModalOk('Feedback saved.');
    setTimeout(closeTaskModal, 450);
  });

  $('#task-delete-btn').addEventListener('click', () => {
    if (!state.currentTaskId) return;
    openDeleteConfirm(state.currentTaskId);
  });

  $('#delete-modal-close').addEventListener('click', closeDeleteModal);
  $('#delete-cancel-btn').addEventListener('click', closeDeleteModal);

  $('#delete-confirm-btn').addEventListener('click', async () => {
    const id = state.pendingDeleteId;
    if (!id) return;
    await api('/api/tasks/' + id, { method: 'DELETE' });
    closeDeleteModal();
    if (state.currentTaskId === id) closeTaskModal();
    await loadTasks();
  });

  loadClients()
    .then(() => selectClient('my-plate'))
    .then(() => refresh())
    .catch(() => {});

  setInterval(() => {
    refresh().catch(() => {});
  }, 5000);
})();
