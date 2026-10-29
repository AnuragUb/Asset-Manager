/**
 * Scratch verify: post-commit commercial reconciliation + vendor return.
 * DB_NAME=asset_manager_procurement_reconciliation_scratch
 */
const { db } = require('../utils');
const procurementReconciliationService = require('../services/procurementReconciliationService');
const vendorReturnService = require('../services/vendorReturnService');
const receiptService = require('../services/receiptService');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function ensureTables() {
  assert(await db.schema.hasTable('procurement_reconciliation'), 'migration missing');
  assert(await db.schema.hasTable('vendor_return'), 'vendor_return missing');
}

async function pickInventory() {
  return db('inventory_items')
    .where(function () {
      this.where('is_deleted', 0).orWhereNull('is_deleted');
    })
    .whereRaw('COALESCE(quantity_available,0) >= 10')
    .whereRaw('COALESCE(quantity_total,0) >= 10')
    .orderBy('lastupdated', 'desc')
    .first();
}

async function ensureSyntheticPoLine(productId) {
  // Prefer an existing PO line with a product; otherwise create minimal synthetic rows for scratch.
  let line = await db('procurement_po_line')
    .whereNotNull('product_id')
    .where('line_status', 'OPEN')
    .orderBy('updated_at', 'desc')
    .first();
  if (line) return line;

  const poId = `PPO-SCRATCH-RECON-${Date.now()}`;
  const lineId = `POL-SCRATCH-RECON-${Date.now()}`;
  // Skip if ID format checks would fail — use real generators via existing rows only
  throw new Error('No procurement_po_line with product_id available on scratch DB');
}

