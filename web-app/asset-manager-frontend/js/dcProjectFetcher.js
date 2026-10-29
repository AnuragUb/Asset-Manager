// dcProjectFetcher.js

const API_PROJECT_SEARCH = '/api/projects/search';
const API_PROJECT_ORDERS = (id) => `/api/projects/${id}/orders`;

export function initDCProjectFetcher() {
    const searchInput = document.getElementById('dcProjectSearch');
    const resultsContainer = document.getElementById('dcProjectSearchResults');
    const consigneeSelect = document.getElementById('dcConsigneeSelect');

    if (!searchInput || !resultsContainer || !consigneeSelect) {
        console.warn('DC Project Fetcher: Elements not found');
        return;
    }

    let debounceTimer;
    let projectOrders = []; // Store fetched orders to reuse data

    // Handle Consignee Selection
    consigneeSelect.addEventListener('change', (e) => {
        const orderId = e.target.value;
        if (!orderId) {
            // Clear fields if no selection
            setVal('dcConsigneeName', '');
            setVal('dcConsigneeAddress', '');
            setVal('dcConsigneeGST', '');
            setVal('dcConsigneeState', '');
            setVal('dcConsigneeStateCode', '');
            return;
        }

        const order = projectOrders.find(o => String(o.ID) === String(orderId));
        if (order) {
            setVal('dcConsigneeName', order.ConsigneeName);
            setVal('dcConsigneeAddress', order.ConsigneeAddress);
            setVal('dcConsigneeGST', order.ConsigneeGSTIN);
            setVal('dcConsigneeState', order.ConsigneeState);
            setVal('dcConsigneeStateCode', order.ConsigneeStateCode);
            
            // Populate Buyer Order No and Date from the selected Order
            setVal('dcBuyerOrderNo', order.OrderNo);
            
            // If there's an Order Date, try to set it
            if (order.OrderDate) {
                // If there is a specific field for Order Date (often reused or specific like dcRefDate)
                // In dashboard.js logic we saw window.tempDCOrderDate being used
                if (window) window.tempDCOrderDate = order.OrderDate;
                
                // Also try to set visual fields if they exist
                setVal('dcRefDate', order.OrderDate); 
            }
        }
    });

    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        clearTimeout(debounceTimer);
        
        if (query.length < 2) {
            resultsContainer.style.display = 'none';
            return;
        }

        debounceTimer = setTimeout(() => {
            fetchProjects(query);
        }, 300);
    });

    // Close results when clicking outside
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !resultsContainer.contains(e.target)) {
            resultsContainer.style.display = 'none';
        }
    });

    async function fetchProjects(query) {
        try {
            const token = localStorage.getItem('token');
            const headers = {};
            if (token && token !== 'null' && token !== 'undefined') {
                headers['Authorization'] = `Bearer ${token}`;
            }

            const response = await fetch(`${API_PROJECT_SEARCH}?q=${encodeURIComponent(query)}`, { headers });
            const data = await response.json();

            if (data.success) {
                renderResults(data.projects);
            } else {
                console.error('Error fetching projects:', data.error);
            }
        } catch (err) {
            console.error('Error fetching projects:', err);
        }
    }

    function renderResults(projects) {
        resultsContainer.innerHTML = '';
        if (projects.length === 0) {
            resultsContainer.style.display = 'none';
            return;
        }

        projects.forEach(p => {
            const div = document.createElement('div');
            div.style.padding = '8px 12px';
            div.style.cursor = 'pointer';
            div.style.borderBottom = '1px solid #eee';
            div.style.fontSize = '13px';
            div.innerHTML = `<strong>${p.ProjectName}</strong> <span style="color:#666; font-size:11px;">(ID: ${p.ID})</span><br>
                             <span style="color:#888; font-size:11px;">Buyer: ${p.BuyerName || 'N/A'}</span>`;
            
            div.addEventListener('mouseenter', () => div.style.background = '#f0f0f0');
            div.addEventListener('mouseleave', () => div.style.background = 'white');
            
            div.onclick = () => {
                populateDCFromProject(p);
                resultsContainer.style.display = 'none';
                searchInput.value = ''; // Clear search after selection
            };
            
            resultsContainer.appendChild(div);
        });

        resultsContainer.style.display = 'block';
    }

    async function populateDCFromProject(project) {
        // Buyer Details (Auto-fill)
        setVal('dcBuyerName', project.BuyerName);
        setVal('dcBuyerAddress', project.BuyerAddress);
        setVal('dcBuyerGST', project.BuyerGSTIN);
        setVal('dcBuyerState', project.BuyerState);
        setVal('dcBuyerStateCode', project.BuyerStateCode);

        // References
        setVal('dcRefNo', project.ProjectName); 
        
        // Fetch Orders for Consignee Dropdown
        await fetchProjectOrders(project.ID);
        
        console.log(`Populated DC from Project: ${project.ProjectName} (${project.ID})`);
    }

    async function fetchProjectOrders(projectId) {
        try {
            const token = localStorage.getItem('token');
            const headers = {};
            if (token && token !== 'null' && token !== 'undefined') {
                headers['Authorization'] = `Bearer ${token}`;
            }

            const response = await fetch(API_PROJECT_ORDERS(projectId), { headers });
            const data = await response.json();

            consigneeSelect.innerHTML = '<option value="">-- Select Consignee from Project Orders --</option>';
            
            if (data.success && data.orders.length > 0) {
                projectOrders = data.orders;
                data.orders.forEach(order => {
                    const opt = document.createElement('option');
                    opt.value = order.ID;
                    opt.textContent = `Order #${order.OrderNo || 'N/A'} - ${order.ConsigneeName || 'Unknown Consignee'}`;
                    consigneeSelect.appendChild(opt);
                });
                consigneeSelect.style.display = 'block';
                
                // If there's only one order, auto-select it for convenience
                if (data.orders.length === 1) {
                    consigneeSelect.value = data.orders[0].ID;
                    consigneeSelect.dispatchEvent(new Event('change'));
                }
            } else {
                consigneeSelect.style.display = 'none';
                console.log('No orders found for this project.');
            }
        } catch (err) {
            console.error('Error fetching project orders:', err);
            consigneeSelect.style.display = 'none';
        }
    }

    function toDateInputValue(val) {
        if (val == null || val === '') return '';
        const s = String(val).trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
        const d = new Date(s);
        if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
        return s;
    }

    function setVal(id, val) {
        const el = document.getElementById(id);
        if (el) {
            el.value = el.type === 'date' ? toDateInputValue(val) : (val || '');
            if (id === 'dcRefDate' && el.value) {
                window.tempDCOrderDate = el.value;
            }
            el.dispatchEvent(new Event('input'));
            el.dispatchEvent(new Event('change'));
        }
    }
}

