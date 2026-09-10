(() => {
  const BASE = (() => {
    const path = location.pathname.replace(/\/$/, '');
    if (path.endsWith('/control-centre')) return path;
    const idx = path.lastIndexOf('/control-centre');
    if (idx >= 0) return path.slice(0, idx + '/control-centre'.length);
    return '/control-centre';
  })();

  const $ = (sel) => document.querySelector(sel);
  const chatList = $('#chat-list');
  const cookingList = $('#cooking-list');
  const resultsList = $('#results-list');

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
      return iso;
    }
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

  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      $('#panel-' + btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'cooking' || btn.dataset.tab === 'results') loadTasks();
      if (btn.dataset.tab === 'chat') loadChat();
    });
  });

  $('#logout-btn').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST', body: '{}' });
    location.href = BASE + '/login';
  });

  function renderChat(messages) {
    if (!messages.length) {
      chatList.innerHTML = '<div class="empty">No messages yet. Say hello.</div>';
      return;
    }
    chatList.innerHTML = messages.map((m) => {
      const who = m.role === 'cos' ? 'Chief of Staff' : 'You';
      return `<article class="bubble ${esc(m.role)}"><span class="meta">${esc(who)} · ${esc(fmt(m.at))}</span>${esc(m.text)}</article>`;
    }).join('');
    chatList.scrollTop = chatList.scrollHeight;
  }

  async function loadChat() {
    const data = await api('/api/chat');
    renderChat(data.messages || []);
  }

  $('#chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const ta = $('#chat-text');
    const text = ta.value.trim();
    if (!text) return;
    ta.value = '';
    await api('/api/chat', { method: 'POST', body: JSON.stringify({ text }) });
    await loadChat();
  });

  $('#delegate-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = $('#task-title').value.trim();
    const brief = $('#task-brief').value.trim();
    const priority = $('#task-priority').value;
    await api('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title, brief, priority }),
    });
    $('#task-title').value = '';
    $('#task-brief').value = '';
    const ok = $('#delegate-ok');
    ok.textContent = 'Queued. Check Cooking.';
    ok.hidden = false;
    setTimeout(() => { ok.hidden = true; }, 2500);
  });

  function taskCard(t) {
    const links = (t.resultLinks || [])
      .map((u) => `<div><a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a></div>`)
      .join('');
    const resultBlock = t.status === 'done' && (t.result || links)
      ? `<div class="result">${esc(t.result || '')}${links}</div>`
      : '';
    return `<article class="task">
      <div class="task-top">
        <h3>${esc(t.title)}</h3>
        <span class="badge ${esc(t.priority)}">${esc(t.priority)}</span>
        <span class="badge ${esc(t.status)}">${esc(t.status.replace('_', ' '))}</span>
        ${t.example ? '<span class="badge example">example</span>' : ''}
      </div>
      <p class="brief">${esc(t.brief)}</p>
      ${resultBlock}
      <div class="when">updated ${esc(fmt(t.updatedAt || t.createdAt))}</div>
    </article>`;
  }

  async function loadTasks() {
    const data = await api('/api/tasks');
    const tasks = data.tasks || [];
    const cooking = tasks.filter((t) => t.status === 'queued' || t.status === 'in_progress');
    const done = tasks.filter((t) => t.status === 'done');
    cookingList.innerHTML = cooking.length
      ? cooking.map(taskCard).join('')
      : '<div class="empty">Nothing cooking. Delegate something.</div>';
    resultsList.innerHTML = done.length
      ? done.map(taskCard).join('')
      : '<div class="empty">No results yet.</div>';
  }

  loadChat().catch(() => {});
  loadTasks().catch(() => {});
  setInterval(() => {
    const active = document.querySelector('.tab.active')?.dataset.tab;
    if (active === 'chat') loadChat().catch(() => {});
    if (active === 'cooking' || active === 'results') loadTasks().catch(() => {});
  }, 8000);
})();
