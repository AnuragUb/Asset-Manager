/**
 * Sample-data lifecycle test run (Physical Intake → PO Receipt → DCs).
 *
 * Usage (inside asset-manager-prod container):
 *   node scripts/sample-lifecycle-testrun.js
 *
 * Env:
 *   ZOHO_PO_ID   default 1205624000001535001 (Assetori Sampler)
 *   HTTP_PORT    default 8080 (DC create via local HTTP)
 *   DRY_RUN=1    discover only
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const jwt = require('jsonwebtoken');
const { db } = require('../utils');
const physicalIntakeService = require('../services/physicalIntakeService');
const procurementService = require('../services/procurementService');
const receiptService = require('../services/receiptService');

const ACTOR = 'sample-lifecycle-testrun';
const ZOHO_PO_ID = String(process.env.ZOHO_PO_ID || '1205624000001535001').trim();
const HTTP_PORT = Number(process.env.HTTP_PORT || 8080);
const DRY_RUN = String(process.env.DRY_RUN || '') === '1';
const REPORT_PATH = path.join(
  __dirname,
  'reports',
  `sample-lifecycle-testrun-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
);

function stamp() {
  return new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
}

function mintToken() {
  const secret = process.env.JWT_SECRET || 'change-this-secret-in-production';
  return jwt.sign(
    {
      user_id: 'admin',
      username: ACTOR,
      role: 'superuser',
      company_id: '25451fa6-82a7-414b-9b40-341bcd1b7286'
    },
    secret,
    { expiresIn: '90m' }
  );
}

function request(method, apiPath, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: HTTP_PORT,
        path: apiPath,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
        }
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch (_e) {
            json = null;
          }
          resolve({ status: res.statusCode, json, text: text.slice(0, 4000) });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function pickProduct(preferNameHint) {
  const rows = await db('product')
    .whereRaw("UPPER(COALESCE(status,'')) <> 'ARCHIVED'")
    .orderBy('updated_at', 'desc')
    .limit(50)
    .select('id', 'name', 'unit', 'make', 'model', 'status');
  if (!rows.length) throw new Error('No active products found');
  const hint = String(preferNameHint || '').toLowerCase();
  const hit = hint
    ? rows.find((r) => String(r.name || '').toLowerCase().includes(hint))
    : null;
  return hit || rows[0];
}

async function pickHierarchy(resourceType) {
  const type = String(resourceType || 'ASSET').toUpperCase();
  if (type === 'INVENTORY') {
    const inv = await db('inventory_items')
      .whereNotNull('folderid')
      .whereNotNull('kindid')
      .where(function () {
        this.whereNull('is_deleted').orWhere('is_deleted', 0);
      })
      .orderBy('lastupdated', 'desc')
      .first('folderid', 'kindid', 'type', 'category');
    if (inv && inv.folderid && inv.kindid) {
      return {
        folderId: String(inv.folderid),
        kindId: String(inv.kindid),
        type: inv.type || null,
        category: inv.category || null,
        parentFolder: null
      };
    }
    const kind = await db('inventory_kinds')
      .where(function () {
        this.whereNull('is_deleted').orWhere('is_deleted', 0);
      })
      .whereNotNull('folderid')
      .orderBy('lastupdated', 'desc')
      .first();
    if (!kind) throw new Error('No inventory kinds found');
    return {
      folderId: String(kind.folderid),
      kindId: String(kind.id),
      type: kind.name || 'Inventory',
      category: kind.name || 'Inventory',
      parentFolder: null
    };
  }

  // Assets: hierarchy is folders + asset_kinds (kind key = name)
  const asset = await db('assets')
    .whereNotNull('type')
    .whereNotNull('parent_folder')
    .where(function () {
      this.whereNull('is_set').orWhere('is_set', 0);
    })
    .where(function () {
      this.whereNull('is_deleted').orWhere('is_deleted', 0);
    })
    .orderBy('lastupdated', 'desc')
    .first('type', 'category', 'parent_folder');
  const folder = asset
    ? await db('asset_folders').where({ name: asset.parent_folder }).first()
    : await db('asset_folders').where({ name: 'Cineom Assets' }).first()
      || await db('asset_folders').orderBy('timestamp', 'asc').first();
  if (!folder) throw new Error('No asset folders found');
  const kindName = (asset && asset.type) || 'Hardware';
  return {
    folderId: String(folder.id),
    kindId: String(kindName),
    type: kindName,
    category: (asset && asset.category) || folder.module || 'IT',
    parentFolder: folder.name || asset?.parent_folder || null
  };
}

function intakeOutput(result) {
  const intake = result.intake || result;
  const outputs = intake.outputs || result.outputs || [];
  const first = outputs[0] || {};
  return {
    intakeId: intake.id || result.id,
    resourceType: first.resourceType || intake.holdingType || null,
    resourceId: first.resourceId || null,
    quantity: first.quantity != null ? first.quantity : intake.quantity
  };
}

async function createIntake({ holdingType, product, hierarchy, tag }) {
  const body = {
    holdingType,
    intakeType: 'OPENING_BALANCE',
    productId: product.id,
    quantity: holdingType === 'INVENTORY' ? 5 : 1,
    unit: product.unit || 'Nos',
    reason: `Sample lifecycle testrun ${tag} ${stamp()}`,
    location: 'Mumbai',
    folderId: hierarchy.folderId,
    kindId: hierarchy.kindId,
    type: hierarchy.type || undefined,
    category: hierarchy.category || (holdingType === 'ASSET' ? 'IT' : hierarchy.type) || undefined,
    parentFolder: hierarchy.parentFolder || undefined,
    actor: ACTOR,
    host: 'http://127.0.0.1:8080',
    idempotencyKey: `sample-pi-${holdingType.toLowerCase()}-${stamp()}`.slice(0, 64),
    commercialChoice: 'EXPECTED',
    expectedPoNumber: 'SAMPLE-LIFECYCLE'
  };
  const result = await physicalIntakeService.createPhysicalIntake(body);
  return { request: body, result: intakeOutput(result), raw: result };
}

async function importAndReceipt(token, report) {
  const imported = await procurementService.importPurchaseOrder(ZOHO_PO_ID, ACTOR);
  const po = imported.po || imported.purchaseOrder || imported;
  report.poImport = {
    id: po.id || po.poId || null,
    zohoPoId: po.zoho_po_id || po.zohoPoId || ZOHO_PO_ID,
    poNumber: po.po_number || po.ponumber || po.poNumber || null,
    status: po.status || null,
    lineCount: Array.isArray(po.lines) ? po.lines.length : null
  };

  const poId = String(po.id || '').trim();
  if (!poId) throw new Error(`PO import did not return local id: keys=${Object.keys(imported || {})}`);

  const full = await procurementService.getPurchaseOrder(poId);
  const lines = (full && full.lines) || [];
  if (!lines.length) throw new Error(`PO ${poId} has no lines`);

  // Prefer one receivable mapped line with remaining qty
  let chosen = null;
  for (const line of lines) {
    const lineId = line.id || line.lineId;
    const productId = line.product_id || line.productId;
    const qtyInfo = line.quantities || {};
    const ordered = Number(
      qtyInfo.ordered ?? line.qty_ordered ?? line.qtyOrdered ?? line.qtyordered ?? line.quantity ?? 0
    );
    const accepted = Number(qtyInfo.acceptedToDate ?? line.qty_received ?? line.qtyReceived ?? 0);
    const remaining = Number(qtyInfo.outstanding ?? (ordered - accepted));
    if (productId && remaining > 0) {
      chosen = { line, lineId, productId, remaining, ordered };
      break;
    }
  }
  if (!chosen) {
    const line = lines.find((l) => l.product_id || l.productId) || lines[0];
    chosen = {
      line,
      lineId: line.id || line.lineId,
      productId: line.product_id || line.productId,
      remaining: 1,
      ordered: Number(line.qty_ordered ?? line.qtyOrdered ?? 1)
    };
  }
  if (!chosen.productId) {
    throw new Error(`Chosen PO line ${chosen.lineId} has no mapped product_id — map Product before receiving`);
  }

  const hierarchy = await pickHierarchy('ASSET');
  const qty = Math.min(1, Math.max(1, Number(chosen.remaining) || 1));
  const createBody = {
    poSource: 'ZOHO',
    poId,
    vendorInvoiceNo: `SAMPLE-VI-${stamp()}`,
    deliveryNoteNo: `SAMPLE-DN-${stamp()}`,
    receivedAtLocation: 'Mumbai',
    receivedBy: ACTOR,
    actor: ACTOR,
    idempotencyKey: `sample-rn-${stamp()}`.slice(0, 64),
    lines: [
      {
        poLineId: chosen.lineId,
        productId: chosen.productId,
        qtyAccepted: qty,
        qtyRejected: 0,
        qtyDamaged: 0,
        qtyReceived: qty,
        unit: chosen.line.uom || chosen.line.unit || 'Nos',
        creationMode: 'ASSET_INDIVIDUAL',
        folderId: hierarchy.folderId,
        kindId: hierarchy.kindId,
        notes: 'Sample lifecycle receipt line'
      }
    ]
  };

  const note = await receiptService.createReceiptNote(createBody);
  const noteId = note.receiptNote?.id || note.id || (note.note && note.note.id);
  if (!noteId) throw new Error(`createReceiptNote returned no id: keys=${Object.keys(note || {})}`);
  report.receiptCreate = {
    id: noteId,
    status: note.receiptNote?.status || note.status,
    poId,
    lineId: chosen.lineId,
    productId: chosen.productId,
    qty
  };

  const posted = await receiptService.postReceipt(noteId, {
    actor: ACTOR,
    host: 'http://127.0.0.1:8080',
    idempotencyKey: `sample-rn-post-${stamp()}`.slice(0, 64)
  });
  const outputs = (posted.outputs || [])
    .map((o) => ({
      resourceType: o.resourceType || o.resource_type,
      resourceId: o.resourceId || o.resource_id,
      quantity: o.quantity
    }));
  report.receiptPost = {
    id: noteId,
    status: posted.receiptNote?.status || posted.status,
    outputs
  };
  return { noteId, outputs, po, full, hierarchy };
}

async function createDc(token, { customerName, deliveryDate, holdingIds, poReference, tag }) {
  const items = [];
  for (const hid of holdingIds) {
    const asset = await db('assets').whereRaw('LOWER(id) = LOWER(?)', [hid]).first();
    if (asset) {
      items.push({
        assetId: asset.id,
        description: asset.itemname || asset.id,
        srNo: asset.srno || '',
        hsn: '',
        qty: 1,
        per: 'NO',
        rate: '',
        amount: ''
      });
      continue;
    }
    const inv = await db('inventory_items').whereRaw('LOWER(id) = LOWER(?)', [hid]).first();
    if (inv) {
      items.push({
        assetId: inv.id,
        description: inv.itemname || inv.id,
        srNo: inv.srno || '',
        hsn: '',
        qty: 1,
        per: 'NO',
        rate: '',
        amount: '',
        resourceType: 'INVENTORY'
      });
    }
  }
  const body = {
    CustomerName: customerName,
    DeliveryDate: deliveryDate,
    AssetIds: holdingIds,
    CreatedBy: ACTOR,
    POReference: poReference || null,
    payload: {
      company: {},
      consignee: { name: customerName },
      buyer: { name: customerName },
      meta: {
        dated: deliveryDate,
        referenceNo: tag,
        remarks: `Sample lifecycle DC — ${tag}`
      },
      items
    }
  };
  const res = await request('POST', '/api/dc', { token, body });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`DC create failed (${tag}): HTTP ${res.status} ${res.text}`);
  }
  return {
    http: res.status,
    id: res.json && (res.json.id || (res.json.dc && res.json.dc.id)),
    challanNo: res.json && (res.json.challanNo || res.json.challanno || (res.json.dc && res.json.dc.challanno)),
    holdings: holdingIds
  };
}

async function main() {
  const report = {
    startedAt: new Date().toISOString(),
    zohoPoId: ZOHO_PO_ID,
    dryRun: DRY_RUN,
    steps: {}
  };

  const dbName = (await db.raw('SELECT current_database() AS name')).rows[0].name;
  report.database = dbName;
  console.log(`[sample-lifecycle] database=${dbName} zohoPo=${ZOHO_PO_ID}`);

  const productAsset = await pickProduct('assetori');
  const productInv = await pickProduct(null);
  const hierAsset = await pickHierarchy('ASSET');
  const hierInv = await pickHierarchy('INVENTORY');
  report.discovery = {
    productAsset: { id: productAsset.id, name: productAsset.name },
    productInv: { id: productInv.id, name: productInv.name },
    hierAsset,
    hierInv
  };
  console.log('[sample-lifecycle] products', productAsset.id, '/', productInv.id);

  if (DRY_RUN) {
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    console.log('[sample-lifecycle] DRY_RUN report', REPORT_PATH);
    return;
  }

  // 1) Physical intakes
  const piAsset = await createIntake({
    holdingType: 'ASSET',
    product: productAsset,
    hierarchy: hierAsset,
    tag: 'ASSET'
  });
  report.steps.physicalIntakeAsset = {
    intakeId: piAsset.result.intakeId,
    resourceId: piAsset.result.resourceId,
    resourceType: piAsset.result.resourceType,
    productId: productAsset.id
  };
  console.log('[sample-lifecycle] PI ASSET', piAsset.result.intakeId, '→', piAsset.result.resourceId);

  const piInv = await createIntake({
    holdingType: 'INVENTORY',
    product: productInv.id === productAsset.id ? productInv : productInv,
    hierarchy: hierInv,
    tag: 'INVENTORY'
  });
  report.steps.physicalIntakeInventory = {
    intakeId: piInv.result.intakeId,
    resourceId: piInv.result.resourceId,
    resourceType: piInv.result.resourceType,
    productId: productInv.id
  };
  console.log('[sample-lifecycle] PI INVENTORY', piInv.result.intakeId, '→', piInv.result.resourceId);

  // 2–3) Import PO + one Receipt Note (posted)
  const token = mintToken();
  const receipt = await importAndReceipt(token, report.steps);
  console.log('[sample-lifecycle] RN', report.steps.receiptCreate.id, 'outputs', report.steps.receiptPost.outputs);

  const today = new Date().toISOString().slice(0, 10);
  const receiptHoldingIds = (report.steps.receiptPost.outputs || [])
    .map((o) => o.resourceId)
    .filter(Boolean);

  // 4a) DC from receipt holdings
  if (!receiptHoldingIds.length) {
    throw new Error('Receipt post produced no holdings for DC-from-receipt');
  }
  const dcFromReceipt = await createDc(token, {
    customerName: 'Sample Lifecycle Customer (Receipt)',
    deliveryDate: today,
    holdingIds: receiptHoldingIds.slice(0, 3),
    poReference: report.steps.poImport
      ? { OrderID: report.steps.poImport.id, PONumber: report.steps.poImport.poNumber }
      : null,
    tag: 'FROM-RECEIPT'
  });
  report.steps.dcFromReceipt = dcFromReceipt;
  console.log('[sample-lifecycle] DC from RN', dcFromReceipt.challanNo || dcFromReceipt.id);

  // 4b) DC from physical-intake asset + inventory
  const intakeHoldings = [piAsset.result.resourceId, piInv.result.resourceId].filter(Boolean);
  const dcFromIntake = await createDc(token, {
    customerName: 'Sample Lifecycle Customer (Intake)',
    deliveryDate: today,
    holdingIds: intakeHoldings,
    tag: 'FROM-INTAKE'
  });
  report.steps.dcFromIntake = dcFromIntake;
  console.log('[sample-lifecycle] DC from Intake', dcFromIntake.challanNo || dcFromIntake.id);

  report.finishedAt = new Date().toISOString();
  report.ok = true;
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log('[sample-lifecycle] DONE report', REPORT_PATH);
  console.log(JSON.stringify({
    ok: true,
    database: report.database,
    physicalIntakeAsset: report.steps.physicalIntakeAsset,
    physicalIntakeInventory: report.steps.physicalIntakeInventory,
    receipt: report.steps.receiptCreate,
    receiptOutputs: report.steps.receiptPost.outputs,
    dcFromReceipt,
    dcFromIntake
  }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    const fail = {
      ok: false,
      error: err.message,
      reasonCode: err.reasonCode || null,
      statusCode: err.statusCode || null,
      stack: String(err.stack || '').split('\n').slice(0, 12)
    };
    console.error('[sample-lifecycle] FAILED', JSON.stringify(fail, null, 2));
    try {
      fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
      fs.writeFileSync(REPORT_PATH, JSON.stringify(fail, null, 2));
    } catch (_e) { /* ignore */ }
    try { await db.destroy(); } catch (_e) { /* ignore */ }
    process.exit(1);
  });
