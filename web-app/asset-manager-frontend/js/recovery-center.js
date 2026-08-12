/**
 * Recovery Center — global soft-delete recovery module (SYSTEM nav).
 * Multi-entity capable; Phase 1 shows Assets.
 * Nav badge totals all enabled entity types via GET /api/recovery-center/summary.
 */
import { showToast } from './utils.js?v=6.60';

const state = {
  items: [],
  entityTypes: [],
  filters: {
    q: '',
    entityType: '',
    deletedBy: '',
    deletedFrom: '',
    deletedTo: '',
    sort: 'deleted_at',
    sortDir: 'desc'
  },
  selected: new Set(),
  loaded: false,
  badgeTotal: 0
};

const NAV_LABEL = 'Recovery Center';

function getEl(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return String(iso);
  }
}

async function fetchJson(url, options = {}) {
  const token = localStorage.getItem('token');
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { credentials: 'include', ...options, headers });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
  if (!response.ok) throw new Error(data.error || data.message || text || `Request failed (${response.status})`);
  return data;
}

function buildQuery() {
  const p = new URLSearchParams();
  const f = state.filters;
  if (f.q) p.set('q', f.q);
  if (f.entityType) p.set('entityType', f.entityType);
  if (f.deletedBy) p.set('deletedBy', f.deletedBy);
  if (f.deletedFrom) p.set('deletedFrom', f.deletedFrom);
  if (f.deletedTo) p.set('deletedTo', f.deletedTo);
  if (f.sort) p.set('sort', f.sort);
  if (f.sortDir) p.set('sortDir', f.sortDir);
  const qs = p.toString();
  return qs ? `?${qs}` : '';
}

function uniqueDeletedBy(items) {
  const set = new Set();
  items.forEach((i) => {
    if (i.deleted_by) set.add(String(i.deleted_by));
  });
  return [...set].sort();
}

