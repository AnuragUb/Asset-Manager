/**
 * Product Foundation backfill.
 *
 * Default mode is --dry-run (writes nothing).
 * --apply requires --database-name matching current_database().
 *
 * Classification is by explicit Zoho Product ID only.
 * No name / SKU / make / model matching.
 *
 * Expected production outcome:
 *   Class A ZOHO   ~200
 *   Class B ASSET    1  (HAR-MUM-0726-55QOFA-R / 1205624000001284002)
 *   Class C ESCALATE 1  (HAR-MUM-0826-IEIZP5-U / 1205624000001313001)
 *   Class D QUARANTINE 1 (ZP-SAMPLE-0001)
 */
const fs = require('fs');
const path = require('path');
const { db, generateProductId, verifyProductId } = require('../utils');

const ZOHO_SYSTEM = 'ZOHO_CRM';
const ZOHO_MODULE = 'Products';
const NUMERIC_ID = /^[0-9]+$/;
const ESCALATE_EXTERNAL_IDS = new Set(['1205624000001313001']);
const QUARANTINE_EXTERNAL_IDS = new Set(['ZP-SAMPLE-0001']);
const APPROVED_ASSET_LINK = 'HAR-MUM-0726-55QOFA-R';

function parseArgs(argv) {
  const args = { dryRun: true, apply: false, databaseName: null };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--apply') {
      args.apply = true;
      args.dryRun = false;
    } else if (token === '--dry-run') {
      args.dryRun = true;
      args.apply = false;
    } else if (token === '--database-name') {
      args.databaseName = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function newRefId() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).slice(2, 10).toUpperCase();
  return `PER-${stamp}-${rand}`;
}

