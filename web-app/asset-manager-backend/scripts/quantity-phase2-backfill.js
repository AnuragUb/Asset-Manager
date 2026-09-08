/**
 * Phase 2 quantity / physical-identity backfill.
 *
 * Default --dry-run. --apply requires --database-name matching current_database().
 *
 * B-8: repair quantity-tracked roots with quantity_root_id IS NULL when the
 * row is demonstrably a root (parentid null, is_set != 1, no quantity_parent_id).
 * Do not guess on Set-flagged rows.
 *
 * B-4: generate one Inventory QR for MIS-MUM-0826-H4XVLL-W. No per-unit QRs.
 * B-6: do not parse or copy srno into physical_marking.
 */
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode');
const { db } = require('../utils');
const { clientLabelFromId } = require('../services/breakService');

const AGGREGATED_INVENTORY_ID = 'MIS-MUM-0826-H4XVLL-W';

function parseArgs(argv) {
  const args = { dryRun: true, apply: false, databaseName: null, host: null };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--apply') {
      args.apply = true;
      args.dryRun = false;
    } else if (token === '--dry-run') {
      args.dryRun = true;
      args.apply = false;
    } else if (token === '--database-name') {
      args.databaseName = argv[++i];
    } else if (token === '--host') {
      args.host = argv[++i];
    }
  }
  return args;
}

function reportsDir() {
  return path.join(__dirname, 'reports');
}

async function currentDbName() {
  const row = await db.raw('SELECT current_database() AS name');
  return row.rows[0].name;
}

function isDemonstrableRoot(row) {
  if (Number(row.is_quantity_tracked) !== 1) return { ok: false, reason: 'not quantity-tracked' };
  if (row.quantity_root_id) return { ok: false, reason: 'already has quantity_root_id' };
  if (row.quantity_parent_id) {
    return { ok: false, reason: 'has quantity_parent_id; not a root' };
  }
  if (Number(row.is_set) === 1) {
    return { ok: false, reason: 'is_set=1; refuse to guess (legacy Set)' };
  }
  if (row.parentid) {
    return { ok: false, reason: 'parentid set; leave as legacy compatibility (B-1)' };
  }
  return { ok: true, reason: 'quantity-tracked, no parent, not a Set, missing root id' };
}

async function snapshotHoldings() {
  const assets = await db('assets').select(
    'id', 'is_quantity_tracked', 'is_set', 'is_batch', 'parentid',
    'quantity_parent_id', 'quantity_root_id', 'quantity_total', 'quantity_available',
    'quantity_original', 'lineage_status', 'product_id'
  ).orderBy('id');
  const inventory = await db('inventory_items').select(
    'id', 'is_quantity_tracked', 'is_set', 'is_batch', 'parentid',
    'quantity_parent_id', 'quantity_root_id', 'quantity_total', 'quantity_available',
    'quantity_original', 'lineage_status', 'product_id', 'qrcode', 'noqr', 'client_label'
  ).orderBy('id');
  return { assets, inventory };
}