function renderToolbarMeta() {
  const countEl = getEl('recoveryCenterCount');
  if (countEl) countEl.textContent = `${state.items.length} item${state.items.length === 1 ? '' : 's'}`;

  const entitySelect = getEl('recoveryFilterEntity');
  if (entitySelect && entitySelect.options.length <= 1) {
    entitySelect.innerHTML = `<option value="">All entity types</option>` +
      state.entityTypes.map((e) => `<option value="${escapeHtml(e.type)}">${escapeHtml(e.label)}</option>`).join('');
    entitySelect.value = state.filters.entityType || '';
  }

  const bySelect = getEl('recoveryFilterDeletedBy');
  if (bySelect) {
    const current = state.filters.deletedBy || '';
    const options = uniqueDeletedBy(state.items);
    bySelect.innerHTML = `<option value="">All users</option>` +
      options.map((u) => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join('');
    bySelect.value = current;
  }
}

function renderTable() {
  const tbody = getEl('recoveryCenterTableBody');
  const empty = getEl('recoveryCenterEmpty');
  if (!tbody) return;

  if (!state.items.length) {
    tbody.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  tbody.innerHTML = state.items.map((item) => {
    const idKey = `${item.entity_type}:${item.entity_id}`;
    const checked = state.selected.has(idKey) ? 'checked' : '';
    const detailsHref = item.details_url || '#';
    return `
      <tr data-entity-type="${escapeHtml(item.entity_type)}" data-entity-id="${escapeHtml(item.entity_id)}">
        <td style="width: 36px;">
          <input type="checkbox" class="recovery-row-select" data-key="${escapeHtml(idKey)}" ${checked} />
        </td>
        <td><span class="status-badge" style="background:#eef2ff;color:#3730a3;border:1px solid #c7d2fe;">${escapeHtml(item.entity_type_label || item.entity_type)}</span></td>
        <td>
          <div style="font-weight:600;color:#0f172a;">${escapeHtml(item.name)}</div>
          <div style="font-size:11px;color:#64748b;font-family:monospace;">${escapeHtml(item.entity_id)}</div>
        </td>
        <td>${escapeHtml(item.original_location || '—')}</td>
        <td style="white-space:nowrap;font-size:12px;color:#475569;">${escapeHtml(formatDate(item.deleted_at))}</td>
        <td>${escapeHtml(item.deleted_by || '—')}</td>
        <td style="color:#64748b;font-size:12px;">${escapeHtml(item.reason || '—')}</td>
        <td><span class="status-badge" style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;">${escapeHtml(item.status || 'Soft Deleted')}</span></td>
        <td style="white-space:nowrap;">
          <button type="button" class="action-button green recovery-restore-btn" data-type="${escapeHtml(item.entity_type)}" data-id="${escapeHtml(item.entity_id)}" style="padding:4px 10px;font-size:12px;">Restore</button>
          <a class="action-button blue" href="${escapeHtml(detailsHref)}" target="_blank" rel="noopener" style="padding:4px 10px;font-size:12px;text-decoration:none;${item.details_url ? '' : 'opacity:0.45;pointer-events:none;'}">View Details</a>
          <button type="button" class="action-button grey" disabled title="Permanent delete is not enabled this sprint" style="padding:4px 10px;font-size:12px;opacity:0.55;cursor:not-allowed;">Permanent Delete</button>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.recovery-restore-btn').forEach((btn) => {
    btn.onclick = () => restoreOne(btn.dataset.type, btn.dataset.id);
  });
  tbody.querySelectorAll('.recovery-row-select').forEach((cb) => {
    cb.onchange = () => {
      if (cb.checked) state.selected.add(cb.dataset.key);
      else state.selected.delete(cb.dataset.key);
      updateBulkBar();
    };
  });
}

function updateBulkBar() {
  const bar = getEl('recoveryBulkBar');
  const label = getEl('recoveryBulkLabel');
  if (!bar || !label) return;
  const n = state.selected.size;
  bar.style.display = n > 0 ? 'flex' : 'none';
  label.textContent = `${n} selected`;
}

async function loadEntityTypes() {
  const data = await fetchJson('/api/recovery-center/entity-types');
  state.entityTypes = data.entities || [];
}

async function loadItems() {
  const data = await fetchJson(`/api/recovery-center/items${buildQuery()}`);
  state.items = data.items || [];
  state.selected.clear();
  renderToolbarMeta();
  renderTable();
  updateBulkBar();
  await refreshRecoveryCenterBadge();
}

/**
 * Update SYSTEM nav label: "Recovery Center" or "Recovery Center (N)".
 * Total includes every enabled entity type (future types auto-contribute).
 */
export async function refreshRecoveryCenterBadge() {
  const nav = getEl('nav-recovery-center');
  if (!nav) return 0;
  try {
    const data = await fetchJson('/api/recovery-center/summary');
    const total = Number(data.total || 0);
    state.badgeTotal = total;
    nav.textContent = total > 0 ? `${NAV_LABEL} (${total})` : NAV_LABEL;
    return total;
  } catch (err) {
    console.warn('[RecoveryCenter] badge refresh failed:', err.message || err);
    return state.badgeTotal;
  }
}

async function restoreOne(entityType, entityId) {
  if (!entityType || !entityId) return;
  if (!confirm(`Restore ${entityType} “${entityId}”?\n\nRelationships, history, QR, and serial numbers are preserved.`)) return;
  try {
    await fetchJson(`/api/recovery-center/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    showToast('Restored successfully', 'success');
    if (typeof window.loadAssets === 'function' && entityType === 'asset') {
      await window.loadAssets();
    }
    await loadItems();
  } catch (err) {
    showToast(err.message || 'Restore failed', 'error');
  }
}

async function bulkRestore() {
  const keys = [...state.selected];
  if (!keys.length) return;
  if (!confirm(`Restore ${keys.length} selected item(s)?`)) return;
  let ok = 0;
  let fail = 0;
  for (const key of keys) {
    const [entityType, ...rest] = key.split(':');
    const entityId = rest.join(':');
    try {
      await fetchJson(`/api/recovery-center/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      ok += 1;
    } catch {
      fail += 1;
    }
  }
  showToast(`Restored ${ok}${fail ? `, ${fail} failed` : ''}`, fail ? 'error' : 'success');
  if (typeof window.loadAssets === 'function') await window.loadAssets();
  await loadItems();
}

function bindFilters() {
  const map = [
    ['recoverySearch', 'q'],
    ['recoveryFilterEntity', 'entityType'],
    ['recoveryFilterDeletedBy', 'deletedBy'],
    ['recoveryFilterFrom', 'deletedFrom'],
    ['recoveryFilterTo', 'deletedTo'],
    ['recoverySort', 'sort']
  ];
  map.forEach(([id, key]) => {
    const el = getEl(id);
    if (!el || el.dataset.bound) return;
    el.dataset.bound = '1';
    const handler = async () => {
      if (key === 'sort') {
        const [col, dir] = String(el.value || 'deleted_at:desc').split(':');
        state.filters.sort = col || 'deleted_at';
        state.filters.sortDir = dir || 'desc';
      } else {
        state.filters[key] = el.value || '';
      }
      await loadItems();
    };
    el.addEventListener(el.tagName === 'INPUT' && el.type === 'search' ? 'input' : 'change', () => {
      if (el.tagName === 'INPUT' && el.type === 'search') {
        clearTimeout(el._t);
        el._t = setTimeout(handler, 250);
      } else handler();
    });
  });

  const refreshBtn = getEl('recoveryRefreshBtn');
  if (refreshBtn && !refreshBtn.dataset.bound) {
    refreshBtn.dataset.bound = '1';
    refreshBtn.onclick = () => loadItems();
  }

  const bulkRestoreBtn = getEl('recoveryBulkRestoreBtn');
  if (bulkRestoreBtn && !bulkRestoreBtn.dataset.bound) {
    bulkRestoreBtn.dataset.bound = '1';
    bulkRestoreBtn.onclick = () => bulkRestore();
  }

  const bulkDeleteBtn = getEl('recoveryBulkDeleteBtn');
  if (bulkDeleteBtn) {
    bulkDeleteBtn.disabled = true;
    bulkDeleteBtn.title = 'Permanent delete is not enabled this sprint';
  }

  const selectAll = getEl('recoverySelectAll');
  if (selectAll && !selectAll.dataset.bound) {
    selectAll.dataset.bound = '1';
    selectAll.onchange = () => {
      state.selected.clear();
      if (selectAll.checked) {
        state.items.forEach((i) => state.selected.add(`${i.entity_type}:${i.entity_id}`));
      }
      renderTable();
      updateBulkBar();
    };
  }
}

export async function initRecoveryCenterView() {
  bindFilters();
  try {
    if (!state.loaded) {
      await loadEntityTypes();
      state.loaded = true;
    }
    await loadItems();
  } catch (err) {
    console.error('[RecoveryCenter]', err);
    showToast(err.message || 'Failed to load Recovery Center', 'error');
  }
}

window.initRecoveryCenterView = initRecoveryCenterView;
window.refreshRecoveryCenterBadge = refreshRecoveryCenterBadge;
