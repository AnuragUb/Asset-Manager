/**
 * Phase 8 production close-out live cycle.
 * Mutates only: one new ASSETENGINE Product, one new canonical Set, their Zoho mappings.
 */
const http = require('http');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const { db } = require('../../utils');

function request(method, path, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port: 8080,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (e) { json = null; }
        resolve({ status: res.statusCode, json, text: text.slice(0, 4000) });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function snap() {
  const q = async (sql) => (await db.raw(sql)).rows[0];
  return {
    product: Number((await q('SELECT count(*)::int AS n FROM product')).n),
    mappings: Number((await q('SELECT count(*)::int AS n FROM product_external_ref')).n),
    catalog: Number((await q('SELECT count(*)::int AS n FROM zoho_catalog')).n),
    logs: Number((await q('SELECT count(*)::int AS n FROM zoho_sync_logs')).n),
    assets: Number((await q('SELECT count(*)::int AS n FROM assets')).n),
    inventory: Number((await q('SELECT count(*)::int AS n FROM inventory_items')).n),
    reservations: Number((await q('SELECT count(*)::int AS n FROM reservation')).n),
    conversions: Number((await q('SELECT count(*)::int AS n FROM conversion')).n),
    receipts: Number((await q('SELECT count(*)::int AS n FROM receipt_note')).n),
    sets: Number((await q('SELECT count(*)::int AS n FROM managed_sets')).n),
    requirements: Number((await q('SELECT count(*)::int AS n FROM set_requirement')).n),
    setEvents: Number((await q('SELECT count(*)::int AS n FROM set_event')).n),
    pos: Number((await q('SELECT count(*)::int AS n FROM project_orders')).n),
    poLines: Number((await q('SELECT count(*)::int AS n FROM project_order_items')).n),
    assetZoho: (await db.raw(`
      SELECT coalesce(md5(string_agg(id || '|' || coalesce(zoho_product_id,''), ',' ORDER BY id)), '') AS checksum,
             count(*) FILTER (WHERE zoho_product_id IS NOT NULL AND zoho_product_id <> '')::int AS n
      FROM assets
    `)).rows[0],
    inventoryQty: (await db.raw(`
      SELECT coalesce(md5(string_agg(id || '|' || coalesce(quantity_total::text,'') || '|' || coalesce(quantity_available::text,'') || '|' || coalesce(quantity_reserved::text,''), ',' ORDER BY id)), '') AS checksum
      FROM inventory_items
    `)).rows[0].checksum,
    assetQty: (await db.raw(`
      SELECT coalesce(md5(string_agg(id || '|' || coalesce(quantity_total::text,'') || '|' || coalesce(quantity_available::text,'') || '|' || coalesce(quantity_reserved::text,'') || '|' || coalesce(parentid,'') || '|' || coalesce(is_set::text,''), ',' ORDER BY id)), '') AS checksum
      FROM assets
    `)).rows[0].checksum
  };
}

async function main() {
  const secret = process.env.JWT_SECRET || 'change-this-secret-in-production';
  const token = jwt.sign(
    { user_id: 'admin', role: 'superuser', company_id: '25451fa6-82a7-414b-9b40-341bcd1b7286' },
    secret,
    { expiresIn: '40m' }
  );
  const report = { steps: [] };
  const before = await snap();
  report.before = before;

  const status = await request('GET', '/api/zoho/status', { token });
  report.oauthLive = {
    http: status.status,
    health: status.json && status.json.health && status.json.health.status,
    scopes: status.json && status.json.oauth && status.json.oauth.scopes
  };
  if (status.status !== 200 || !status.json || status.json.health.status !== 'CONNECTED') {
    report.stop = 'OAuth live status not CONNECTED';
    fs.writeFileSync('/app/web-app/asset-manager-backend/scripts/reports/phase8-prod-live-cycle.json', JSON.stringify(report, null, 2));
    throw new Error(report.stop);
  }

  const created = await request('POST', '/api/products', {
    token,
    body: {
      name: 'AE Phase8 Close-out Probe',
      description: 'AssetEngine Phase 8 close-out description',
      make: 'AETest',
      model: 'P8',
      hsn_code: '8525',
      unit: 'Nos',
      product_code: 'AE-P8-CLOSEOUT'
    }
  });
  report.productCreate = { http: created.status, product: created.json && created.json.product };
  if (created.status !== 200 && created.status !== 201) {
    report.stop = 'Product create failed';
    fs.writeFileSync('/app/web-app/asset-manager-backend/scripts/reports/phase8-prod-live-cycle.json', JSON.stringify(report, null, 2));
    throw new Error(`${report.stop} ${created.status} ${created.text}`);
  }
  const product = created.json.product;
  report.selected = {
    id: product.id,
    name: product.name,
    description: product.description,
    make: product.make,
    model: product.model,
    hsn_code: product.hsn_code,
    unit: product.unit,
    product_code: product.product_code,
    price: product.price,
    origin: product.origin,
    status: product.status,
    mappingBefore: null
  };

  const pub1 = await request('POST', `/api/products/${encodeURIComponent(product.id)}/publish`, { token });
  report.publish1 = { http: pub1.status, body: pub1.json };
  if (pub1.status !== 200 || !pub1.json || pub1.json.success !== true) {
    report.stop = 'Live product publish failed';
    fs.writeFileSync('/app/web-app/asset-manager-backend/scripts/reports/phase8-prod-live-cycle.json', JSON.stringify(report, null, 2));
    throw new Error(`${report.stop} ${pub1.status} ${pub1.text}`);
  }

  const pub2 = await request('POST', `/api/products/${encodeURIComponent(product.id)}/publish`, { token });
  report.publish2 = { http: pub2.status, body: pub2.json };
  if (pub2.status !== 200 || !pub2.json || pub2.json.success !== true) {
    report.stop = 'Repeat product publish failed';
    fs.writeFileSync('/app/web-app/asset-manager-backend/scripts/reports/phase8-prod-live-cycle.json', JSON.stringify(report, null, 2));
    throw new Error(`${report.stop} ${pub2.status} ${pub2.text}`);
  }

  const refresh = await request('POST', `/api/products/${encodeURIComponent(product.id)}/refresh-zoho`, { token });
  report.refresh = { http: refresh.status, body: refresh.json };

  const mapping = await request('GET', `/api/products/${encodeURIComponent(product.id)}/external-refs`, { token });
  report.mappingAfter = mapping.json && mapping.json.refs;

  const setCreate = await request('POST', '/api/sets', {
    token,
    body: {
      name: 'AE Phase8 Close-out Canonical Set',
      description: 'Disposable canonical Set for Phase 8 close-out. Do not treat as operational.',
      requirements: [{ productId: 'PRD-0826-QN1EIW-T', quantity: 1 }]
    }
  });
  report.setCreate = { http: setCreate.status, set: setCreate.json && setCreate.json.set };
  if (setCreate.status !== 200 && setCreate.status !== 201) {
    report.stop = 'Set create failed';
    fs.writeFileSync('/app/web-app/asset-manager-backend/scripts/reports/phase8-prod-live-cycle.json', JSON.stringify(report, null, 2));
    throw new Error(`${report.stop} ${setCreate.status} ${setCreate.text}`);
  }
  const setId = setCreate.json.set.id;

  const preview = await request('GET', `/api/sets/${encodeURIComponent(setId)}/commercialize/preview`, { token });
  report.setPreview = { http: preview.status, preview: preview.json && preview.json.preview };
  if (preview.status !== 200) {
    report.stop = 'Set commercialize preview failed';
    fs.writeFileSync('/app/web-app/asset-manager-backend/scripts/reports/phase8-prod-live-cycle.json', JSON.stringify(report, null, 2));
    throw new Error(`${report.stop} ${preview.status} ${preview.text}`);
  }

  const comm = await request('POST', `/api/sets/${encodeURIComponent(setId)}/commercialize`, { token, body: {} });
  report.setCommercialize = { http: comm.status, body: comm.json };
  if (comm.status !== 200 || !comm.json || comm.json.success !== true) {
    report.stop = 'Set commercialize failed';
    fs.writeFileSync('/app/web-app/asset-manager-backend/scripts/reports/phase8-prod-live-cycle.json', JSON.stringify(report, null, 2));
    throw new Error(`${report.stop} ${comm.status} ${comm.text}`);
  }
  const setProductId = comm.json.product && comm.json.product.id;

  const setPub1 = await request('POST', `/api/products/${encodeURIComponent(setProductId)}/publish`, { token });
  report.setPublish1 = { http: setPub1.status, body: setPub1.json };
  if (setPub1.status !== 200 || !setPub1.json || setPub1.json.success !== true) {
    report.stop = 'Set product publish failed';
    fs.writeFileSync('/app/web-app/asset-manager-backend/scripts/reports/phase8-prod-live-cycle.json', JSON.stringify(report, null, 2));
    throw new Error(`${report.stop} ${setPub1.status} ${setPub1.text}`);
  }
  const setPub2 = await request('POST', `/api/products/${encodeURIComponent(setProductId)}/publish`, { token });
  report.setPublish2 = { http: setPub2.status, body: setPub2.json };

  const logs = await db('zoho_sync_logs').select('module', 'operation', 'status', 'local_id', 'zoho_id', 'payload', 'created_at')
    .whereIn('local_id', [product.id, setProductId])
    .orderBy('created_at', 'asc');
  report.syncLogs = logs.map((row) => {
    let payload = row.payload;
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); } catch (e) { payload = { raw: String(row.payload).slice(0, 500) }; }
    }
    return {
      module: row.module,
      operation: row.operation,
      status: row.status,
      localId: row.local_id,
      zohoId: row.zoho_id == null ? null : String(row.zoho_id),
      payloadKeys: payload && typeof payload === 'object' ? Object.keys(payload) : [],
      payload
    };
  });

  report.after = await snap();
  report.deltas = Object.fromEntries(Object.keys(before).filter((k) => typeof before[k] === 'number').map((k) => [k, report.after[k] - before[k]]));
  report.physical = {
    assetZohoChecksumUnchanged: before.assetZoho.checksum === report.after.assetZoho.checksum,
    assetQtyUnchanged: before.assetQty === report.after.assetQty,
    inventoryQtyUnchanged: before.inventoryQty === report.after.inventoryQty,
    assetZohoCountBefore: before.assetZoho.n,
    assetZohoCountAfter: report.after.assetZoho.n
  };

  fs.writeFileSync('/app/web-app/asset-manager-backend/scripts/reports/phase8-prod-live-cycle.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    oauth: report.oauthLive.health,
    productId: product.id,
    origin: product.origin,
    publish1: report.publish1.body && { mode: report.publish1.body.mode, skipped: report.publish1.body.skipped, zohoIdType: typeof (report.publish1.body.zohoId), zohoId: report.publish1.body.zohoId },
    publish2: report.publish2.body && { mode: report.publish2.body.mode, skipped: report.publish2.body.skipped, zohoId: report.publish2.body.zohoId },
    setId,
    setProductId,
    setPublish1: report.setPublish1.body && { mode: report.setPublish1.body.mode, skipped: report.setPublish1.body.skipped, zohoId: report.setPublish1.body.zohoId },
    setPublish2: report.setPublish2.body && { mode: report.setPublish2.body.mode, skipped: report.setPublish2.body.skipped, zohoId: report.setPublish2.body.zohoId },
    deltas: report.deltas,
    physical: report.physical
  }, null, 2));
}

main().catch(async (err) => {
  console.error('LIVE_CYCLE_FAILED', err.message);
  try { await db.destroy(); } catch (e) { /* ignore */ }
  process.exit(1);
}).then(async () => {
  try { await db.destroy(); } catch (e) { /* ignore */ }
});
