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

  const COLUMNS = ['inbox', 'cooking', 'waiting', 'done'];

  const COLUMN_LABELS = {
    inbox: 'Inbox',
    cooking: 'In progress',
    waiting: 'Waiting on you',
    done: 'Done',
  };

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
    research: 'In the inbox',
    copywriting: 'Writing copy',
    approve_copy: 'Needs your OK on copy',
    static_production: 'Making ad images',
    approve_statics: 'Needs your OK on ads',
    drive_upload: 'Uploading',
    done: 'Done',
  };

  /** Shorter labels for step dots */
  const STAGE_SHORT_LABELS = {
    research: 'Inbox',
    copywriting: 'Writing',
    approve_copy: 'OK copy',
    static_production: 'Ad images',
    approve_statics: 'OK ads',
    drive_upload: 'Upload',
    done: 'Done',
  };

  const HUMAN_STAGES = new Set(['approve_copy', 'approve_statics']);

  /** Pipeline stage → Home / client Kanban column */
  const STAGE_TO_COLUMN = {
    research: 'inbox',
    copywriting: 'cooking',
    approve_copy: 'waiting',
    static_production: 'cooking',
    approve_statics: 'waiting',
    drive_upload: 'cooking',
    done: 'done',
  };

  const STATUS_TO_STAGE = {
    queued: 'research',
    inbox: 'research',
    in_progress: 'copywriting',
    cooking: 'copywriting',
    waiting: 'approve_copy',
    done: 'done',
  };

  const CREATIVE_STAGES = new Set([
    'copywriting',
    'approve_copy',
    'static_production',
    'approve_statics',
    'drive_upload',
  ]);

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

  function columnForTask(t) {
    // Prefer coarse status when it is already a Kanban column
    if (t && t.status && COLUMNS.includes(t.status)) return t.status;
    const stage = normalizeStage(t);
    return STAGE_TO_COLUMN[stage] || 'inbox';
  }

  function stageLabel(stage) {
    return STAGE_LABELS[stage] || stage;
  }

  function stageShortLabel(stage) {
    return STAGE_SHORT_LABELS[stage] || stageLabel(stage);
  }

  /** One-line plain status for cards (creative uses stage; others use column). */
  function cardStatusLine(t) {
    if (isCreativeTask(t)) return stageLabel(normalizeStage(t));
    const col = columnForTask(t);
    return COLUMN_LABELS[col] || col;
  }

  function isCreativeTask(t) {
    if (!t) return false;
    if (t.clientId === 'ad-factory') return true;
    const stage = normalizeStage(t);
    return CREATIVE_STAGES.has(stage);
  }

  function clientName(id) {
    const c = state.clients.find((x) => x.id === id);
    return c ? c.name : id;
  }

  function chatClientId() {
    return state.currentClientId === 'my-plate' ? 'cos' : state.currentClientId;
  }

  function isLikelyImageUrl(url) {
    const u = String(url || '').trim();
    if (!u) return false;
    if (/^data:image\//i.test(u)) return true;
    if (/\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i.test(u)) return true;
    if (/googleusercontent\.com|imgur\.com|cloudinary\.com|cdn\.|images\./i.test(u)) return true;
    return false;
  }

  function isFakeSampleImage(url) {
    const u = String(url || '').trim().toLowerCase();
    return !u || u.includes('sample-ad.jpg') || u.includes('/sample-ad');
  }

  /** Truth: only real https://drive.google.com links. */
  function isRealDriveUrl(url) {
    const u = String(url || '').trim();
    if (!u) return false;
    try {
      const parsed = new URL(u);
      if (parsed.protocol !== 'https:') return false;
      if (parsed.hostname !== 'drive.google.com') return false;
      if (/\/example|placeholder|sample|test-folder|your-folder/i.test(u)) return false;
      return true;
    } catch {
      return false;
    }
  }

  /** Merge images[] with image-looking resultLinks (by URL). Never include sample-ad. */
  function collectTaskImages(t) {
    const byUrl = new Map();
    const push = (raw, idx) => {
      if (raw == null) return;
      let url = '';
      let status = 'pending';
      let id = '';
      let note = '';
      if (typeof raw === 'string') {
        url = raw.trim();
        id = 'link-' + idx;
      } else {
        url = String(raw.url || '').trim();
        status = ['approved', 'rejected', 'pending'].includes(raw.status) ? raw.status : 'pending';
        id = String(raw.id || ('img-' + idx));
        note = raw.note != null ? String(raw.note) : '';
      }
      if (!url || isFakeSampleImage(url)) return;
      if (!byUrl.has(url)) byUrl.set(url, { id, url, status, note });
    };
    (t.images || []).forEach((img, i) => push(img, i));
    (t.resultLinks || []).forEach((u, i) => {
      if (isLikelyImageUrl(u)) push(u, 1000 + i);
    });
    return Array.from(byUrl.values());
  }

  function imageStatusLabel(status) {
    if (status === 'approved') return 'OK';
    if (status === 'rejected') return 'Send back';
    return 'Needs a look';
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
      if (columnForTask(t) === 'done') return false;
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
    $('#chat-title').textContent = id === 'my-plate' ? 'Chat' : 'Chat';
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
    const col = columnForTask(t);
    const progress = t.progress
      ? `<div class="progress">${esc(preview(t.progress, 100))}</div>`
      : '';
    const showResult = t.result && (HUMAN_STAGES.has(stage) || col === 'waiting' || col === 'done');
    const result = showResult
      ? `<div class="result-preview">${esc(preview(t.result, 160))}</div>`
      : '';
    const compact = opts.compact ? ' compact' : '';
    const deleteBtn = opts.showDelete !== false
      ? `<button type="button" class="card-delete" data-delete-id="${esc(t.id)}" title="Delete" aria-label="Delete">✕</button>`
      : '';
    const status = cardStatusLine(t);
    const statusCls = HUMAN_STAGES.has(stage)
      ? 'card-status human'
      : (stage === 'done' || col === 'done' ? 'card-status done' : 'card-status');
    const dots = isCreativeTask(t) ? cardStepDots(stage) : '';
    return `<div class="card-wrap${compact}">
      <button type="button" class="card" data-task-id="${esc(t.id)}">
        <p class="${statusCls}">${esc(status)}</p>
        ${dots}
        <div class="card-meta">
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

  function cardStepDots(current) {
    const idx = PIPELINE_STAGES.indexOf(current);
    return `<div class="card-dots" aria-hidden="true">${PIPELINE_STAGES.map((s, i) => {
      let cls = 'dot';
      if (i < idx) cls += ' past';
      if (i === idx) cls += ' current';
      if (HUMAN_STAGES.has(s)) cls += ' human';
      return `<span class="${cls}"></span>`;
    }).join('')}</div>`;
  }

  function renderPipelineFlow(el, tasks) {
    if (!el) return;
    const counts = {};
    for (const s of PIPELINE_STAGES) counts[s] = 0;
    for (const t of tasks) {
      const s = normalizeStage(t);
      if (counts[s] != null) counts[s] += 1;
      else counts.research += 1;
    }

    el.innerHTML = PIPELINE_STAGES.map((s, i) => {
      const human = HUMAN_STAGES.has(s) ? ' human' : '';
      const done = s === 'done' ? ' done' : '';
      const has = counts[s] > 0 ? ' has-tasks' : '';
      const arrow = i < PIPELINE_STAGES.length - 1
        ? '<span class="pipe-arrow" aria-hidden="true">→</span>'
        : '';
      return `<div class="pipe-step${human}${done}${has}" data-stage="${esc(s)}">
        <span class="pipe-count">${counts[s]}</span>
        <span class="pipe-label">${esc(stageShortLabel(s))}</span>
      </div>${arrow}`;
    }).join('');
  }

  function renderOverview(tasks) {
    const overview = $('#overview');
    const stats = $('#overview-stats');
    if (state.currentClientId !== 'my-plate') {
      overview.hidden = true;
      stats.innerHTML = '';
      return;
    }

    const needs = tasks.filter((t) => HUMAN_STAGES.has(normalizeStage(t))).length;
    const byClient = {};
    for (const t of tasks) {
      if (columnForTask(t) === 'done') continue;
      const id = t.clientId || 'other';
      byClient[id] = (byClient[id] || 0) + 1;
    }
    const clientBits = Object.entries(byClient)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([id, n]) => `<span class="overview-pill"><strong>${esc(clientName(id))}</strong> ${n}</span>`)
      .join('');

    const stageCounts = {};
    for (const s of PIPELINE_STAGES) stageCounts[s] = 0;
    let creativeTotal = 0;
    for (const t of tasks) {
      if (!isCreativeTask(t)) continue;
      creativeTotal += 1;
      const s = normalizeStage(t);
      if (stageCounts[s] != null) stageCounts[s] += 1;
    }
    const stageBits = creativeTotal
      ? PIPELINE_STAGES.filter((s) => stageCounts[s] > 0)
          .map((s) => `<span class="overview-pill stage">${esc(stageShortLabel(s))} ${stageCounts[s]}</span>`)
          .join('')
      : '';

    if (!needs && !clientBits && !creativeTotal) {
      overview.hidden = true;
      stats.innerHTML = '';
      return;
    }
    overview.hidden = false;
    stats.innerHTML = `
      ${needs ? `<div class="overview-block">
        <span class="overview-label">Needs you</span>
        <span class="overview-value warn">${needs}</span>
      </div>` : ''}
      ${clientBits ? `<div class="overview-block grow">
        <span class="overview-label">Open</span>
        <div class="overview-pills">${clientBits}</div>
      </div>` : ''}
      ${creativeTotal ? `<div class="overview-block grow">
        <span class="overview-label">Ad work</span>
        <div class="overview-pills">${stageBits}</div>
      </div>` : ''}
    `;
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
    const isHome = state.currentClientId === 'my-plate';
    const isAdFactory = state.currentClientId === 'ad-factory';

    renderOverview(isHome ? state.tasks : tasks);

    const needsSection = $('#needs-you');
    const needsList = $('#needs-you-list');
    $('#needs-you-count').textContent = String(needs.length);
    // Needs-you strip: Home overview of approve_* , or when client has any
    if (!needs.length) {
      needsSection.hidden = true;
      needsList.innerHTML = '';
    } else {
      needsSection.hidden = false;
      needsList.innerHTML = needs.map((t) => taskCard(t, { compact: true })).join('');
    }

    // Quiet UI: no board-level pipeline strip — step dots live on creative cards only
    const pipeSection = $('#pipeline-viz');
    if (pipeSection) {
      pipeSection.hidden = true;
      const flow = $('#pipeline-flow');
      if (flow) flow.innerHTML = '';
    }

    for (const status of COLUMNS) {
      const list = tasks.filter((t) => columnForTask(t) === status);
      const el = $(`#col-${status}`);
      const countEl = document.querySelector(`[data-count="${status}"]`);
      if (countEl) countEl.textContent = String(list.length);
      if (!list.length) {
        el.innerHTML = '<div class="empty-slot">Nothing here</div>';
      } else {
        el.innerHTML = list.map((t) => taskCard(t)).join('');
      }
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
      if (m.role === 'status' || m.autoAck) {
        // Never present auto-ack as a real CoS answer
        const label = m.role === 'status' ? m.text : 'Sent — waiting for a reply';
        return `<div class="bubble status" role="status">${esc(label)}</div>`;
      }
      const who = m.role === 'cos' ? 'Reply' : 'You';
      const waiting = m.role === 'user' && m.awaitingCos
        ? ' <span class="awaiting">· waiting for a reply</span>'
        : '';
      return `<article class="bubble ${esc(m.role)}"><span class="meta">${esc(who)} · ${esc(fmt(m.at))}${waiting}</span>${esc(m.text)}</article>`;
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

  function renderModalPipelineFlow(current) {
    const wrap = $('#modal-pipeline-flow-wrap');
    const el = $('#modal-pipeline-flow');
    el.innerHTML = PIPELINE_STAGES.map((s, i) => {
      const human = HUMAN_STAGES.has(s) ? ' human' : '';
      const done = s === 'done' ? ' done' : '';
      const cur = s === current ? ' has-tasks current-stage' : '';
      const arrow = i < PIPELINE_STAGES.length - 1
        ? '<span class="pipe-arrow" aria-hidden="true">→</span>'
        : '';
      return `<div class="pipe-step${human}${done}${cur}" data-stage="${esc(s)}">
        <span class="pipe-label">${esc(stageShortLabel(s))}</span>
      </div>${arrow}`;
    }).join('');
    wrap.hidden = false;
  }

  function renderModalGallery(t, stage) {
    const wrap = $('#modal-gallery-wrap');
    const gallery = $('#modal-gallery');
    const images = collectTaskImages(t);
    if (!images.length) {
      wrap.hidden = true;
      gallery.innerHTML = '';
      return;
    }
    wrap.hidden = false;
    // Per-image OK / Send back on image-work stages (dogfood: must be visible, not image-only)
    const reviewable = stage === 'approve_statics' || stage === 'static_production';
    $('#modal-gallery-hint').textContent = reviewable
      ? 'OK or send back each ad image.'
      : 'Ad images on this card.';
    gallery.innerHTML = images.map((img) => {
      const st = imageStatusLabel(img.status);
      const key = esc(img.id || img.url);
      const actions = reviewable
        ? `<div class="img-actions" data-review="1">
            <button type="button" class="btn primary small-btn" data-img-action="approved" data-img-key="${key}">OK</button>
            <button type="button" class="btn ghost small-btn" data-img-action="rejected" data-img-key="${key}">Send back</button>
          </div>`
        : '';
      return `<figure class="img-card status-${esc(img.status)}" data-img-id="${key}">
        <a href="${esc(img.url)}" target="_blank" rel="noopener" class="img-thumb-wrap">
          <img src="${esc(img.url)}" alt="Ad image" loading="lazy" />
        </a>
        <figcaption>
          <span class="img-status">${esc(st)}</span>
          ${actions}
        </figcaption>
      </figure>`;
    }).join('');

    gallery.querySelectorAll('[data-img-action]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const key = btn.dataset.imgKey;
        const status = btn.dataset.imgAction;
        setImageStatus(key, status);
      });
    });
  }

  function renderModalDrive(t) {
    const wrap = $('#modal-drive-wrap');
    const url = (t.driveUrl || '').trim();
    const view = $('#modal-drive-view');
    const edit = $('#modal-drive-edit');
    const addBtn = $('#modal-drive-add-btn');
    edit.hidden = true;
    // Truth: never show Drive row unless real https://drive.google.com link
    if (!isRealDriveUrl(url)) {
      if (wrap) wrap.hidden = true;
      view.hidden = true;
      if (addBtn) addBtn.hidden = true;
      return;
    }
    if (wrap) wrap.hidden = false;
    view.hidden = false;
    if (addBtn) addBtn.hidden = true;
    const a = $('#modal-drive-link');
    a.href = url;
    a.textContent = 'Open Google Drive folder';
  }

  async function setImageStatus(key, status) {
    const t = state.taskById.get(state.currentTaskId);
    if (!t) return;
    const images = collectTaskImages(t).map((img) => {
      const match = img.id === key || img.url === key;
      return match ? { ...img, status } : { ...img };
    });
    await patchCurrentTask({ images });
    const updated = state.taskById.get(state.currentTaskId);
    if (updated) {
      renderModalGallery(updated, normalizeStage(updated));
      flashModalOk(status === 'approved' ? 'Marked image OK' : 'Marked image to send back');
    }
  }

  function openTask(id) {
    const t = state.taskById.get(id);
    if (!t) return;
    state.currentTaskId = id;
    const stage = normalizeStage(t);
    const col = columnForTask(t);
    const creative = isCreativeTask(t);

    $('#modal-title').textContent = t.title;
    $('#modal-assignee').textContent = t.assignee || 'cos';
    $('#modal-stage').textContent = creative
      ? stageLabel(stage)
      : (COLUMN_LABELS[col] || col);
    $('#modal-client').textContent = clientName(t.clientId);
    $('#modal-brief').textContent = t.brief || '';

    const track = $('#modal-stage-track');
    const pipeWrap = $('#modal-pipeline-flow-wrap');
    if (creative) {
      track.hidden = false;
      renderModalStageTrack(stage);
    } else {
      track.hidden = true;
      track.innerHTML = '';
    }
    // Quiet: no labeled pipeline strip in modal
    if (pipeWrap) {
      pipeWrap.hidden = true;
      const el = $('#modal-pipeline-flow');
      if (el) el.innerHTML = '';
    }

    const progWrap = $('#modal-progress-wrap');
    if (t.progress) {
      progWrap.hidden = false;
      $('#modal-progress').textContent = t.progress;
    } else {
      progWrap.hidden = true;
    }

    const resWrap = $('#modal-result-wrap');
    const images = collectTaskImages(t);
    const nonImageLinks = (t.resultLinks || []).filter((u) => !isLikelyImageUrl(u));
    const hasDeliverable = !!(t.result || nonImageLinks.length);
    const showDeliverable = hasDeliverable && (
      HUMAN_STAGES.has(stage) || col === 'waiting' || col === 'done' ||
      stage === 'drive_upload' || stage === 'copywriting' || stage === 'static_production'
    );
    if (showDeliverable) {
      resWrap.hidden = false;
      const label = $('#modal-result-label');
      if (label) {
        label.textContent = HUMAN_STAGES.has(stage) || col === 'waiting'
          ? 'Please check this'
          : col === 'done'
            ? 'Result'
            : 'Work so far';
      }
      $('#modal-result').textContent = t.result || '';
      $('#modal-links').innerHTML = nonImageLinks
        .map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a>`)
        .join('');
    } else {
      resWrap.hidden = true;
      $('#modal-result').textContent = '';
      $('#modal-links').innerHTML = '';
    }

    renderModalGallery(t, stage);
    renderModalDrive(t);

    $('#modal-feedback-wrap').hidden = true;
    $('#modal-feedback').value = '';
    const ok = $('#modal-action-ok');
    ok.hidden = true;
    ok.textContent = '';

    const isHuman = HUMAN_STAGES.has(stage);
    const approveBtn = $('#task-approve-btn');
    const rejectBtn = $('#task-reject-btn');
    const feedbackBtn = $('#task-feedback-btn');
    const readyBtn = $('#task-ready-btn');

    approveBtn.hidden = !isHuman;
    rejectBtn.hidden = !isHuman;
    feedbackBtn.hidden = !isHuman;

    if (stage === 'approve_copy') {
      approveBtn.textContent = 'OK copy';
      approveBtn.dataset.marker = 'ok-copy';
      rejectBtn.textContent = 'Send back to writing';
    } else if (stage === 'approve_statics') {
      approveBtn.textContent = 'OK ads';
      approveBtn.dataset.marker = 'ok-ads';
      rejectBtn.textContent = 'Send back to image work';
    } else {
      approveBtn.textContent = 'OK';
      approveBtn.dataset.marker = 'ok-action';
      rejectBtn.textContent = 'Send back';
    }

    // Optional: writing / image work with a result ready for human OK
    const canReadyCopy = stage === 'copywriting' && !!(t.result || (t.resultLinks && t.resultLinks.length));
    const canReadyStatics = stage === 'static_production' && !!(t.result || (t.resultLinks && t.resultLinks.length) || images.length);
    if (canReadyCopy || canReadyStatics) {
      readyBtn.hidden = false;
      readyBtn.textContent = 'Ready for my review';
      readyBtn.dataset.nextStage = canReadyCopy ? 'approve_copy' : 'approve_statics';
    } else {
      readyBtn.hidden = true;
      readyBtn.dataset.nextStage = '';
    }

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
    state.tasks = (data.tasks || []).map((t) => {
      const stage = normalizeStage(t);
      const status = COLUMNS.includes(t.status) ? t.status : (STAGE_TO_COLUMN[stage] || 'inbox');
      return { ...t, stage, status };
    });
    state.taskById = new Map(state.tasks.map((t) => [t.id, t]));
    renderNav();
    renderBoard();
  }

  async function loadChat() {
    const cid = chatClientId();
    const data = await api('/api/chat?clientId=' + encodeURIComponent(cid));
    state.messages = data.messages || [];
    renderChat(state.messages);
    const last = state.messages[state.messages.length - 1];
    if (last && (last.role === 'status' || (last.role === 'user' && last.awaitingCos))) {
      setChatStatus('Sent — waiting for a reply');
    } else {
      setChatStatus('');
    }
    setChatError('');
  }

  async function refresh() {
    await Promise.all([loadTasks(), loadChat()]);
  }

  $('#logout-btn').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST', body: '{}' });
    location.href = BASE + '/login';
  });

  function setChatError(msg) {
    const err = $('#chat-error');
    if (!err) return;
    if (!msg) {
      err.hidden = true;
      err.textContent = '';
      return;
    }
    err.textContent = msg;
    err.hidden = false;
  }

  function setChatStatus(msg) {
    const el = $('#chat-status');
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.textContent = msg;
    el.hidden = false;
  }

  $('#chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const ta = $('#chat-text');
    const sendBtn = $('#chat-send-btn') || e.target.querySelector('[type="submit"]');
    const text = ta.value.trim();
    if (!text) return;
    setChatError('');
    setChatStatus('Sending…');
    if (sendBtn) sendBtn.disabled = true;
    const clientId = chatClientId();
    // Optimistic: show your message + waiting line immediately
    const optimistic = {
      id: 'tmp-' + Date.now(),
      role: 'user',
      text,
      at: new Date().toISOString(),
      awaitingCos: true,
    };
    const optimisticStatus = {
      id: 'tmp-status-' + Date.now(),
      role: 'status',
      text: 'Sent — waiting for a reply',
      at: optimistic.at,
    };
    renderChat([...(state.messages || []), optimistic, optimisticStatus]);
    ta.value = '';
    try {
      const data = await api('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ text, clientId }),
      });
      if (Array.isArray(data.messages)) {
        state.messages = data.messages;
        renderChat(state.messages);
      } else {
        await loadChat();
      }
      setChatStatus('Sent — waiting for a reply');
    } catch (err) {
      ta.value = text;
      setChatStatus('');
      setChatError(err.message || 'Could not send. Try again.');
      await loadChat().catch(() => {});
    } finally {
      if (sendBtn) sendBtn.disabled = false;
    }
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

  function showDriveEdit(show) {
    const t = state.taskById.get(state.currentTaskId);
    const edit = $('#modal-drive-edit');
    const view = $('#modal-drive-view');
    const addBtn = $('#modal-drive-add-btn');
    if (show) {
      edit.hidden = false;
      view.hidden = true;
      addBtn.hidden = true;
      $('#modal-drive-input').value = (t && t.driveUrl) || '';
      $('#modal-drive-input').focus();
    } else if (t) {
      renderModalDrive(t);
    }
  }

  $('#modal-drive-add-btn').addEventListener('click', () => showDriveEdit(true));
  $('#modal-drive-edit-btn').addEventListener('click', () => showDriveEdit(true));
  $('#modal-drive-cancel-btn').addEventListener('click', () => {
    const t = state.taskById.get(state.currentTaskId);
    if (t) renderModalDrive(t);
    else showDriveEdit(false);
  });
  $('#modal-drive-save-btn').addEventListener('click', async () => {
    const url = $('#modal-drive-input').value.trim();
    if (url && !isRealDriveUrl(url)) {
      flashModalOk('Need a real https://drive.google.com link');
      return;
    }
    try {
      await patchCurrentTask({ driveUrl: url });
      const updated = state.taskById.get(state.currentTaskId);
      if (updated) renderModalDrive(updated);
      flashModalOk(url ? 'Google Drive folder saved' : 'Drive link cleared');
    } catch (err) {
      flashModalOk(err.message || 'Could not save Drive link');
    }
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
      note = 'Copy OK — making ad images';
    } else if (stage === 'approve_statics') {
      const imgs = collectTaskImages(t);
      const driveOk = isRealDriveUrl(t.driveUrl);
      if (!imgs.length || !driveOk) {
        flashModalOk(
          !imgs.length
            ? 'Need real ad images before OK ads'
            : 'Need a real Google Drive folder link before upload'
        );
        return;
      }
      next = 'drive_upload';
      note = 'Ads OK — uploading';
    } else {
      return;
    }
    try {
      await patchCurrentTask({ stage: next, progress: note });
      flashModalOk(note);
      setTimeout(closeTaskModal, 450);
    } catch (err) {
      flashModalOk(err.message || 'Could not update');
    }
  });

  $('#task-reject-btn').addEventListener('click', async () => {
    const t = state.taskById.get(state.currentTaskId);
    if (!t) return;
    const stage = normalizeStage(t);
    let next;
    let note;
    if (stage === 'approve_copy') {
      next = 'copywriting';
      note = 'Sent back to writing';
    } else if (stage === 'approve_statics') {
      next = 'static_production';
      note = 'Sent back to image work';
    } else {
      return;
    }
    await patchCurrentTask({ stage: next, progress: note });
    flashModalOk(note);
    setTimeout(closeTaskModal, 450);
  });

  $('#task-ready-btn').addEventListener('click', async () => {
    const btn = $('#task-ready-btn');
    const next = btn.dataset.nextStage;
    if (!next || !HUMAN_STAGES.has(next)) return;
    const note = next === 'approve_copy'
      ? 'Ready for your OK on copy'
      : 'Ready for your OK on images';
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