async function buildQr(host, publicPath, id) {
  const cleanHost = String(host || '').replace(/^https?:\/\//i, '').trim();
  if (!cleanHost) throw new Error('QR host is required (--host or PUBLIC_HOST)');
  const urlText = `http://${cleanHost}/${publicPath}/${encodeURIComponent(id)}`;
  return qrcode.toDataURL(urlText, { width: 512, margin: 2 });
}

async function main() {
  const args = parseArgs(process.argv);
  const dbName = await currentDbName();
  if (!args.databaseName) {
    throw new Error('--database-name is required');
  }
  if (args.databaseName !== dbName) {
    throw new Error(`--database-name ${args.databaseName} does not match current_database() ${dbName}`);
  }
  if (args.apply && args.dryRun) {
    throw new Error('Cannot --apply and --dry-run');
  }

  const host = args.host || process.env.PUBLIC_HOST || process.env.STATIC_IP || '';
  const before = await snapshotHoldings();
  const repairs = [];
  const skipped = [];
  const qrActions = [];

  for (const row of before.assets) {
    const decision = isDemonstrableRoot(row);
    if (Number(row.is_quantity_tracked) === 1 && !row.quantity_root_id) {
      if (decision.ok) {
        repairs.push({
          table: 'assets',
          id: row.id,
          quantity_root_id: row.id,
          quantity_original: row.quantity_total,
          reason: decision.reason,
          before: {
            quantity_root_id: row.quantity_root_id,
            quantity_original: row.quantity_original,
            parentid: row.parentid,
            is_set: row.is_set
          }
        });
      } else {
        skipped.push({ table: 'assets', id: row.id, reason: decision.reason });
      }
    }
  }

  for (const row of before.inventory) {
    const decision = isDemonstrableRoot(row);
    if (Number(row.is_quantity_tracked) === 1 && !row.quantity_root_id) {
      if (decision.ok) {
        repairs.push({
          table: 'inventory_items',
          id: row.id,
          quantity_root_id: row.id,
          quantity_original: row.quantity_total,
          reason: decision.reason,
          before: {
            quantity_root_id: row.quantity_root_id,
            quantity_original: row.quantity_original,
            parentid: row.parentid,
            is_set: row.is_set
          }
        });
      } else {
        skipped.push({ table: 'inventory_items', id: row.id, reason: decision.reason });
      }
    }
  }

  const inv = before.inventory.find((r) => r.id === AGGREGATED_INVENTORY_ID);
  if (inv) {
    qrActions.push({
      id: inv.id,
      action: inv.qrcode ? 'KEEP_EXISTING_QR' : 'CREATE_ONE_INVENTORY_QR',
      per_unit: false,
      client_label: inv.client_label || clientLabelFromId(inv.id)
    });
  } else {
    skipped.push({ table: 'inventory_items', id: AGGREGATED_INVENTORY_ID, reason: 'aggregated inventory not found' });
  }

  const markingCount = (await db('physical_marking').count('id as n'))[0];
  const report = {
    database: dbName,
    dryRun: args.dryRun,
    host: host || null,
    generatedAt: new Date().toISOString(),
    before: {
      assets: before.assets.map((r) => ({
        id: r.id,
        quantity_root_id: r.quantity_root_id,
        quantity_original: r.quantity_original,
        quantity_total: r.quantity_total,
        quantity_available: r.quantity_available,
        parentid: r.parentid,
        product_id: r.product_id,
        is_set: r.is_set
      })),
      inventory: before.inventory.map((r) => ({
        id: r.id,
        quantity_root_id: r.quantity_root_id,
        quantity_original: r.quantity_original,
        quantity_total: r.quantity_total,
        quantity_available: r.quantity_available,
        has_qr: Boolean(r.qrcode),
        client_label: r.client_label
      }))
    },
    plannedRepairs: repairs,
    skipped,
    qrActions,
    physical_marking_rows: Number(markingCount.n || markingCount.count || 0)
  };

  if (args.apply) {
    await db.transaction(async (trx) => {
      for (const repair of repairs) {
        await trx(repair.table)
          .where('id', repair.id)
          .update({
            quantity_root_id: repair.quantity_root_id,
            quantity_original: repair.quantity_original
          });
      }
      if (inv && !inv.qrcode) {
        const dataUrl = await buildQr(host, 'inventory', inv.id);
        await trx('inventory_items')
          .where('id', inv.id)
          .update({
            qrcode: dataUrl,
            noqr: 0,
            client_label: inv.client_label || clientLabelFromId(inv.id)
          });
      }
      const insertedMarking = await trx('physical_marking').count('id as n').first();
      if (Number(insertedMarking.n || insertedMarking.count || 0) !== 0) {
        throw new Error('STOP: physical_marking is not empty; Phase 2 must not migrate serials');
      }
    });
  }

  const after = args.apply ? await snapshotHoldings() : before;
  report.after = {
    assets: after.assets.map((r) => ({
      id: r.id,
      quantity_root_id: r.quantity_root_id,
      quantity_original: r.quantity_original,
      quantity_total: r.quantity_total,
      quantity_available: r.quantity_available,
      parentid: r.parentid,
      product_id: r.product_id,
      is_set: r.is_set
    })),
    inventory: after.inventory.map((r) => ({
      id: r.id,
      quantity_root_id: r.quantity_root_id,
      quantity_original: r.quantity_original,
      quantity_total: r.quantity_total,
      quantity_available: r.quantity_available,
      has_qr: Boolean(r.qrcode),
      client_label: r.client_label
    }))
  };

  fs.mkdirSync(reportsDir(), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const mode = args.apply ? 'apply' : 'dry-run';
  const file = path.join(reportsDir(), `quantity-phase2-${mode}-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: true, file, dryRun: args.dryRun, repairs: repairs.length, skipped: skipped.length, qrActions }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
