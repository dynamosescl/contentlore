// ================================================================
// /admin/admin.js
// Client-side admin panel. Auth via sessionStorage + X-Admin-Password
// header on every API call.
// ================================================================

(function () {
  const authWall = document.getElementById('auth-wall');
  const adminPanel = document.getElementById('admin-panel');
  const authForm = document.getElementById('auth-form');
  const authError = document.getElementById('auth-error');
  const passwordInput = document.getElementById('admin-password-input');

  function getPassword() {
    return sessionStorage.getItem('cl_admin_pw') || '';
  }

  function setPassword(pw) {
    sessionStorage.setItem('cl_admin_pw', pw);
  }

  async function apiCall(path, options = {}) {
    const pw = getPassword();
    const headers = {
      'X-Admin-Password': pw,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };
    const res = await fetch(path, { ...options, headers });
    return res;
  }

  async function tryAuth(pw) {
    setPassword(pw);
    const res = await apiCall('/api/admin/pending?limit=1');
    if (res.status === 401) {
      sessionStorage.removeItem('cl_admin_pw');
      return false;
    }
    return res.ok;
  }

  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    authError.classList.add('hidden');
    const pw = passwordInput.value;
    const ok = await tryAuth(pw);
    if (ok) {
      authWall.classList.add('hidden');
      adminPanel.classList.remove('hidden');
      loadPending();
    } else {
      authError.textContent = 'Wrong password.';
      authError.classList.remove('hidden');
    }
  });

  // If password already cached, try it silently
  (async () => {
    if (getPassword() && (await tryAuth(getPassword()))) {
      authWall.classList.add('hidden');
      adminPanel.classList.remove('hidden');
      loadPending();
    }
  })();

  // Tabs
  document.querySelectorAll('.cl-admin-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cl-admin-tab').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.cl-admin-tab-body').forEach((b) => {
        b.classList.add('hidden');
        b.classList.remove('active');
      });
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      const body = document.getElementById(`tab-${tab}`);
      body.classList.remove('hidden');
      body.classList.add('active');
      if (tab === 'stats') loadStats();
      if (tab === 'pending') loadPending();
    });
  });

  // Pending list
  async function loadPending() {
    const countEl = document.getElementById('pending-count');
    const listEl = document.getElementById('pending-list');
    countEl.textContent = 'Loading…';
    listEl.innerHTML = '';
    const res = await apiCall('/api/admin/pending?limit=200');
    if (!res.ok) {
      countEl.textContent = 'Error loading.';
      return;
    }
    const data = await res.json();
    countEl.textContent = `${data.count} pending`;
    if (data.count === 0) {
      listEl.innerHTML = '<p class="cl-muted">No pending creators.</p>';
      return;
    }
    listEl.innerHTML = data.pending.map(renderPendingCard).join('');

    // Wire up approve/reject buttons
    listEl.querySelectorAll('[data-approve]').forEach((btn) => {
      btn.addEventListener('click', () => handleApprove(btn.dataset.approve));
    });
    listEl.querySelectorAll('[data-reject]').forEach((btn) => {
      btn.addEventListener('click', () => handleReject(btn.dataset.reject));
    });
  }

  function renderPendingCard(p) {
    return `
      <article class="cl-pending-card" data-id="${p.id}">
        <div class="cl-pending-meta">
          <span class="cl-platform-tag ${p.platform}">${p.platform.toUpperCase()}</span>
          <span class="cl-handle">@${escapeHtml(p.handle)}</span>
          ${p.verified ? '<span class="cl-verified-tag">verified</span>' : ''}
          <span class="cl-source-tag">${p.source}</span>
        </div>
        <h3>${escapeHtml(p.display_name || p.handle)}</h3>
        <p class="cl-pending-bio">${escapeHtml((p.bio || '').substring(0, 200))}</p>
        ${p.followers ? `<p class="cl-muted">${p.followers.toLocaleString()} followers</p>` : ''}
        ${p.discovery_reason ? `<p class="cl-muted">Discovery: ${escapeHtml(p.discovery_reason)}</p>` : ''}
        <div class="cl-pending-actions">
          <button class="cl-admin-btn-primary" data-approve="${p.id}">Approve</button>
          <button class="cl-admin-btn-danger" data-reject="${p.id}">Reject</button>
        </div>
      </article>
    `;
  }

  async function handleApprove(id) {
    const res = await apiCall(`/api/admin/pending/${id}/approve`, { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      document.querySelector(`[data-id="${id}"]`)?.remove();
      flash(`Approved — ${data.creator_id}`, 'success');
    } else {
      flash(`Error: ${data.error}`, 'error');
    }
  }

  async function handleReject(id) {
    if (!confirm('Reject this creator?')) return;
    const res = await apiCall(`/api/admin/pending/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'manual' }),
    });
    const data = await res.json();
    if (data.ok) {
      document.querySelector(`[data-id="${id}"]`)?.remove();
      flash('Rejected', 'success');
    } else {
      flash(`Error: ${data.error}`, 'error');
    }
  }

  // Bulk
  document.getElementById('bulk-approve-all').addEventListener('click', async () => {
    if (!confirm('Approve ALL pending creators? This cannot be undone.')) return;
    const res = await apiCall('/api/admin/pending/approve-all', {
      method: 'POST',
      body: JSON.stringify({ max: 100 }),
    });
    const data = await res.json();
    flash(`Approved ${data.approved}, skipped ${data.skipped}, errors ${data.errors?.length || 0}`, 'success');
    loadPending();
  });

  document.getElementById('bulk-reject-all').addEventListener('click', async () => {
    if (!confirm('Reject ALL pending creators?')) return;
    const res = await apiCall('/api/admin/pending/reject-all', {
      method: 'POST',
      body: JSON.stringify({ max: 500, reason: 'bulk_reject' }),
    });
    const data = await res.json();
    flash(`Rejected ${data.rejected}`, 'success');
    loadPending();
  });

  // Enrichment
  document.getElementById('enrich-btn').addEventListener('click', async () => {
    const btn = document.getElementById('enrich-btn');
    const result = document.getElementById('enrich-result');
    btn.disabled = true;
    btn.textContent = 'Running Claude…';
    result.textContent = '';
    try {
      const res = await apiCall('/api/admin/creators/enrich-all', {
        method: 'POST',
        body: JSON.stringify({ max: 10 }),
      });
      const data = await res.json();
      result.textContent = JSON.stringify(data, null, 2);
    } catch (e) {
      result.textContent = 'Error: ' + e.message;
    } finally {
      btn.disabled = false;
      btn.textContent = '✨ Enrich next 10 creators';
    }
  });

  // Stats (simple)
  async function loadStats() {
    const grid = document.getElementById('stats-grid');
    grid.innerHTML = 'Loading…';
    try {
      const res = await apiCall('/api/creators?limit=500');
      const data = await res.json();
      const pendingRes = await apiCall('/api/admin/pending?limit=1');
      const pendingData = await pendingRes.json();
      grid.innerHTML = `
        <div class="cl-stat-box"><div class="cl-stat-num">${data.count}</div><div>Live creators</div></div>
        <div class="cl-stat-box"><div class="cl-stat-num">${pendingData.count}</div><div>Pending review</div></div>
      `;
    } catch (e) {
      grid.innerHTML = 'Error loading stats.';
    }
  }

  function flash(msg, kind = 'info') {
    const el = document.createElement('div');
    el.className = `cl-flash cl-flash-${kind}`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
})();
