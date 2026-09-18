/**
 * Quantity / holdings "where currently used" modal.
 * Opens from Total Quantity cells on Assets and Inventory lists.
 * Data: GET /api/holdings/:resourceType/:resourceId/usage
 */
(function () {
    const MODAL_CSS = `
        .qty-usage-modal {
            display: none;
            position: fixed;
            z-index: 10001;
            left: 0; top: 0; width: 100%; height: 100%;
            overflow: auto;
            background: rgba(15, 23, 42, 0.45);
            backdrop-filter: blur(2px);
        }
        .qty-usage-content {
            background: #fff;
            margin: 4% auto;
            width: 92%;
            max-width: 720px;
            max-height: 88vh;
            display: flex;
            flex-direction: column;
            border-radius: 12px;
            box-shadow: 0 12px 40px rgba(15, 23, 42, 0.25);
            overflow: hidden;
            animation: qtyUsageIn 0.22s ease-out;
        }
        @keyframes qtyUsageIn {
            from { transform: translateY(-12px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }
        .qty-usage-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 12px;
            padding: 16px 20px;
            background: #f8fafc;
            border-bottom: 1px solid #e2e8f0;
        }
        .qty-usage-title { margin: 0; font-size: 1.05rem; color: #0f172a; }
        .qty-usage-sub { margin: 4px 0 0; font-size: 12px; color: #64748b; }
        .qty-usage-close {
            cursor: pointer; font-size: 22px; color: #94a3b8; line-height: 1;
            border: none; background: transparent; padding: 0 4px;
        }
        .qty-usage-close:hover { color: #0f172a; }
        .qty-usage-body { flex: 1; overflow-y: auto; padding: 16px 20px 20px; }
        .qty-usage-loading { text-align: center; padding: 48px 20px; color: #64748b; }
        .qty-usage-spinner {
            border: 3px solid #e2e8f0; border-top-color: #2563eb;
            border-radius: 50%; width: 28px; height: 28px;
            animation: qtyUsageSpin 0.8s linear infinite; margin: 0 auto 10px;
        }
        @keyframes qtyUsageSpin { to { transform: rotate(360deg); } }
        .qty-usage-buckets {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
            gap: 10px;
            margin-bottom: 18px;
        }
        .qty-usage-bucket {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 10px;
            padding: 12px 10px;
            text-align: center;
        }
        .qty-usage-bucket .label {
            font-size: 10px; font-weight: 700; text-transform: uppercase;
            letter-spacing: 0.04em; color: #64748b; margin-bottom: 4px;
        }
        .qty-usage-bucket .value {
            font-size: 1.35rem; font-weight: 700; color: #0f172a;
        }
        .qty-usage-bucket.avail .value { color: #15803d; }
        .qty-usage-bucket.reserved .value { color: #b45309; }
        .qty-usage-bucket.converted .value { color: #7c3aed; }
        .qty-usage-bucket.inuse .value { color: #1d4ed8; }
        .qty-usage-section { margin-top: 8px; }
        .qty-usage-section h4 {
            margin: 0 0 8px; font-size: 12px; text-transform: uppercase;
            letter-spacing: 0.04em; color: #64748b;
        }
        .qty-usage-placement {
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 10px 12px;
            margin-bottom: 8px;
            display: flex;
            gap: 10px;
            align-items: flex-start;
            background: #fff;
        }
        .qty-usage-kind {
            flex-shrink: 0;
            font-size: 10px; font-weight: 700; text-transform: uppercase;
            padding: 2px 8px; border-radius: 999px;
            background: #e0e7ff; color: #3730a3; border: 1px solid #c7d2fe;
        }
        .qty-usage-kind.PROJECT { background: #dbeafe; color: #1e40af; border-color: #bfdbfe; }
        .qty-usage-kind.DC { background: #ffedd5; color: #9a3412; border-color: #fed7aa; }
        .qty-usage-kind.SET { background: #f3e8ff; color: #6b21a8; border-color: #e9d5ff; }
        .qty-usage-kind.RESERVATION { background: #fef3c7; color: #92400e; border-color: #fde68a; }
        .qty-usage-kind.ASSIGNED { background: #dcfce7; color: #166534; border-color: #bbf7d0; }
        .qty-usage-kind.PURCHASE_BOOK { background: #ffedd5; color: #9a3412; border-color: #fed7aa; }
        .qty-usage-kind.LEDGER_GAP { background: #fee2e2; color: #991b1b; border-color: #fecaca; }
        .qty-usage-kind.RESERVED { background: #fef3c7; color: #92400e; border-color: #fde68a; }
        .qty-usage-kind.CONVERTED { background: #f3e8ff; color: #6b21a8; border-color: #e9d5ff; }
        .qty-usage-empty {
            text-align: center; padding: 28px 12px; color: #94a3b8;
            border: 1px dashed #cbd5e1; border-radius: 10px;
        }
        .qty-usage-explain {
            margin-top: 14px;
            padding: 12px;
            border-radius: 8px;
            border: 1px solid #fecaca;
            background: #fef2f2;
        }
        .qty-usage-explain h4 {
            margin: 0 0 8px; font-size: 12px; text-transform: uppercase;
            letter-spacing: 0.04em; color: #991b1b;
        }
        .qty-usage-meta {
            display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px;
            font-size: 12px; color: #475569; margin-bottom: 16px;
            padding: 12px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;
        }
        .qty-usage-meta strong { color: #0f172a; }
        .qty-usage-footer {
            padding: 12px 20px; border-top: 1px solid #e2e8f0;
            display: flex; justify-content: space-between; align-items: center; gap: 8px;
            background: #fff;
        }
        .qty-usage-btn {
            padding: 8px 14px; border-radius: 6px; border: 1px solid #cbd5e1;
            background: #f1f5f9; color: #334155; font-weight: 600; cursor: pointer; font-size: 13px;
        }
        .qty-usage-btn:hover { background: #e2e8f0; }
        .qty-usage-btn.primary {
            background: #1d4ed8; color: #fff; border-color: #1d4ed8;
        }
        .qty-usage-btn.primary:hover { background: #1e40af; }
        @media (max-width: 520px) {
            .qty-usage-meta { grid-template-columns: 1fr; }
        }
    `;

    const MODAL_HTML = `
        <div id="sharedQtyUsageModal" class="qty-usage-modal" role="dialog" aria-modal="true" aria-labelledby="sharedQtyUsageTitle">
            <div class="qty-usage-content">
                <div class="qty-usage-header">
                    <div>
                        <h3 class="qty-usage-title" id="sharedQtyUsageTitle">Where currently used</h3>
                        <p class="qty-usage-sub" id="sharedQtyUsageSub"></p>
                    </div>
                    <button type="button" class="qty-usage-close" id="sharedQtyUsageCloseBtn" aria-label="Close">&times;</button>
                </div>
                <div id="sharedQtyUsageLoading" class="qty-usage-loading" style="display:none;">
                    <div class="qty-usage-spinner"></div>
                    Loading current usage…
                </div>
                <div id="sharedQtyUsageBody" class="qty-usage-body" style="display:none;"></div>
                <div class="qty-usage-footer">
                    <button type="button" class="qty-usage-btn" id="sharedQtyUsageHistoryBtn">Quantity History</button>
                    <button type="button" class="qty-usage-btn primary" id="sharedQtyUsageDoneBtn">Close</button>
                </div>
            </div>
        </div>
    `;

    let lastContext = { resourceType: null, resourceId: null };

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function init() {
        if (document.getElementById('sharedQtyUsageModal')) return;
        const style = document.createElement('style');
        style.textContent = MODAL_CSS;
        document.head.appendChild(style);
        const wrap = document.createElement('div');
        wrap.innerHTML = MODAL_HTML;
        document.body.appendChild(wrap.firstElementChild);

        const close = () => {
            const modal = document.getElementById('sharedQtyUsageModal');
            if (modal) modal.style.display = 'none';
        };
        document.getElementById('sharedQtyUsageCloseBtn')?.addEventListener('click', close);
        document.getElementById('sharedQtyUsageDoneBtn')?.addEventListener('click', close);
        document.getElementById('sharedQtyUsageModal')?.addEventListener('click', (e) => {
            if (e.target && e.target.id === 'sharedQtyUsageModal') close();
        });
        document.getElementById('sharedQtyUsageHistoryBtn')?.addEventListener('click', () => {
            const { resourceType, resourceId } = lastContext;
            if (!resourceId) return;
            if (resourceType === 'INVENTORY') {
                if (typeof window.showInventoryQuantityHistoryModal === 'function') {
                    window.showInventoryQuantityHistoryModal(resourceId);
                } else {
                    import('./quantity-history-modal.js?v=7.05').then(() => {
                        if (typeof window.showInventoryQuantityHistoryModal === 'function') {
                            window.showInventoryQuantityHistoryModal(resourceId);
                        }
                    }).catch(() => {});
                }
            } else if (typeof window.showQuantityHistoryModal === 'function') {
                window.showQuantityHistoryModal(resourceId);
            } else {
                import('./quantity-history-modal.js?v=7.05').then(() => {
                    if (typeof window.showQuantityHistoryModal === 'function') {
                        window.showQuantityHistoryModal(resourceId);
                    }
                }).catch(() => {});
            }
        });
    }

    function fmtQty(n, unit) {
        const num = Number(n);
        const text = Number.isFinite(num) ? String(num) : '0';
        return unit ? `${text} ${escapeHtml(unit)}` : text;
    }

    function qtyNum(value) {
        const n = Number(value);
        return Number.isFinite(n) ? n : 0;
    }

    function buildSnapshotFromRow(row, typeHint) {
        const type = String(typeHint || 'ASSET').toUpperCase() === 'INVENTORY' ? 'INVENTORY' : 'ASSET';
        const id = row.ID || row.Id || row.id || '';
        const total = qtyNum(row.quantity_total ?? row.QuantityTotal ?? (row.is_quantity_tracked ? 0 : 1));
        const available = qtyNum(row.quantity_available ?? row.QuantityAvailable ?? total);
        const reserved = qtyNum(row.quantity_reserved ?? row.QuantityReserved ?? 0);
        const converted = qtyNum(row.quantity_converted ?? row.QuantityConverted ?? 0);
        const unit = row.quantity_unit || row.QuantityUnit || null;
        const holding = {
            id,
            name: row.ItemName || row.itemname || row.Name || null,
            status: row.Status || row.status || null,
            location: row.CurrentLocation || row.currentlocation || null,
            assignedTo: row.AssignedTo || row.assignedto || row.assigned_to || null,
            sentAgainstDc: row.SentAgainstDC || row.sentagainstdc || null,
            quantityUnit: unit,
            resourceType: type,
            managedSet: row.managedSet || row.ManagedSet || null
        };
        const quantity = {
            total,
            available,
            reserved,
            converted,
            inUse: Math.max(0, total - available),
            unit
        };
        const placements = [];
        if (holding.assignedTo) {
            placements.push({ kind: 'ASSIGNED', label: holding.assignedTo, detail: 'Assigned to person/team' });
        }
        if (holding.sentAgainstDc) {
            placements.push({ kind: 'DC', label: holding.sentAgainstDc, detail: 'Sent against Delivery Challan' });
        }
        const projectId = row.AssignedProjectID || row.ProjectID || row.projectid || row.projectId;
        const projectName = row.AssignedProjectName || row.projectname || row.ProjectName;
        if (projectId) {
            placements.push({ kind: 'PROJECT', label: projectName || projectId, detail: projectId, projectId });
        }
        if (holding.managedSet) {
            const ms = holding.managedSet;
            placements.push({
                kind: 'SET',
                label: ms.name || ms.set_code || ms.id,
                detail: ms.id || ms.set_code
            });
        }
        return { resourceType: type, resourceId: id, holding, quantity, placements };
    }

    function mergeReservationPlacements(snapshot, reservations) {
        const active = (Array.isArray(reservations) ? reservations : [])
            .filter((r) => String(r.status || r.Status || '').toUpperCase() === 'ACTIVE');
        for (const r of active) {
            snapshot.placements.push({
                kind: 'RESERVATION',
                label: r.ownerLabel || `${r.ownerType || r.owner_type} ${r.ownerId || r.owner_id}`,
                detail: `${r.quantity} reserved · ${r.id}`
            });
        }
        return snapshot;
    }

    async function fetchUsageSnapshot(type, id, prefillRow) {
        const usageRes = await fetch(
            `/api/holdings/${encodeURIComponent(type)}/${encodeURIComponent(id)}/usage`,
            { credentials: 'include' }
        );
        if (usageRes.ok) {
            const usageData = await usageRes.json().catch(() => ({}));
            if (usageData.success !== false) return usageData;
        }

        const detailsRes = await fetch(`/api/asset-details/${encodeURIComponent(id)}`, { credentials: 'include' });
        if (detailsRes.ok) {
            const payload = await detailsRes.json().catch(() => ({}));
            const asset = payload.asset || {};
            const detectedType = asset.isInventory ? 'INVENTORY' : type;
            let snapshot = buildSnapshotFromRow(asset, detectedType);
            try {
                const rRes = await fetch(
                    `/api/reservations/resource/${encodeURIComponent(detectedType)}/${encodeURIComponent(id)}`,
                    { credentials: 'include' }
                );
                if (rRes.ok) {
                    const rPayload = await rRes.json().catch(() => ({}));
                    snapshot = mergeReservationPlacements(snapshot, rPayload.reservations);
                }
            } catch (_) { /* reservations optional */ }
            return snapshot;
        }

        if (prefillRow) return buildSnapshotFromRow(prefillRow, type);
        const errPayload = await usageRes.json().catch(() => ({}));
        throw new Error(errPayload.error || `Could not load usage (HTTP ${usageRes.status}). Restart the backend to pick up the new /api/holdings route.`);
    }

    function renderBody(data) {
        const q = data.quantity || {};
        const h = data.holding || {};
        const unit = q.unit || h.quantityUnit || '';
        const placements = Array.isArray(data.placements) ? data.placements : [];
        const meta = `
            <div class="qty-usage-meta">
                <div><strong>Status:</strong> ${escapeHtml(h.status || '—')}</div>
                <div><strong>Location:</strong> ${escapeHtml(h.location || '—')}</div>
                <div><strong>Assigned:</strong> ${escapeHtml(h.assignedTo || '—')}</div>
                <div><strong>Against DC:</strong> ${escapeHtml(h.sentAgainstDc || '—')}</div>
            </div>`;
        const buckets = `
            <div class="qty-usage-buckets">
                <div class="qty-usage-bucket">
                    <div class="label">Total</div>
                    <div class="value">${fmtQty(q.total, '')}</div>
                </div>
                <div class="qty-usage-bucket avail">
                    <div class="label">Available</div>
                    <div class="value">${fmtQty(q.available, '')}</div>
                </div>
                <div class="qty-usage-bucket reserved">
                    <div class="label">Reserved</div>
                    <div class="value">${fmtQty(q.reserved, '')}</div>
                </div>
                <div class="qty-usage-bucket converted">
                    <div class="label">Converted</div>
                    <div class="value">${fmtQty(q.converted, '')}</div>
                </div>
                <div class="qty-usage-bucket inuse">
                    <div class="label">Not available</div>
                    <div class="value">${fmtQty(q.inUse, '')}</div>
                </div>
            </div>
            ${unit ? `<div style="font-size:11px;color:#64748b;margin:-8px 0 14px;">Unit: ${escapeHtml(unit)}</div>` : ''}`;

        let placementHtml;
        if (!placements.length) {
            placementHtml = `
                <div class="qty-usage-empty">
                    No active placements, projects, DCs, or reservations.<br>
                    <span style="font-size:12px;">Quantity sits as available stock (or untracked placement).</span>
                </div>`;
        } else {
            placementHtml = placements.map((p) => `
                <div class="qty-usage-placement">
                    <span class="qty-usage-kind ${escapeHtml(p.kind || '')}">${escapeHtml(p.kind || 'USE')}</span>
                    <div>
                        <div style="font-weight:600;color:#0f172a;">${escapeHtml(p.label || '—')}</div>
                        ${p.detail ? `<div style="font-size:11px;color:#64748b;margin-top:2px;">${escapeHtml(p.detail)}</div>` : ''}
                    </div>
                </div>
            `).join('');
        }

        const expl = data.explanation || {};
        const reasons = Array.isArray(expl.reasons) ? expl.reasons : [];
        let explainHtml = '';
        if (qtyNum(q.inUse) > 0) {
            const ledgerGaps = reasons.filter((r) => String(r.kind || '').toUpperCase() === 'LEDGER_GAP');
            const otherWhy = reasons.filter((r) => String(r.kind || '').toUpperCase() !== 'LEDGER_GAP');
            explainHtml = `
                <div class="qty-usage-explain">
                    <h4>Why ${fmtQty(q.inUse, '')} not available?</h4>
                    ${(ledgerGaps.length || otherWhy.length)
                        ? [...ledgerGaps, ...otherWhy].map((r) => `
                            <div class="qty-usage-placement" style="background:#fff;">
                                <span class="qty-usage-kind ${escapeHtml(r.kind || 'LEDGER_GAP')}">${escapeHtml(r.kind || 'WHY')}</span>
                                <div>
                                    <div style="font-weight:600;color:#0f172a;">${escapeHtml(r.label || '—')}</div>
                                    ${r.detail ? `<div style="font-size:11px;color:#64748b;margin-top:2px;">${escapeHtml(r.detail)}</div>` : ''}
                                </div>
                            </div>
                        `).join('')
                        : `<div style="font-size:12px;color:#7f1d1d;">No matching placement found for the unavailable quantity. Open Quantity History for ADJUST / consume events.</div>`}
                </div>`;
        }

        return `
            ${meta}
            ${buckets}
            ${explainHtml}
            <div class="qty-usage-section">
                <h4>Current placements &amp; reservations</h4>
                ${placementHtml}
            </div>
        `;
    }

    window.showQuantityUsageModal = async function showQuantityUsageModal(resourceType, resourceId, prefillRow) {
        init();
        const type = String(resourceType || 'ASSET').trim().toUpperCase() === 'INVENTORY' ? 'INVENTORY' : 'ASSET';
        const id = String(resourceId || '').trim();
        if (!id) return;

        lastContext = { resourceType: type, resourceId: id };

        const modal = document.getElementById('sharedQtyUsageModal');
        const loading = document.getElementById('sharedQtyUsageLoading');
        const body = document.getElementById('sharedQtyUsageBody');
        const sub = document.getElementById('sharedQtyUsageSub');
        if (!modal) return;

        modal.style.display = 'block';
        loading.style.display = 'block';
        body.style.display = 'none';
        body.innerHTML = '';
        sub.textContent = `${type} · ${id}`;

        try {
            const data = await fetchUsageSnapshot(type, id, prefillRow);
            const name = data.holding?.name;
            sub.textContent = name ? `${name} · ${type} · ${id}` : `${type} · ${id}`;
            body.innerHTML = renderBody(data);
            loading.style.display = 'none';
            body.style.display = 'block';
        } catch (err) {
            body.innerHTML = `<div class="qty-usage-empty" style="color:#b91c1c;">Could not load usage: ${escapeHtml(err.message || err)}</div>`;
            loading.style.display = 'none';
            body.style.display = 'block';
        }
    };

    window.showAssetQuantityUsageModal = function (assetId) {
        return window.showQuantityUsageModal('ASSET', assetId);
    };
    window.showInventoryQuantityUsageModal = function (itemId) {
        return window.showQuantityUsageModal('INVENTORY', itemId);
    };
})();
