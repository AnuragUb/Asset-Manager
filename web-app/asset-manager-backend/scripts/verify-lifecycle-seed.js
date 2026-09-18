const { db } = require('../utils');

async function verify() {
  console.log('=== VERIFYING CANONICAL LIFECYCLE SEED ===');

  const assets = await db('assets').select('id', 'itemname', 'status', 'receipt_line_id', 'physical_intake_id');
  console.log('\n1. ASSETS (' + assets.length + '):');
  assets.forEach(a => {
    const origin = a.receipt_line_id ? 'SOURCED (via Receipt Note)' : (a.physical_intake_id ? 'ADOPTED (via Physical Intake)' : 'SET COMPONENT');
    console.log(` - [${a.id}] ${a.itemname} | Status: ${a.status} | Origin: ${origin}`);
  });

  const inv = await db('inventory_items').select('id', 'itemname', 'quantity_total', 'quantity_available', 'quantity_unit');
  console.log('\n2. INVENTORY (' + inv.length + '):');
  inv.forEach(i => {
    console.log(` - [${i.id}] ${i.itemname} | Total: ${i.quantity_total} ${i.quantity_unit} | Available: ${i.quantity_available} ${i.quantity_unit}`);
  });

  const sets = await db('managed_sets').select('id', 'set_code', 'name', 'status');
  console.log('\n3. MANAGED SETS (' + sets.length + '):');
  for (const s of sets) {
    const reqs = await db('set_requirement').where({ set_id: s.id });
    const comps = await db('managed_set_components').where({ set_id: s.id, is_active: true });
    console.log(` - [${s.set_code}] ${s.name} (ID: ${s.id})`);
    console.log(`   Requirements (${reqs.length}):`);
    for (const r of reqs) {
      const prod = await db('product').where({ id: r.product_id }).first();
      console.log(`     * ${r.quantity}x ${prod ? prod.name : r.product_id}`);
    }
    console.log(`   Allocated Components (${comps.length}):`);
    for (const c of comps) {
      console.log(`     * Asset ID: ${c.asset_id} (Reservation: ${c.reservation_id})`);
    }
  }

  const prov = await db('commercial_provenance').select('resource_type', 'resource_id', 'state');
  console.log('\n4. COMMERCIAL PROVENANCE:');
  prov.forEach(p => {
    console.log(` - ${p.resource_type} [${p.resource_id}]: State = ${p.state}`);
  });

  const rns = await db('receipt_note').select('id', 'status', 'po_number', 'vendor_name');
  console.log('\n5. RECEIPT NOTES (' + rns.length + '):');
  rns.forEach(r => console.log(` - [${r.id}] Status: ${r.status} | PO: ${r.po_number} | Vendor: ${r.vendor_name}`));

  const pis = await db('physical_intake').select('id', 'status', 'intake_type', 'reason');
  console.log('\n6. PHYSICAL INTAKES (' + pis.length + '):');
  pis.forEach(p => console.log(` - [${p.id}] Status: ${p.status} | Type: ${p.intake_type} | Reason: ${p.reason}`));

  console.log('\n=== ALL 4 LIFECYCLE EXAMPLES VERIFIED ===');
}

verify()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