// White Labeling (Alias) Logic
let dcAssetAliases = {}; // ID -> { name, desc }

export function initDCAliasLogic() {
    console.log('[DC Alias] Initializing...');
    const assetInput = document.getElementById('dcAssetIds');
    const aliasModal = document.getElementById('dcAliasModal');
    const saveBtn = document.getElementById('btnSaveDcAlias');

    if (!assetInput || !aliasModal || !saveBtn) return;

    // Listen for changes to Asset IDs to show "Edit Alias" icons
    assetInput.addEventListener('change', renderAliasButtons);
    assetInput.addEventListener('input', renderAliasButtons);

    saveBtn.onclick = () => {
        const assetId = aliasModal.dataset.assetId;
        const name = document.getElementById('aliasCustomName').value;
        const desc = document.getElementById('aliasCustomDescription').value;
        
        if (name || desc) {
            dcAssetAliases[assetId] = { name, desc };
        } else {
            delete dcAssetAliases[assetId];
        }
        
        aliasModal.style.display = 'none';
        showToast(`Alias updated for ${assetId}`, 'success');
        
        // Update the payload if applicable
        if (window.updateDCPayload) window.updateDCPayload(dcAssetAliases);
    };
}

function renderAliasButtons() {
    const assetInput = document.getElementById('dcAssetIds');
    const container = document.getElementById('dcAliasButtonsContainer');
    if (!container) {
        const div = document.createElement('div');
        div.id = 'dcAliasButtonsContainer';
        div.style.marginTop = '10px';
        div.style.display = 'flex';
        div.style.flexWrap = 'wrap';
        div.style.gap = '8px';
        assetInput.parentNode.appendChild(div);
    }
    
    const ids = assetInput.value.split(/[\s,]+/).filter(id => id.length > 0);
    const containerRef = document.getElementById('dcAliasButtonsContainer');
    containerRef.innerHTML = '';
    
    ids.forEach(id => {
        const btn = document.createElement('button');
        const hasAlias = dcAssetAliases[id];
        btn.type = 'button';
        btn.innerHTML = `🏷️ Edit DC Label: ${id} ${hasAlias ? '✅' : ''}`;
        btn.style.padding = '4px 10px';
        btn.style.fontSize = '11px';
        btn.style.background = hasAlias ? '#f0fdf4' : '#f8fafc';
        btn.style.color = hasAlias ? '#166534' : '#475569';
        btn.style.border = `1px solid ${hasAlias ? '#bbf7d0' : '#e2e8f0'}`;
        btn.style.borderRadius = '4px';
        btn.style.cursor = 'pointer';
        
        btn.onclick = () => {
            const aliasModal = document.getElementById('dcAliasModal');
            aliasModal.dataset.assetId = id;
            document.getElementById('aliasInternalName').value = id;
            document.getElementById('aliasCustomName').value = hasAlias ? hasAlias.name : '';
            document.getElementById('aliasCustomDescription').value = hasAlias ? hasAlias.desc : '';
            aliasModal.style.display = 'flex';
        };
        
        containerRef.appendChild(btn);
    });
}

