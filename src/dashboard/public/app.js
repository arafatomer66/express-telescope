(() => {
  const apiBase = location.pathname.replace(/\/$/, '') + '/api';
  const state = { type: 'all', selected: null, autoRefresh: true };

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  function fmtTime(ts) {
    const d = new Date(ts);
    const now = Date.now();
    const diff = now - ts;
    if (diff < 60_000) return Math.round(diff / 1000) + 's ago';
    if (diff < 3_600_000) return Math.round(diff / 60_000) + 'm ago';
    return d.toLocaleTimeString();
  }

  function fmtDuration(ms) {
    if (ms == null) return '-';
    if (ms < 1) return ms.toFixed(2) + 'ms';
    if (ms < 1000) return ms.toFixed(1) + 'ms';
    return (ms / 1000).toFixed(2) + 's';
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function statusClass(s) {
    if (s >= 500) return 's5';
    if (s >= 400) return 's4';
    if (s >= 300) return 's3';
    return 's2';
  }

  async function fetchJSON(url, opts) {
    const r = await fetch(url, opts);
    if (!r.ok) throw new Error(r.statusText);
    return r.json();
  }

  async function loadStats() {
    const stats = await fetchJSON(apiBase + '/stats');
    $$('.count').forEach((el) => {
      const k = el.dataset.count;
      el.textContent = stats[k] ?? 0;
    });
  }

  async function loadEntries() {
    const params = new URLSearchParams();
    if (state.type !== 'all') params.set('type', state.type);
    params.set('limit', '100');
    const { entries } = await fetchJSON(apiBase + '/entries?' + params);
    renderList(entries);
  }

  function rowFor(e) {
    if (e.type === 'request') {
      const c = e.content;
      return `
        <div class="row" data-id="${e.id}">
          <span class="method ${c.method}">${c.method}</span>
          <span class="status ${statusClass(c.status)}">${c.status}</span>
          <span class="uri">${escapeHtml(c.uri)}</span>
          <span class="duration">${fmtDuration(c.duration)}</span>
          <span class="time">${fmtTime(e.createdAt)}</span>
        </div>`;
    }
    if (e.type === 'exception') {
      const c = e.content;
      return `
        <div class="row" data-id="${e.id}">
          <span class="badge exception">EXC</span>
          <span class="uri" style="grid-column: span 3;">${escapeHtml(c.class)}: ${escapeHtml(c.message)}</span>
          <span class="time">${fmtTime(e.createdAt)}</span>
        </div>`;
    }
    if (e.type === 'query') {
      const c = e.content;
      const tags = e.tags.map((t) => `<span class="tag ${t}">${t}</span>`).join('');
      return `
        <div class="row" data-id="${e.id}">
          <span class="badge query">SQL</span>
          <span class="uri" style="grid-column: span 2;">${escapeHtml(c.sql.slice(0, 120))}</span>
          <span class="duration">${tags}${fmtDuration(c.duration)}</span>
          <span class="time">${fmtTime(e.createdAt)}</span>
        </div>`;
    }
    if (e.type === 'log') {
      const c = e.content;
      return `
        <div class="row" data-id="${e.id}">
          <span class="badge log">${c.level.toUpperCase()}</span>
          <span class="uri" style="grid-column: span 3;">${escapeHtml(c.message.slice(0, 200))}</span>
          <span class="time">${fmtTime(e.createdAt)}</span>
        </div>`;
    }
    if (e.type === 'http_client') {
      const c = e.content;
      const statusCls = c.status === 0 ? 's5' : statusClass(c.status);
      return `
        <div class="row" data-id="${e.id}">
          <span class="method ${c.method}">${c.method}</span>
          <span class="status ${statusCls}">${c.status || 'ERR'}</span>
          <span class="uri">→ ${escapeHtml(c.uri)}</span>
          <span class="duration">${fmtDuration(c.duration)}</span>
          <span class="time">${fmtTime(e.createdAt)}</span>
        </div>`;
    }
    if (e.type === 'dump') {
      const c = e.content;
      const preview = (c.label ? c.label + ': ' : '') +
        c.values.map((v) => typeof v === 'string' ? v : JSON.stringify(v)).join(' ');
      return `
        <div class="row" data-id="${e.id}">
          <span class="badge dump">DUMP</span>
          <span class="uri" style="grid-column: span 3;">${escapeHtml(preview.slice(0, 200))}</span>
          <span class="time">${fmtTime(e.createdAt)}</span>
        </div>`;
    }
    return `
      <div class="row" data-id="${e.id}">
        <span class="badge ${e.type}">${e.type.toUpperCase()}</span>
        <span class="uri" style="grid-column: span 3;">${escapeHtml(JSON.stringify(e.content).slice(0, 200))}</span>
        <span class="time">${fmtTime(e.createdAt)}</span>
      </div>`;
  }

  function renderList(entries) {
    const list = $('#list');
    const empty = $('#empty');
    if (!entries.length) {
      list.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    list.innerHTML = entries.map(rowFor).join('');
    list.querySelectorAll('.row').forEach((row) => {
      row.addEventListener('click', () => openDetail(row.dataset.id));
      if (row.dataset.id === state.selected) row.classList.add('selected');
    });
  }

  async function openDetail(id) {
    state.selected = id;
    $$('.row').forEach((r) => r.classList.toggle('selected', r.dataset.id === id));
    const { entry, batch } = await fetchJSON(apiBase + '/entries/' + id);
    renderDetail(entry, batch);
  }

  function renderDetail(entry, batch) {
    const detail = $('#detail');
    detail.classList.remove('hidden');
    $('#detailTitle').textContent =
      entry.type === 'request'
        ? entry.content.method + ' ' + entry.content.uri
        : entry.type.toUpperCase();

    const sections = [];
    sections.push(section('Meta', kv({
      Type: entry.type,
      'Created at': new Date(entry.createdAt).toISOString(),
      Tags: entry.tags.join(', ') || '—',
      'Batch ID': entry.batchId || '—',
    })));

    if (entry.type === 'request') {
      const c = entry.content;
      sections.push(section('Request', kv({
        Method: c.method,
        URI: c.uri,
        Status: String(c.status),
        Duration: fmtDuration(c.duration),
        IP: c.ip || '—',
        'User-Agent': c.userAgent || '—',
      })));
      if (c.headers) sections.push(section('Headers', codeBlock(JSON.stringify(c.headers, null, 2))));
      if (c.payload) sections.push(section('Payload', codeBlock(JSON.stringify(c.payload, null, 2))));
      if (c.response !== undefined)
        sections.push(section('Response',
          codeBlock(typeof c.response === 'string' ? c.response : JSON.stringify(c.response, null, 2))));
    } else if (entry.type === 'exception') {
      const c = entry.content;
      sections.push(section('Exception', kv({
        Class: c.class,
        Message: c.message,
        File: c.file || '—',
        Line: c.line ?? '—',
      })));
      sections.push(section('Stack trace', codeBlock(c.trace.join('\n'))));
    } else if (entry.type === 'query') {
      const c = entry.content;
      sections.push(section('Query', kv({
        Connection: c.connection,
        Duration: fmtDuration(c.duration),
        Slow: c.slow ? 'yes' : 'no',
      })));
      sections.push(section('SQL', codeBlock(c.sql)));
      if (c.bindings && c.bindings.length)
        sections.push(section('Bindings', codeBlock(JSON.stringify(c.bindings, null, 2))));
    } else if (entry.type === 'log') {
      const c = entry.content;
      sections.push(section('Log', kv({ Level: c.level, Message: c.message })));
      if (c.context) sections.push(section('Context', codeBlock(JSON.stringify(c.context, null, 2))));
    } else if (entry.type === 'http_client') {
      const c = entry.content;
      sections.push(section('Outbound HTTP', kv({
        Method: c.method,
        URI: c.uri,
        Status: c.status === 0 ? 'ERROR' : String(c.status),
        Duration: fmtDuration(c.duration),
        Error: c.error || '—',
      })));
      if (c.requestHeaders) sections.push(section('Request headers', codeBlock(JSON.stringify(c.requestHeaders, null, 2))));
      if (c.requestBody !== undefined) sections.push(section('Request body',
        codeBlock(typeof c.requestBody === 'string' ? c.requestBody : JSON.stringify(c.requestBody, null, 2))));
      if (c.responseHeaders) sections.push(section('Response headers', codeBlock(JSON.stringify(c.responseHeaders, null, 2))));
      if (c.responseBody !== undefined) sections.push(section('Response body',
        codeBlock(typeof c.responseBody === 'string' ? c.responseBody : JSON.stringify(c.responseBody, null, 2))));
    } else if (entry.type === 'dump') {
      const c = entry.content;
      if (c.label) sections.push(section('Label', codeBlock(c.label)));
      sections.push(section('Values', codeBlock(c.values.map((v) =>
        typeof v === 'string' ? v : JSON.stringify(v, null, 2)
      ).join('\n\n'))));
      if (c.source) sections.push(section('Source', kv({
        File: c.source.file || '—',
        Line: c.source.line ?? '—',
      })));
    } else {
      sections.push(section('Content', codeBlock(JSON.stringify(entry.content, null, 2))));
    }

    if (batch && batch.length > 1) {
      const items = batch.map((b) =>
        `<div class="batch-item" data-id="${b.id}">
          <span class="type">${b.type}</span>
          <span>${escapeHtml(summarize(b)).slice(0, 80)}</span>
        </div>`
      ).join('');
      sections.push(section('Batch (' + batch.length + ' entries)', `<div class="batch-list">${items}</div>`));
    }

    $('#detailBody').innerHTML = sections.join('');
    $('#detailBody').querySelectorAll('.batch-item').forEach((el) => {
      el.addEventListener('click', () => openDetail(el.dataset.id));
    });
  }

  function summarize(e) {
    if (e.type === 'request') return e.content.method + ' ' + e.content.uri + ' → ' + e.content.status;
    if (e.type === 'exception') return e.content.class + ': ' + e.content.message;
    if (e.type === 'query') return e.content.sql;
    if (e.type === 'log') return '[' + e.content.level + '] ' + e.content.message;
    if (e.type === 'http_client') return e.content.method + ' → ' + e.content.uri + ' (' + e.content.status + ')';
    if (e.type === 'dump') return (e.content.label ? e.content.label + ': ' : '') +
      e.content.values.map((v) => typeof v === 'string' ? v : JSON.stringify(v)).join(' ');
    return JSON.stringify(e.content);
  }

  function section(title, body) {
    return `<div class="section"><h4>${escapeHtml(title)}</h4>${body}</div>`;
  }
  function kv(obj) {
    const rows = Object.entries(obj)
      .map(([k, v]) => `<div class="k">${escapeHtml(k)}</div><div class="v">${escapeHtml(v)}</div>`)
      .join('');
    return `<div class="kv">${rows}</div>`;
  }
  function codeBlock(text) {
    return `<pre class="code">${escapeHtml(text)}</pre>`;
  }

  // ---- bindings ----
  $('#nav').addEventListener('click', (e) => {
    const a = e.target.closest('.nav-item');
    if (!a) return;
    e.preventDefault();
    state.type = a.dataset.type;
    $$('.nav-item').forEach((n) => n.classList.toggle('active', n === a));
    loadEntries();
  });
  $('#refreshBtn').addEventListener('click', () => { loadStats(); loadEntries(); });
  $('#clearBtn').addEventListener('click', async () => {
    if (!confirm('Clear all entries?')) return;
    const params = state.type === 'all' ? '' : '?type=' + state.type;
    await fetch(apiBase + '/entries' + params, { method: 'DELETE' });
    loadStats(); loadEntries();
  });
  $('#closeDetail').addEventListener('click', () => {
    $('#detail').classList.add('hidden');
    state.selected = null;
    $$('.row').forEach((r) => r.classList.remove('selected'));
  });
  $('#autoRefresh').addEventListener('change', (e) => { state.autoRefresh = e.target.checked; });

  // ---- init ----
  loadStats();
  loadEntries();
  setInterval(() => {
    if (!state.autoRefresh) return;
    loadStats();
    loadEntries();
  }, 3000);
})();
