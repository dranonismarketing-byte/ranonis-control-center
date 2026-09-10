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

  const state = {
    clients: [],
    tasks: [],
    messages: [],
    currentClientId: 'my-plate',
    taskById: new Map(),
    currentTaskId: null,
  };

  const COLUMNS = ['inbox', 'cooking', 'waiting', 'done'];

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

  function cookingCountFor(clientId) {
    return state.tasks.filter((t) => {
      if (t.status !== 'cooking') return false;
      if (clientId === 'my-plate') return true;
      return t.clientId === clientId;
    }).length;
  }

  function visibleTasks() {
    if (state.currentClientId === 'my-plate') return state.tasks.slice();
    return state.tasks.filter((t) => t.clientId === state.currentClientId);
  }

  function renderNav() {
    const nav = $('#client-nav');
    nav.innerHTML = state.clients.map((c) => {
      const count = cookingCountFor(c.id);
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

  function taskCard(t) {
    const progress = t.progress
      ? `<div class="progress">${esc(preview(t.progress, 100))}</div>`
      : '';
    const result = t.result && (t.status === 'done' || t.status === 'waiting')
      ? `<div class="result-preview">${esc(preview(t.result, 160))}</div>`
      : '';
    return `<button type="button" class="card" data-task-id="${esc(t.id)}">
      <div class="card-meta">
        <span class="chip assignee">${esc(t.assignee || 'cos')}</span>
        ${t.clientId && state.currentClientId === 'my-plate' && t.clientId !== 'my-plate'
          ? `<span class="chip">${esc(clientName(t.clientId))}</span>` : ''}
      </div>
      <h3>${esc(t.title)}</h3>
      <p class="brief">${esc(preview(t.brief, 160))}</p>
      ${progress}
      ${result}
    </button>`;
  }

  function renderBoard() {
    const tasks = visibleTasks();
    for (const status of COLUMNS) {
      const list = tasks.filter((t) => t.status === status);
      const el = $(`#col-${status}`);
      const countEl = document.querySelector(`[data-count="${status}"]`);
      if (countEl) countEl.textContent = String(list.length);
      if (!list.length) {
        el.innerHTML = '<div class="empty-slot">Nothing here</div>';
      } else {
        el.innerHTML = list.map(taskCard).join('');
      }
    }
    $$('.card[data-task-id]').forEach((btn) => {
      btn.addEventListener('click', () => openTask(btn.dataset.taskId));
    });
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

  function openTask(id) {
    const t = state.taskById.get(id);
    if (!t) return;
    state.currentTaskId = id;
    $('#modal-title').textContent = t.title;
    $('#modal-assignee').textContent = t.assignee || 'cos';
    $('#modal-status').textContent = t.status;
    $('#modal-client').textContent = clientName(t.clientId);
    $('#modal-brief').textContent = t.brief || '';

    const progWrap = $('#modal-progress-wrap');
    if (t.progress) {
      progWrap.hidden = false;
      $('#modal-progress').textContent = t.progress;
    } else {
      progWrap.hidden = true;
    }

    const resWrap = $('#modal-result-wrap');
    const hasDeliverable = !!(t.result || (t.resultLinks && t.resultLinks.length));
    if (hasDeliverable) {
      resWrap.hidden = false;
      const label = $('#modal-result-label');
      if (label) {
        label.textContent = t.status === 'waiting'
          ? 'What you are approving'
          : t.status === 'done'
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
    $('#task-modal').showModal();
  }

  function closeTaskModal() {
    const modal = $('#task-modal');
    if (modal.open) modal.close();
    state.currentTaskId = null;
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
      status: t.status === 'queued' ? 'inbox'
        : t.status === 'in_progress' ? 'cooking'
        : t.status,
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
    await patchCurrentTask({ status: 'done', progress: 'Approved' });
    flashModalOk('Approved — moved to Done.');
    setTimeout(closeTaskModal, 450);
  });

  $('#task-reject-btn').addEventListener('click', async () => {
    await patchCurrentTask({ status: 'inbox', progress: 'Rejected — back to Inbox' });
    flashModalOk('Rejected — back to Inbox.');
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
    const prev = (t && t.progress) ? String(t.progress) + '\n' : '';
    await patchCurrentTask({
      status: 'waiting',
      progress: prev + 'Feedback: ' + note,
    });
    flashModalOk('Feedback saved — Waiting on you.');
    setTimeout(closeTaskModal, 450);
  });

  loadClients()
    .then(() => selectClient('my-plate'))
    .then(() => refresh())
    .catch(() => {});

  setInterval(() => {
    refresh().catch(() => {});
  }, 5000);
})();