// Expose aliases to global scope for the final DC generation
if (window) window.getDCAliases = () => dcAssetAliases;

/**
 * Fetch Purchase Order (procurement module) and auto-populate the DC form.
 * Uses GET /api/procurement/pos?q= — same Purchase Orders as the PO tab.
 */
export function initDCPoFetcher() {
    const searchInput = document.getElementById('dcPoSearch');
    const resultsContainer = document.getElementById('dcPoSearchResults');
    const linkedBox = document.getElementById('dcPoLinked');
    const linkedLabel = document.getElementById('dcPoLinkedLabel');
    const clearBtn = document.getElementById('dcPoClear');

    if (!searchInput || !resultsContainer) {
        console.warn('DC PO Fetcher: Elements not found');
        return;
    }

    let debounceTimer;

    function authHeaders() {
        const token = localStorage.getItem('token');
        const headers = {};
        if (token && token !== 'null' && token !== 'undefined') {
            headers.Authorization = `Bearer ${token}`;
        }
        return headers;
    }

    function toDateInputValue(val) {
        if (val == null || val === '') return '';
        const s = String(val).trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
        const d = new Date(s);
        if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
        return s;
    }

    function setVal(id, val) {
        const el = document.getElementById(id);
        if (el) {
            el.value = el.type === 'date' ? toDateInputValue(val) : (val || '');
            if (id === 'dcRefDate' && el.value) {
                window.tempDCOrderDate = el.value;
            }
            el.dispatchEvent(new Event('input'));
            el.dispatchEvent(new Event('change'));
        }
    }

    function showLinked(po) {
        if (linkedBox && linkedLabel) {
            linkedLabel.textContent = po.poNumber || po.PONumber || po.id || po.ID || '—';
            linkedBox.style.display = 'block';
        }
    }

    function clearLinked() {
        window.currentDC_POReference = null;
        window.__dcPoLinesCache = null;
        window.__dcPurchaseBooksCache = null;
        if (linkedBox) linkedBox.style.display = 'none';
        if (linkedLabel) linkedLabel.textContent = '';
        if (searchInput) searchInput.value = '';
        hidePurchaseBookPanel();
    }

    function hidePurchaseBookPanel() {
        const panel = document.getElementById('dcPurchaseBookPanel');
        const list = document.getElementById('dcPurchaseBookList');
        if (panel) panel.style.display = 'none';
        if (list) list.innerHTML = '';
    }

    async function loadPurchaseBooksForPo(poId) {
        const panel = document.getElementById('dcPurchaseBookPanel');
        const list = document.getElementById('dcPurchaseBookList');
        if (!panel || !list || !poId) {
            hidePurchaseBookPanel();
            return;
        }
        try {
            const response = await fetch(`/api/purchase-books/po-dc-books/${encodeURIComponent(poId)}`, { headers: authHeaders() });
            if (!response.ok) {
                const errBody = await response.json().catch(() => ({}));
                throw new Error(errBody.error || `Failed to load Purchase Books (${response.status})`);
            }
            const data = await response.json();
            const books = data.purchaseBooks || [];
            window.__dcPurchaseBooksCache = books;
            if (!books.length) {
                list.innerHTML = '<div style="font-size:12px;color:#78716c;">No posted Purchase Books with lines for this PO. Use “Add PO lines only”.</div>';
                panel.style.display = 'block';
                return;
            }
            list.innerHTML = books.map((book) => {
                const inv = escapeText(book.vendorInvoiceNo || book.id);
                const rem = Number(book.remainingDcQty || 0);
                const locked = rem <= 0;
                return `<label style="display:flex;align-items:flex-start;gap:8px;padding:6px 4px;border-bottom:1px solid #fef3c7;font-size:12px;cursor:${locked ? 'default' : 'pointer'};opacity:${locked ? 0.55 : 1};">
                    <input type="checkbox" class="dc-pb-check" value="${escapeText(book.id)}" ${locked ? 'disabled' : 'checked'} style="margin-top:2px;">
                    <span>
                        <strong>${inv}</strong>
                        <span style="color:#78716c;"> · remaining DC qty ${rem}</span>
                        <div style="color:#a8a29e;font-family:ui-monospace,monospace;font-size:10px;">${escapeText(book.id)}</div>
                    </span>
                </label>`;
            }).join('');
            panel.style.display = 'block';
        } catch (err) {
            list.innerHTML = `<div style="font-size:12px;color:#b91c1c;">${escapeText(err.message || 'Failed to load books')}</div>`;
            panel.style.display = 'block';
        }
    }

    function selectedBookIds() {
        return Array.from(document.querySelectorAll('#dcPurchaseBookList .dc-pb-check:checked'))
            .map((el) => el.value)
            .filter(Boolean);
    }

    document.getElementById('btnDcAddSelectedBooks')?.addEventListener('click', (e) => {
        e.preventDefault();
        const ids = selectedBookIds();
        if (!ids.length) {
            if (typeof window.showToast === 'function') window.showToast('Select at least one Purchase Book', 'warning');
            return;
        }
        const books = (window.__dcPurchaseBooksCache || []).filter((b) => ids.includes(b.id));
        const lines = [];
        for (const book of books) {
            for (const line of book.lines || []) {
                if (Number(line.remainingDcQty) <= 0) continue;
                lines.push({
                    ...line,
                    purchaseBookId: book.id,
                    vendorInvoiceNo: book.vendorInvoiceNo
                });
            }
        }
        if (!lines.length) {
            if (typeof window.showToast === 'function') window.showToast('Selected books have no remaining DC-able qty', 'warning');
            return;
        }
        if (typeof window.addPurchaseBookLinesToDC === 'function') {
            const added = window.addPurchaseBookLinesToDC(lines);
            if (typeof window.showToast === 'function') {
                if (added > 0) {
                    window.showToast(`Added ${added} line${added === 1 ? '' : 's'} from Purchase Book${books.length > 1 ? 's' : ''}`, 'success');
                } else {
                    window.showToast('No new lines added — check physical links on the book, or lines already on the DC', 'warning');
                }
            }
        }
    });

    document.getElementById('btnDcAddPoLinesOnly')?.addEventListener('click', (e) => {
        e.preventDefault();
        const lines = window.__dcPoLinesCache || [];
        const poNumber = window.currentDC_POReference?.PONumber;
        if (!lines.length) {
            if (typeof window.showToast === 'function') window.showToast('No PO lines available', 'warning');
            return;
        }
        if (typeof window.addPoLinesToDC === 'function') {
            const added = window.addPoLinesToDC(lines, { poNumber });
            if (typeof window.showToast === 'function') {
                window.showToast(`Added ${added} PO line${added === 1 ? '' : 's'} (no book)`, 'success');
            }
        }
    });

    clearBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        clearLinked();
    });

    searchInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        const query = searchInput.value.trim();
        if (query.length < 2) {
            resultsContainer.style.display = 'none';
            return;
        }
        debounceTimer = setTimeout(() => fetchPurchaseOrders(query), 300);
    });

    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !resultsContainer.contains(e.target)) {
            resultsContainer.style.display = 'none';
        }
    });

    async function fetchPurchaseOrders(query) {
        try {
            const params = new URLSearchParams({ q: query, limit: '20' });
            const response = await fetch(`/api/procurement/pos?${params.toString()}`, { headers: authHeaders() });
            if (!response.ok) {
                const errBody = await response.json().catch(() => ({}));
                throw new Error(errBody.error || `Purchase Order search failed (${response.status})`);
            }
            const data = await response.json();
            const rows = data.purchaseOrders || [];
            renderPoResults(rows);
        } catch (err) {
            console.error('DC PO search error:', err);
            resultsContainer.innerHTML = `<div style="padding:10px;color:#b91c1c;">${escapeText(err.message || 'Search failed')}</div>`;
            resultsContainer.style.display = 'block';
        }
    }

    function renderPoResults(rows) {
        resultsContainer.innerHTML = '';
        if (!rows.length) {
            resultsContainer.innerHTML = '<div style="padding:10px;color:#999;">No matching Purchase Orders</div>';
            resultsContainer.style.display = 'block';
            return;
        }
        rows.slice(0, 12).forEach((po) => {
            const div = document.createElement('div');
            div.style.padding = '8px 12px';
            div.style.cursor = 'pointer';
            div.style.borderBottom = '1px solid #eee';
            div.style.fontSize = '13px';
            const poNo = po.poNumber || po.id;
            const vendor = po.vendorName || '—';
            const source = po.source === 'LOCAL' ? 'Legacy' : 'Zoho';
            const status = po.status || '';
            div.innerHTML = `<strong>${escapeText(poNo)}</strong>
                <span style="color:#666;font-size:11px;"> · ${escapeText(source)}${status ? ` · ${escapeText(status)}` : ''}</span><br>
                <span style="color:#888;font-size:11px;">Vendor: ${escapeText(vendor)}${po.subject ? ` · ${escapeText(po.subject)}` : ''}</span>`;
            div.addEventListener('mouseenter', () => { div.style.background = '#ecfdf5'; });
            div.addEventListener('mouseleave', () => { div.style.background = 'white'; });
            div.onclick = () => {
                selectPurchaseOrder(po).catch((err) => {
                    if (typeof window.showToast === 'function') window.showToast(err.message || 'Failed to load PO', 'error');
                });
            };
            resultsContainer.appendChild(div);
        });
        resultsContainer.style.display = 'block';
    }

    async function selectPurchaseOrder(summary, opts = {}) {
        resultsContainer.style.display = 'none';
        searchInput.value = '';

        if (summary.source === 'LOCAL') {
            const response = await fetch(`/api/orders/${encodeURIComponent(summary.id)}`, { headers: authHeaders() });
            if (!response.ok) throw new Error(`Failed to load Purchase Order (${response.status})`);
            const data = await response.json();
            const order = data.orders?.[0] || data.data?.[0] || data;
            applyLegacyPoToDcForm(order, summary);
            showLinked({ poNumber: order.PONumber || order.ponumber || summary.poNumber, id: summary.id });
            return;
        }

        const response = await fetch(`/api/procurement/pos/${encodeURIComponent(summary.id)}`, { headers: authHeaders() });
        if (!response.ok) {
            const errBody = await response.json().catch(() => ({}));
            throw new Error(errBody.error || `Failed to load Purchase Order (${response.status})`);
        }
        const data = await response.json();
        const po = data.purchaseOrder || summary;
        applyProcurementPoToDcForm(po, opts);
        showLinked(po);
    }

    window.linkDcToProcurementPo = (summary, opts = {}) => selectPurchaseOrder(summary, opts);

    function applyProcurementPoToDcForm(po, opts = {}) {
        const poNumber = po.poNumber || po.id;
        setVal('dcBuyerOrderNo', poNumber);
        setVal('dcRefDate', po.poDate || '');
        setVal('dcRefNo', po.subject || '');
        setVal('dcOtherReferences', po.vendorName ? `Vendor: ${po.vendorName}` : '');

        if (po.poDate) window.tempDCOrderDate = po.poDate;

        window.currentDC_POReference = {
            ProcurementPoId: po.id,
            PONumber: poNumber,
            ZohoPoId: po.zohoPoId || null,
            Source: po.source || 'ZOHO',
            ProjectID: po.projectId || null
        };

        const lines = Array.isArray(po.lines) ? po.lines : [];
        window.__dcPoLinesCache = lines;

        // Do not auto-seed lines — operator chooses books and/or PO lines.
        loadPurchaseBooksForPo(po.id).then(() => {
            if (opts.preferBooks && typeof window.showToast === 'function') {
                window.showToast(`DC linked to PO ${poNumber} — select Purchase Books (A2), then Add selected books`, 'success');
            } else if (typeof window.showToast === 'function') {
                window.showToast(`DC linked to PO ${poNumber} — pick Purchase Books or add PO lines (A1)`, 'success');
            }
        });
    }

    function applyLegacyPoToDcForm(order, summary) {
        setVal('dcCustomerName', order.ConsigneeName || order.BuyerName);
        setVal('dcBuyerOrderNo', order.PONumber || order.OrderNo || summary.poNumber);
        setVal('dcRefDate', order.PODate || order.OrderDate);
        setVal('dcRefNo', order.ProjectName || '');

        setVal('dcConsigneeName', order.ConsigneeName);
        setVal('dcConsigneeAddress', order.ConsigneeAddress);
        setVal('dcConsigneeGST', order.ConsigneeGSTIN);
        setVal('dcConsigneeState', order.ConsigneeState);
        setVal('dcConsigneeStateCode', order.ConsigneeStateCode);

        setVal('dcBuyerName', order.BuyerName);
        setVal('dcBuyerAddress', order.BuyerAddress);
        setVal('dcBuyerGST', order.BuyerGSTIN);
        setVal('dcBuyerState', order.BuyerState);
        setVal('dcBuyerStateCode', order.BuyerStateCode);

        if (order.OrderDate || order.PODate) {
            window.tempDCOrderDate = order.PODate || order.OrderDate;
        }

        const poNumber = order.PONumber || order.OrderNo || summary.poNumber;
        window.currentDC_POReference = {
            OrderID: order.ID || summary.id,
            ProcurementPoId: null,
            PONumber: poNumber,
            Source: 'LOCAL',
            ProjectID: order.ProjectID || order.projectid || summary.projectId || null
        };

        const legacyLines = (order.items || order.Items || []).map((item) => ({
            id: item.ID || item.id,
            description: item.ItemDescription || item.itemdescription || item.description,
            ordered: item.Quantity || item.quantity || item.Qty || 1,
            unit: item.Unit || item.unit || 'NO',
            listPrice: item.Rate || item.rate || item.Price || null,
            lineStatus: item.Status || item.status || 'OPEN'
        }));
        let added = 0;
        if (typeof window.addPoLinesToDC === 'function' && legacyLines.length) {
            added = window.addPoLinesToDC(legacyLines, { poNumber });
        }

        if (typeof window.showToast === 'function') {
            window.showToast(
                added > 0
                    ? `DC form filled from PO ${poNumber} — ${added} line${added === 1 ? '' : 's'} added`
                    : `DC form filled from Purchase Order ${poNumber}`,
                'success'
            );
        }
    }

    function escapeText(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    if (window.currentDC_POReference?.PONumber) {
        showLinked(window.currentDC_POReference);
    }
}