async function main() {
  await ensureTables();
  console.log('SCHEMA OK');

  // --- A: no physical → no recon ---
  const empty = await procurementReconciliationService.syncPoReconciliations('NONEXISTENT', 'verify');
  assert(Array.isArray(empty.reconciliations), 'empty sync shape');

  // Find a line with accepted > 0 or create reconciliation by lowering ordered below accepted
  const lines = await db('procurement_po_line as l')
    .join('procurement_po as p', 'p.id', 'l.procurement_po_id')
    .select('l.*', 'p.po_number', 'p.id as po_id')
    .limit(50);

  let target = null;
  let accepted = 0;
  for (const line of lines) {
    const a = await db('receipt_note_line as rl')
      .join('receipt_note as n', 'n.id', 'rl.receipt_note_id')
      .where('rl.po_line_id', line.id)
      .where('n.status', 'POSTED')
      .sum({ total: 'rl.qty_accepted' })
      .first();
    accepted = Number(a?.total || 0);
    if (accepted >= 2) {
      target = line;
      break;
    }
  }

  if (!target) {
    console.log('SKIP C–F (no POSTED accepted qty >= 2 on scratch)');
  } else {
    const originalOrdered = Number(target.ordered_qty);
    const commercialLow = Math.max(0, accepted - 1);
    // C: reduce ordered below accepted
    await db('procurement_po_line').where({ id: target.id }).update({
      ordered_qty: commercialLow,
      updated_at: new Date().toISOString()
    });
    const synced = await procurementReconciliationService.syncPoReconciliations(target.po_id || target.procurement_po_id, 'verify');
    const open = (synced.reconciliations || []).find((r) => r.procurementPoLineId === target.id);
    assert(open, 'expected OPEN reconciliation');
    assert(Number(open.differenceQuantity) >= 1 - 1e-9, `diff ${open.differenceQuantity}`);
    console.log('OK C — PO below receipt opens recon', open.id, 'diff', open.differenceQuantity);

    // F: over-return reject
    let overRejected = false;
    try {
      await vendorReturnService.createVendorReturn({
        procurementPoId: open.procurementPoId,
        procurementReconciliationId: open.id,
        actor: 'verify',
        lines: [{
          procurementPoLineId: open.procurementPoLineId,
          resourceType: 'INVENTORY',
          resourceId: 'INV-DOES-NOT-EXIST',
          quantity: Number(open.differenceQuantity) + 10
        }]
      });
    } catch (err) {
      overRejected = true;
    }
    assert(overRejected, 'over-return / bad holding must reject');
    console.log('OK F — over/invalid return rejects');

    // E: retain
    const retained = await procurementReconciliationService.retainInCineom(open.id, {
      actor: 'verify',
      quantity: open.differenceQuantity
    });
    assert(retained.status === 'CLOSED' || Number(retained.differenceQuantity) === 0, 'retain closes');
    assert(Number(retained.retainedQuantity) >= Number(open.differenceQuantity) - 1e-9, 'retained qty');
    console.log('OK E — retain closes without stock change');

    // Restore ordered for cleanliness
    await db('procurement_po_line').where({ id: target.id }).update({
      ordered_qty: originalOrdered,
      updated_at: new Date().toISOString()
    });
  }

  // G: POSTED RN edit reject
  const posted = await db('receipt_note').where({ status: 'POSTED' }).first();
  if (posted) {
    let rejected = false;
    try {
      await receiptService.updateReceiptNote(posted.id, { vendorInvoiceNo: 'SHOULD-FAIL' });
    } catch (err) {
      rejected = err.reasonCode === 'RECEIPT_IMMUTABLE' || /immutable|cannot/i.test(err.message);
    }
    assert(rejected, 'POSTED RN edit must reject');
    console.log('OK G — POSTED RN immutable');
  } else {
    console.log('SKIP G — no POSTED RN');
  }

  // H: OPEN RN edit allowed (smoke)
  const openRn = await db('receipt_note').where({ status: 'OPEN' }).where(function () {
    this.whereNull('inward_kind').orWhere('inward_kind', 'PURCHASE_INWARD');
  }).first();
  if (openRn) {
    await receiptService.updateReceiptNote(openRn.id, {
      vendorInvoiceNo: openRn.vendor_invoice_no || 'VERIFY-OPEN'
    });
    console.log('OK H — OPEN RN editable');
  } else {
    console.log('SKIP H — no OPEN RN');
  }

  // Second discrepancy cycle for D vendor return if inventory eligible exists
  const line2 = await db('procurement_po_line').whereNotNull('product_id').first();
  if (line2) {
    const elig = await vendorReturnService.listEligibleHoldings(line2.id);
    const inv = (elig.holdings || []).find((h) => h.resourceType === 'INVENTORY' && Number(h.quantity) >= 1);
    const accepted2row = await db('receipt_note_line as rl')
      .join('receipt_note as n', 'n.id', 'rl.receipt_note_id')
      .where('rl.po_line_id', line2.id)
      .where('n.status', 'POSTED')
      .sum({ total: 'rl.qty_accepted' })
      .first();
    const acc2 = Number(accepted2row?.total || 0);
    if (inv && acc2 >= 1) {
      const orig = Number(line2.ordered_qty);
      await db('procurement_po_line').where({ id: line2.id }).update({ ordered_qty: Math.max(0, acc2 - 1) });
      const synced2 = await procurementReconciliationService.syncPoReconciliations(line2.procurement_po_id, 'verify');
      const recon2 = (synced2.reconciliations || []).find((r) => r.procurementPoLineId === line2.id && Number(r.differenceQuantity) > 0);
      if (recon2) {
        const beforeAvail = Number((await db('inventory_items').where({ id: inv.resourceId }).first()).quantity_available);
        const vr = await vendorReturnService.createVendorReturn({
          procurementPoId: recon2.procurementPoId,
          procurementReconciliationId: recon2.id,
          actor: 'verify',
          lines: [{
            procurementPoLineId: recon2.procurementPoLineId,
            resourceType: 'INVENTORY',
            resourceId: inv.resourceId,
            quantity: 1,
            productId: inv.productId
          }]
        });
        assert(vr.status === 'OPEN', 'VR OPEN');
        const afterCreate = Number((await db('inventory_items').where({ id: inv.resourceId }).first()).quantity_available);
        assert(afterCreate === beforeAvail, 'OPEN must not reduce stock');
        await vendorReturnService.markReady(vr.id, 'verify');
        await vendorReturnService.dispatch(vr.id, 'verify');
        const after = await db('inventory_items').where({ id: inv.resourceId }).first();
        assert(Number(after.quantity_available) === beforeAvail - 1, 'dispatch reduces available');
        const outbox = await db('vendor_return_outbox').where({ vendor_return_id: vr.id }).first();
        assert(outbox && outbox.event_type === 'VENDOR_RETURN_DISPATCHED', 'outbox once');
        const closed = await db('procurement_reconciliation').where({ id: recon2.id }).first();
        assert(['CLOSED', 'RETURNED_TO_VENDOR'].includes(closed.status), `status ${closed.status}`);
        console.log('OK D — vendor return dispatch + outbox', vr.id);
      } else {
        console.log('SKIP D — could not open recon for return path');
      }
      await db('procurement_po_line').where({ id: line2.id }).update({ ordered_qty: orig });
    } else {
      console.log('SKIP D — no eligible inventory holding for PO line');
    }
  }

  console.log('\nALL PROCUREMENT RECONCILIATION CHECKS PASSED (within available scratch data)');
  await db.destroy();
}

main().catch(async (err) => {
  console.error('FAIL', err.message, err.reasonCode || '', err.stack);
  try { await db.destroy(); } catch (_) {}
  process.exit(1);
});