function blankToNull(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function nonzeroPrice(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return null;
  return n;
}

function classifyCandidate(candidate) {
  const externalId = candidate.external_id;
  if (QUARANTINE_EXTERNAL_IDS.has(externalId) || !NUMERIC_ID.test(externalId)) {
    return {
      class: 'D',
      action: 'QUARANTINE',
      origin: null,
      reason: 'Non-numeric or seeded sample Zoho ID; not a real Zoho Product'
    };
  }
  if (ESCALATE_EXTERNAL_IDS.has(externalId)) {
    return {
      class: 'C',
      action: 'ESCALATE',
      origin: null,
      reason: 'Legacy Set/Asset anomaly HAR-MUM-0826-IEIZP5-U; deferred to Set phase'
    };
  }
  if (candidate.assets.length && !candidate.catalog) {
    return {
      class: 'C',
      action: 'ESCALATE',
      origin: null,
      reason: 'Zoho Product ID present on an Asset but absent from zoho_catalog'
    };
  }
  if (candidate.assets.length && candidate.catalog) {
    const setAssets = candidate.assets.filter((a) => Number(a.is_set) === 1);
    if (setAssets.length) {
      return {
        class: 'C',
        action: 'ESCALATE',
        origin: null,
        reason: 'Asset row with is_set=1; do not classify as ASSET or SET in Phase 1'
      };
    }
    return {
      class: 'B',
      action: 'CREATE',
      origin: 'ASSET',
      reason: 'Round-tripped AssetEngine asset present in zoho_catalog'
    };
  }
  if (candidate.catalog && !candidate.assets.length) {
    return {
      class: 'A',
      action: 'CREATE',
      origin: 'ZOHO',
      reason: 'Numeric zoho_catalog row with no Asset/Inventory reference'
    };
  }
  return {
    class: 'C',
    action: 'ESCALATE',
    origin: null,
    reason: 'Unclassified candidate; refusing to guess identity'
  };
}

function fieldsForCandidate(candidate, classification) {
  if (classification.origin === 'ASSET') {
    const asset = candidate.assets[0];
    return {
      name: asset.itemname,
      description: blankToNull(asset.itemdescription),
      make: blankToNull(asset.make),
      model: blankToNull(asset.model),
      manufacturer: null,
      hsn_code: blankToNull(asset.hsn_code),
      unit: null,
      product_code: null,
      price: nonzeroPrice(asset.asset_value),
      origin_ref: asset.id,
      link_origin: 'PUSH',
      baseline_name: asset.itemname,
      link_asset_id: asset.id === APPROVED_ASSET_LINK ? asset.id : null
    };
  }
  const cat = candidate.catalog;
  return {
    name: cat.product_name,
    description: blankToNull(cat.description),
    make: blankToNull(cat.make),
    model: blankToNull(cat.model),
    manufacturer: null,
    hsn_code: blankToNull(cat.hsn_code),
    unit: null,
    product_code: blankToNull(cat.sku),
    price: nonzeroPrice(cat.unit_price),
    origin_ref: null,
    link_origin: 'PULL',
    baseline_name: cat.product_name,
    link_asset_id: null
  };
}

async function loadCandidates(runner) {
  const catalog = await runner('zoho_catalog').select('*');
  const assets = await runner('assets')
    .whereNotNull('zoho_product_id')
    .andWhereRaw("BTRIM(zoho_product_id) <> ''")
    .select(
      'id',
      'itemname',
      'itemdescription',
      'make',
      'model',
      'hsn_code',
      'asset_value',
      'zoho_product_id',
      'is_set',
      'is_deleted'
    );
  const inventory = await runner('inventory_items')
    .whereNotNull('zoho_product_id')
    .andWhereRaw("BTRIM(zoho_product_id) <> ''")
    .select('id', 'itemname', 'make', 'model', 'hsn_code', 'zoho_product_id');

  const map = new Map();
  const touch = (externalId) => {
    const id = String(externalId);
    if (!map.has(id)) {
      map.set(id, { external_id: id, catalog: null, assets: [], inventory: [] });
    }
    return map.get(id);
  };
  for (const row of catalog) touch(row.zoho_product_id).catalog = row;
  for (const row of assets) touch(row.zoho_product_id).assets.push(row);
  for (const row of inventory) touch(row.zoho_product_id).inventory.push(row);
  return [...map.values()];
}

async function alreadyLinked(runner, externalId) {
  return runner('product_external_ref')
    .where({
      system: ZOHO_SYSTEM,
      module: ZOHO_MODULE,
      external_id: String(externalId)
    })
    .first();
}

async function createFromCandidate(runner, candidate, classification, fields) {
  let productId = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    productId = generateProductId();
    if (!verifyProductId(productId)) continue;
    try {
      await runner('product').insert({
        id: productId,
        name: fields.name,
        description: fields.description,
        make: fields.make,
        model: fields.model,
        manufacturer: fields.manufacturer,
        hsn_code: fields.hsn_code,
        unit: fields.unit,
        product_code: fields.product_code,
        price: fields.price,
        status: 'ACTIVE',
        origin: classification.origin,
        origin_ref: fields.origin_ref,
        archived_at: null,
        created_by: 'product-backfill',
        updated_by: 'product-backfill'
      });
      break;
    } catch (err) {
      if (err && err.code === '23505' && attempt < 4) continue;
      throw err;
    }
  }
  if (!productId) throw new Error('Unable to allocate Product ID');

  const now = new Date();
  await runner('product_external_ref').insert({
    id: newRefId(),
    product_id: productId,
    system: ZOHO_SYSTEM,
    module: ZOHO_MODULE,
    external_id: String(candidate.external_id),
    link_origin: fields.link_origin,
    baseline_name: fields.baseline_name,
    baseline_captured_at: now,
    last_pushed_hash: null,
    last_pulled_at: fields.link_origin === 'PULL' ? now : null,
    last_pushed_at: fields.link_origin === 'PUSH' ? now : null
  });

  let assetLinked = null;
  if (fields.link_asset_id) {
    await runner('assets').where({ id: fields.link_asset_id }).update({ product_id: productId });
    assetLinked = fields.link_asset_id;
  }
  return { productId, assetLinked };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const info = await db.raw('select current_database() as db, inet_server_addr() as host');
  const currentDb = info.rows[0].db;
  const mode = args.apply ? 'APPLY' : 'DRY-RUN';

  console.log('============================================================');
  console.log('Product backfill');
  console.log(`Mode:            ${mode}`);
  console.log(`Database:        ${currentDb}`);
  console.log(`NODE_ENV:        ${process.env.NODE_ENV || ''}`);
  console.log('============================================================');

  if (args.apply) {
    if (!args.databaseName) {
      throw new Error('--apply requires --database-name matching current_database()');
    }
    if (args.databaseName !== currentDb) {
      throw new Error(
        `--database-name ${args.databaseName} does not match current_database() ${currentDb}. Refusing to write.`
      );
    }
  }

  if (!(await db.schema.hasTable('product'))) {
    throw new Error('product table is not installed; run the named Product migration first');
  }

  const candidates = await loadCandidates(db);
  const report = {
    mode,
    database: currentDb,
    generated_at: new Date().toISOString(),
    counts: {
      candidates: candidates.length,
      class_a: 0,
      class_b: 0,
      class_c: 0,
      class_d: 0,
      create: 0,
      already_linked: 0,
      quarantine: 0,
      escalate: 0,
      created: 0,
      asset_links: 0
    },
    created: [],
    already_linked: [],
    quarantined: [],
    escalated: [],
    asset_links: []
  };

  const work = async (runner) => {
    for (const candidate of candidates) {
      const classification = classifyCandidate(candidate);
      if (classification.class === 'A') report.counts.class_a += 1;
      if (classification.class === 'B') report.counts.class_b += 1;
      if (classification.class === 'C') report.counts.class_c += 1;
      if (classification.class === 'D') report.counts.class_d += 1;

      const existing = await alreadyLinked(runner, candidate.external_id);
      if (existing) {
        report.counts.already_linked += 1;
        report.already_linked.push({
          external_id: candidate.external_id,
          product_id: existing.product_id,
          class: classification.class
        });
        continue;
      }

      if (classification.action === 'QUARANTINE') {
        report.counts.quarantine += 1;
        report.quarantined.push({
          external_id: candidate.external_id,
          catalog_name: candidate.catalog ? candidate.catalog.product_name : null,
          reason: classification.reason
        });
        continue;
      }

      if (classification.action === 'ESCALATE') {
        report.counts.escalate += 1;
        report.escalated.push({
          external_id: candidate.external_id,
          asset_ids: candidate.assets.map((a) => a.id),
          is_set: candidate.assets.map((a) => a.is_set),
          in_catalog: Boolean(candidate.catalog),
          reason: classification.reason
        });
        continue;
      }

      report.counts.create += 1;
      const fields = fieldsForCandidate(candidate, classification);
      if (args.apply) {
        const created = await createFromCandidate(runner, candidate, classification, fields);
        report.counts.created += 1;
        report.created.push({
          product_id: created.productId,
          external_id: String(candidate.external_id),
          origin: classification.origin,
          origin_ref: fields.origin_ref,
          link_origin: fields.link_origin,
          name: fields.name,
          class: classification.class
        });
        if (created.assetLinked) {
          report.counts.asset_links += 1;
          report.asset_links.push({
            asset_id: created.assetLinked,
            product_id: created.productId,
            external_id: String(candidate.external_id)
          });
        }
      } else {
        report.created.push({
          product_id: '(dry-run)',
          external_id: String(candidate.external_id),
          origin: classification.origin,
          origin_ref: fields.origin_ref,
          link_origin: fields.link_origin,
          name: fields.name,
          class: classification.class,
          would_link_asset: fields.link_asset_id
        });
      }
    }
  };

  if (args.apply) {
    await db.transaction(async (trx) => {
      await work(trx);
    });
  } else {
    await work(db);
  }

  const outDir = path.join(__dirname, 'reports');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(outDir, `product-backfill-${mode.toLowerCase()}-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log('');
  console.log('Counts');
  console.log(JSON.stringify(report.counts, null, 2));
  console.log('');
  console.log('Quarantined');
  console.log(JSON.stringify(report.quarantined, null, 2));
  console.log('');
  console.log('Escalated');
  console.log(JSON.stringify(report.escalated, null, 2));
  console.log('');
  console.log('Asset links');
  console.log(JSON.stringify(report.asset_links.length ? report.asset_links : report.created.filter((r) => r.would_link_asset), null, 2));
  console.log('');
  console.log(`Report written: ${outPath}`);

  await db.destroy();
}

main().catch(async (err) => {
  console.error('BACKFILL FAILED:', err.message);
  console.error(err.stack);
  try {
    await db.destroy();
  } catch (e) {
    /* ignore */
  }
  process.exit(1);
});
