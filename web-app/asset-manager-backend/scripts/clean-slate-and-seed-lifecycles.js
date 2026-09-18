/**
 * clean-slate-and-seed-lifecycles.js
 *
 * Purges unwanted/cluttered operational test data and seeds 4 pristine, canonical
 * lifecycle examples matching AssetEngine canonical architecture:
 *
 * 1. SOURCED LIFECYCLE:
 *    Procurement PO (PO-2026-0001) -> Posted Receipt Note (RN-2026-0001) ->
 *    Physical Asset (Panasonic AW-UE150W UHD 4K PTZ Camera) in "In Store"
 *    with commercial provenance linked to PO and Receipt Note.
 *
 * 2. ADOPTED LIFECYCLE:
 *    Physical Intake (Opening balance / Legacy) ->
 *    Physical Asset (Yamaha MG10X 10-Channel Mixer) in "In Store"
 *    with commercial provenance "AWAITING_PO" (surfaces in "Awaiting Adoption" on Dashboard).
 *
 * 3. SET / KIT LIFECYCLE:
 *    Managed Set "4K Field Production Kit #1" with defined Product Requirements
 *    (Camera, Cables, Audio Mixer) and physical allocation locked via Reservation.
 *
 * 4. INVENTORY & CONVERSION LIFECYCLE:
 *    Bulk Inventory (Belden 12G-SDI Cable Drums) and individual conversion-ready
 *    inventory (Blackmagic SDI to HDMI Micro Converters) ready for Inventory -> Asset conversion.
 */

const qrcode = require('qrcode');
const {
  db,
  generateModernAssetId,
  generateSetId,
  generateRequirementId,
  generateAllocationId,
  generateReceiptNoteId,
  generateReceiptLineId,
  generateProcurementPoId,
  generateProcurementPoLineId,
  generatePhysicalIntakeId,
  generateReservationId,
  generateProductId
} = require('../utils');

function clientLabelFromId(id) {
  const parts = String(id || '').split('-');
  return `${parts[0] || 'AST'}-${parts[1] || 'LOC'}-${parts[3] || '000000'}`;
}

async function flushRedisCache() {
  try {
    const cache = require('../services/cacheService');
    await cache.flush();
    console.log('[CACHE] Cache flushed successfully.');
  } catch (err) {
    console.warn('[CACHE] Could not flush cache:', err.message);
  }
}

async function cleanSlateAndSeed() {
  console.log('=== STARTING CLEAN SLATE & CANONICAL LIFECYCLE SEED ===');

  // Disable user triggers during administrative clean slate
  await db.raw("SET session_replication_role = 'replica'");

  try {
    await db.transaction(async (trx) => {
      // -------------------------------------------------------------
      // STEP 1: CLEAN SLATE (PURGE OPERATIONAL CLUTTER)
      // -------------------------------------------------------------
      console.log('[CLEAN SLATE] Purging operational tables in reverse dependency order...');

    // 1. Delivery Challans
    if (await trx.schema.hasTable('dc_item_mappings')) {
      await trx('dc_item_mappings').del();
    }
    if (await trx.schema.hasTable('delivery_challans')) {
      await trx('delivery_challans').del();
    }

    // 2. Conversions
    if (await trx.schema.hasTable('conversion_line')) {
      await trx('conversion_line').del();
    }
    if (await trx.schema.hasTable('conversion_event')) {
      await trx('conversion_event').del();
    }
    if (await trx.schema.hasTable('conversion')) {
      await trx('conversion').del();
    }

    // 3. Managed Sets & Requirements
    if (await trx.schema.hasTable('managed_set_components')) {
      await trx('managed_set_components').del();
    }
    if (await trx.schema.hasTable('set_requirement')) {
      await trx('set_requirement').del();
    }
    if (await trx.schema.hasTable('set_event')) {
      await trx('set_event').del();
    }
    if (await trx.schema.hasTable('set_idempotency')) {
      await trx('set_idempotency').del();
    }
    if (await trx.schema.hasTable('managed_sets')) {
      await trx('managed_sets').update({ source_set_id: null, absorbed_into_set_id: null });
      await trx('managed_sets').del();
    }

    // 4. Reservations
    if (await trx.schema.hasTable('reservation_event')) {
      await trx('reservation_event').del();
    }
    if (await trx.schema.hasTable('reservation')) {
      await trx('reservation').update({ parent_reservation_id: null, transferred_to_id: null });
      await trx('reservation').del();
    }

    // 5. Asset Hierarchy, Components & Project Assets
    if (await trx.schema.hasTable('asset_it_details')) {
      await trx('asset_it_details').del();
    }
    if (await trx.schema.hasTable('components')) {
      await trx('components').del();
    }
    if (await trx.schema.hasTable('project_assets')) {
      await trx('project_assets').del();
    }
    if (await trx.schema.hasTable('asset_hierarchy')) {
      await trx('asset_hierarchy').del();
    }

    // 6. Inventory Components & Quantity Events
    if (await trx.schema.hasTable('inventory_components')) {
      await trx('inventory_components').del();
    }
    if (await trx.schema.hasTable('inventory_quantity_event_lines')) {
      await trx('inventory_quantity_event_lines').del();
    }
    if (await trx.schema.hasTable('inventory_quantity_events')) {
      await trx('inventory_quantity_events').del();
    }
    if (await trx.schema.hasTable('quantity_event_lines')) {
      await trx('quantity_event_lines').del();
    }
    if (await trx.schema.hasTable('quantity_events')) {
      await trx('quantity_events').del();
    }

    // 7. Receipts & Intakes Operational Output / Events
    if (await trx.schema.hasTable('receipt_physical_output')) {
      await trx('receipt_physical_output').del();
    }
    if (await trx.schema.hasTable('receipt_projection_outbox')) {
      await trx('receipt_projection_outbox').del();
    }
    if (await trx.schema.hasTable('receipt_event')) {
      await trx('receipt_event').del();
    }
    if (await trx.schema.hasTable('receipt_idempotency')) {
      await trx('receipt_idempotency').del();
    }
    if (await trx.schema.hasTable('physical_intake_output')) {
      await trx('physical_intake_output').del();
    }
    if (await trx.schema.hasTable('physical_intake_event')) {
      await trx('physical_intake_event').del();
    }
    if (await trx.schema.hasTable('physical_intake_idempotency')) {
      await trx('physical_intake_idempotency').del();
    }

    // 8. Commercial Provenance
    if (await trx.schema.hasTable('commercial_provenance')) {
      await trx('commercial_provenance').del();
    }

    // 9. Null out references on Assets and Inventory before deleting
    if (await trx.schema.hasTable('project_order_items')) {
      await trx('project_order_items').update({ assetid: null });
    }
    if (await trx.schema.hasTable('assets')) {
      await trx('assets').update({
        parentid: null,
        quantity_parent_id: null,
        quantity_root_id: null,
        receipt_line_id: null,
        physical_intake_id: null,
        conversion_id: null,
        linked_po_item_id: null
      });
      await trx('assets').del();
      console.log('[CLEAN SLATE] All assets purged.');
    }

    if (await trx.schema.hasTable('inventory_items')) {
      await trx('inventory_items').update({
        parentid: null,
        quantity_parent_id: null,
        quantity_root_id: null,
        receipt_line_id: null,
        physical_intake_id: null
      });
      await trx('inventory_items').del();
      console.log('[CLEAN SLATE] All inventory items purged.');
    }

    // 10. Receipt Note Lines & Receipt Notes
    if (await trx.schema.hasTable('receipt_note_line')) {
      await trx('receipt_note_line').del();
    }
    if (await trx.schema.hasTable('receipt_note')) {
      await trx('receipt_note').del();
      console.log('[CLEAN SLATE] All receipt notes purged.');
    }

    // 11. Physical Intakes
    if (await trx.schema.hasTable('physical_intake')) {
      await trx('physical_intake').del();
      console.log('[CLEAN SLATE] All physical intakes purged.');
    }

    // 12. Procurement PO lines and POs
    if (await trx.schema.hasTable('procurement_po_external_ref')) {
      await trx('procurement_po_external_ref').del();
    }
    if (await trx.schema.hasTable('procurement_po_line')) {
      await trx('procurement_po_line').del();
    }
    if (await trx.schema.hasTable('procurement_po')) {
      await trx('procurement_po').del();
      console.log('[CLEAN SLATE] All procurement POs purged.');
    }

    // Null out assetid on audit_log so no dangling references
    if (await trx.schema.hasTable('audit_log')) {
      await trx('audit_log').update({ assetid: null });
    }

    console.log('[CLEAN SLATE] Complete! Database is clean.\n');

    // -------------------------------------------------------------
    // STEP 2: SEED CANONICAL EXAMPLES
    // -------------------------------------------------------------
    console.log('[SEED] Seeding 4 canonical lifecycle examples...');

    // Fetch existing catalog products to link
    const cameraProd = await trx('product').where({ id: 'PRD-0826-P7XDWK-9' }).first();
    const mixerProd = await trx('product').where({ id: 'PRD-0826-4JSGXD-I' }).first();
    const converterProd = await trx('product').where({ id: 'PRD-0826-3ODGCR-8' }).first();
    const sdiProd = await trx('product').where({ id: 'PRD-0826-C55ZTE-V' }).first();

    const cameraProdId = cameraProd ? cameraProd.id : 'PRD-0826-P7XDWK-9';
    const mixerProdId = mixerProd ? mixerProd.id : 'PRD-0826-4JSGXD-I';
    const converterProdId = converterProd ? converterProd.id : 'PRD-0826-3ODGCR-8';
    const sdiProdId = sdiProd ? sdiProd.id : 'PRD-0826-C55ZTE-V';

    const now = new Date();

    // =============================================================
    // EXAMPLE 1: SOURCED LIFECYCLE (Procurement-First)
    // PO -> Receipt Note -> In Store Asset (PO Linked)
    // =============================================================
    console.log('[SEED 1/4] Creating Sourced Lifecycle example...');

    const po1Id = generateProcurementPoId(now);
    const po1LineId = generateProcurementPoLineId(now);
    const rn1Id = generateReceiptNoteId(now);
    const rn1LineId = generateReceiptLineId(now);
    const sourcedAssetId = generateModernAssetId('Mumbai', 'Camera', now);

    // 1. Procurement PO
    await trx('procurement_po').insert({
      id: po1Id,
      source: 'ZOHO',
      classification: 'CANONICAL',
      po_number: 'PO-2026-0001',
      subject: 'Procurement of 4K Broadcast PTZ Cameras',
      status: 'APPROVED',
      vendor_name_snapshot: 'Panasonic India Pvt Ltd',
      po_date: '2026-09-01',
      due_date: '2026-09-30',
      currency: 'INR',
      sub_total: 750000.00,
      tax: 135000.00,
      grand_total: 885000.00,
      created_by: 'admin',
      created_at: now,
      updated_at: now
    });

    // 2. PO Line
    await trx('procurement_po_line').insert({
      id: po1LineId,
      procurement_po_id: po1Id,
      product_id: cameraProdId,
      sequence_number: 1,
      description: 'Panasonic AW-UE150W UHD 4K 20x PTZ Camera',
      ordered_qty: 2.000000,
      unit: 'pcs',
      list_price: 375000.00,
      tax: 67500.00,
      net_total: 885000.00,
      line_status: 'OPEN',
      created_at: now,
      updated_at: now
    });

    // 3. Receipt Note (Posted)
    await trx('receipt_note').insert({
      id: rn1Id,
      status: 'POSTED',
      po_source: 'ZOHO',
      po_id: po1Id,
      po_number: 'PO-2026-0001',
      vendor_name: 'Panasonic India Pvt Ltd',
      vendor_invoice_no: 'INV-PAN-2026-881',
      delivery_note_no: 'DN-8812',
      received_at: now,
      received_at_location: 'Mumbai Central Hub',
      received_by: 'admin',
      posted_by: 'admin',
      posted_at: now,
      created_by: 'admin',
      created_at: now,
      updated_at: now
    });

    // 4. Receipt Note Line
    await trx('receipt_note_line').insert({
      id: rn1LineId,
      receipt_note_id: rn1Id,
      po_line_id: po1LineId,
      product_id: cameraProdId,
      ordered_qty_snapshot: 2.000000,
      ordered_qty_current: 2.000000,
      unit_snapshot: 'pcs',
      item_description_snapshot: 'Panasonic AW-UE150W UHD 4K 20x PTZ Camera',
      po_number_snapshot: 'PO-2026-0001',
      vendor_name_snapshot: 'Panasonic India Pvt Ltd',
      qty_received: 1.000000,
      qty_accepted: 1.000000,
      qty_rejected: 0.000000,
      qty_damaged: 0.000000,
      unit: 'pcs',
      creation_mode: 'ASSET_INDIVIDUAL',
      folder_id: 'F1781858492867', // Cineom Assets
      kind_id: 'Hardware',
      sort_order: 1,
      notes: 'Initial delivery of 1 unit in pristine condition',
      created_at: now,
      updated_at: now
    });

    // 5. Physical Asset created by Receipt Note
    await trx('assets').insert({
      id: sourcedAssetId,
      itemname: 'Panasonic AW-UE150W UHD 4K PTZ Camera',
      itemdescription: '4K 60p PTZ Camera with 12G-SDI, HDMI, and IP streaming output',
      make: 'Panasonic',
      model: 'AW-UE150W',
      srno: 'PAN-4K-990142',
      serialno: 'PAN-4K-990142',
      type: 'Hardware',
      category: 'IT',
      parent_folder: 'Cineom Assets',
      status: 'In Store',
      currentlocation: 'Mumbai',
      purchasedetails: 'PO-2026-0001',
      boughtagainstpo: 'PO-2026-0001',
      currency: 'INR',
      asset_value: 375000.00,
      product_id: cameraProdId,
      receipt_line_id: rn1LineId,
      qrcode: await qrcode.toDataURL(sourcedAssetId),
      client_label: clientLabelFromId(sourcedAssetId),
      quantity_total: 1.000000,
      quantity_available: 1.000000,
      quantity_reserved: 0.000000,
      is_quantity_tracked: 0,
      is_batch: 0,
      is_set: 0,
      is_deleted: 0,
      is_retired: 0,
      lastupdated: now
    });

    // 6. Receipt Physical Output tracking
    await trx('receipt_physical_output').insert({
      receipt_note_id: rn1Id,
      receipt_line_id: rn1LineId,
      resource_type: 'ASSET',
      resource_id: sourcedAssetId,
      quantity: 1.000000,
      created_at: now
    });

    // 7. Commercial Provenance (PO_LINKED)
    await trx('commercial_provenance').insert({
      resource_type: 'ASSET',
      resource_id: sourcedAssetId,
      quantity: 1.000000,
      state: 'PO_LINKED',
      procurement_po_id: po1Id,
      procurement_po_line_id: po1LineId,
      vendor_name_snapshot: 'Panasonic India Pvt Ltd',
      created_by: 'admin',
      linked_by: 'admin',
      created_at: now,
      linked_at: now,
      state_changed_at: now
    });

    console.log(`[SEED 1/4] Sourced Asset created: ${sourcedAssetId} (PO: PO-2026-0001, RN: ${rn1Id})`);

    // =============================================================
    // EXAMPLE 2: ADOPTED LIFECYCLE (Physical-First)
    // Physical Intake -> In Store Asset (AWAITING_PO -> Dashboard Awaiting Adoption)
    // =============================================================
    console.log('[SEED 2/4] Creating Adopted Lifecycle example...');

    const intakeId = generatePhysicalIntakeId(now);
    const adoptedAssetId = generateModernAssetId('Mumbai', 'Hardware', now);

    // 1. Physical Intake
    await trx('physical_intake').insert({
      id: intakeId,
      status: 'POSTED',
      holding_type: 'ASSET',
      intake_type: 'LEGACY_EXISTING_STOCK',
      product_id: mixerProdId,
      quantity: 1.000000,
      unit: 'pcs',
      reason: 'Opening balance registration of existing broadcast studio audio console',
      location: 'Mumbai',
      folder_id: 'F1781858492867',
      kind_id: 'Hardware',
      actor: 'admin',
      created_at: now,
      updated_at: now
    });

    // 2. Physical Asset created by Intake
    await trx('assets').insert({
      id: adoptedAssetId,
      itemname: 'Yamaha MG10X 10-Channel Analog Mixer',
      itemdescription: '10-Channel Compact Analog Mixer with D-PRE preamps and SPX digital effects',
      make: 'Yamaha',
      model: 'MG10X',
      srno: 'YAM-MG10-55421',
      serialno: 'YAM-MG10-55421',
      type: 'Hardware',
      category: 'IT',
      parent_folder: 'Cineom Assets',
      status: 'In Store',
      currentlocation: 'Mumbai',
      currency: 'INR',
      asset_value: 22000.00,
      product_id: mixerProdId,
      physical_intake_id: intakeId,
      qrcode: await qrcode.toDataURL(adoptedAssetId),
      client_label: clientLabelFromId(adoptedAssetId),
      quantity_total: 1.000000,
      quantity_available: 1.000000,
      quantity_reserved: 0.000000,
      is_quantity_tracked: 0,
      is_batch: 0,
      is_set: 0,
      is_deleted: 0,
      is_retired: 0,
      lastupdated: now
    });

    // 3. Physical Intake Output tracking
    await trx('physical_intake_output').insert({
      physical_intake_id: intakeId,
      resource_type: 'ASSET',
      resource_id: adoptedAssetId,
      quantity: 1.000000,
      created_at: now
    });

    // 4. Commercial Provenance (AWAITING_PO -> Surfaces in Dashboard Awaiting Adoption!)
    await trx('commercial_provenance').insert({
      resource_type: 'ASSET',
      resource_id: adoptedAssetId,
      quantity: 1.000000,
      state: 'AWAITING_PO',
      physical_intake_id: intakeId,
      created_by: 'admin',
      created_at: now,
      state_changed_at: now
    });

    console.log(`[SEED 2/4] Adopted Asset created: ${adoptedAssetId} (Intake: ${intakeId}, Status: Awaiting Adoption)`);

    // =============================================================
    // EXAMPLE 3: SET / KIT LIFECYCLE (Requirement & Allocation)
    // Product Requirements -> Managed Set -> Physical Reservation & Allocation
    // =============================================================
    console.log('[SEED 3/4] Creating Set / Kit Lifecycle example...');

    let setProduct = await trx('product').where({ product_code: 'SET-4K-FLD-01' }).first();
    let setProdId;
    if (!setProduct) {
      setProdId = generateProductId(now);
      await trx('product').insert({
        id: setProdId,
        name: '4K Field Production Kit',
        description: 'Complete mobile 4K field broadcast package with camera, video conversion, and audio mixer',
        make: 'Cineom Solutions',
        model: 'CS-4K-FLD',
        manufacturer: 'Cineom',
        product_code: 'SET-4K-FLD-01',
        unit: 'set',
        price: 520000.00,
        status: 'ACTIVE',
        origin: 'SET',
        created_by: 'admin',
        created_at: now,
        updated_at: now
      });
    } else {
      setProdId = setProduct.id;
    }

    const setId = generateSetId(now);
    const req1Id = generateRequirementId(now);
    const req2Id = generateRequirementId(now);
    const req3Id = generateRequirementId(now);

    // 1. Managed Set definition
    await trx('managed_sets').insert({
      id: setId,
      set_code: 'SET-4K-FLD-01',
      name: '4K Field Production Kit #1',
      description: 'Complete 4K Field Kit: 1x 4K PTZ Camera, 2x 12G-SDI Cables, 1x Audio Mixer',
      status: 'ACTIVE',
      product_id: setProdId,
      created_by: 'admin',
      created_at: now,
      updated_at: now
    });

    // 2. Set Requirements (Immutable requirements layer)
    await trx('set_requirement').insert([
      {
        id: req1Id,
        set_id: setId,
        product_id: cameraProdId,
        quantity: 1.000000,
        unit: 'pcs',
        sort_order: 1,
        created_by: 'admin',
        created_at: now
      },
      {
        id: req2Id,
        set_id: setId,
        product_id: sdiProdId,
        quantity: 2.000000,
        unit: 'pcs',
        sort_order: 2,
        created_by: 'admin',
        created_at: now
      },
      {
        id: req3Id,
        set_id: setId,
        product_id: mixerProdId,
        quantity: 1.000000,
        unit: 'pcs',
        sort_order: 3,
        created_by: 'admin',
        created_at: now
      }
    ]);

    // 3. Dedicated Asset for Set Component Allocation
    const kitCamAssetId = generateModernAssetId('Mumbai', 'Camera', now);
    await trx('assets').insert({
      id: kitCamAssetId,
      itemname: 'Panasonic AW-UE150W UHD 4K PTZ Camera (Field Kit Unit)',
      itemdescription: 'Allocated primary camera for 4K Field Production Kit',
      make: 'Panasonic',
      model: 'AW-UE150W',
      srno: 'PAN-4K-KIT01',
      serialno: 'PAN-4K-KIT01',
      type: 'Hardware',
      category: 'IT',
      parent_folder: 'Cineom Assets',
      status: 'In Store',
      currentlocation: 'Mumbai',
      currency: 'INR',
      asset_value: 375000.00,
      product_id: cameraProdId,
      qrcode: await qrcode.toDataURL(kitCamAssetId),
      client_label: clientLabelFromId(kitCamAssetId),
      quantity_total: 1.000000,
      quantity_available: 0.000000,
      quantity_reserved: 1.000000,
      is_quantity_tracked: 0,
      is_batch: 0,
      is_set: 0,
      is_deleted: 0,
      is_retired: 0,
      lastupdated: now
    });

    // 4. Reservation locking the physical asset to the Set
    const res1Id = generateReservationId(now);
    await trx('reservation').insert({
      id: res1Id,
      resource_type: 'ASSET',
      resource_id: kitCamAssetId,
      quantity: 1.000000,
      quantity_original: 1.000000,
      owner_type: 'SET',
      owner_id: setId,
      status: 'ACTIVE',
      reason: '4K Field Kit Allocation',
      reason_code: 'SET_ALLOCATION',
      created_by: 'admin',
      created_at: now,
      updated_at: now
    });

    // 5. Managed Set Component (Physical Allocation linking requirement -> reservation -> asset)
    await trx('managed_set_components').insert({
      id: generateAllocationId(now),
      set_id: setId,
      component_type: 'ASSET',
      asset_id: kitCamAssetId,
      quantity: 1.000000,
      requirement_id: req1Id,
      reservation_id: res1Id,
      is_active: true,
      sort_order: 1,
      created_by: 'admin',
      created_at: now,
      updated_at: now
    });

    console.log(`[SEED 3/4] Managed Set created: ${setId} (Requirements: 3, Allocated: 1 Camera Asset reserved)`);

    // =============================================================
    // EXAMPLE 4: INVENTORY & CONVERSION LIFECYCLE
    // Batch Inventory Item + Conversion-Ready Item
    // =============================================================
    console.log('[SEED 4/4] Creating Inventory & Conversion Lifecycle example...');

    const invBulkId = generateModernAssetId('Mumbai', 'Cable', now);
    const invConvId = generateModernAssetId('Mumbai', 'Hardware', now);

    // 1. Bulk Inventory Stock (Belden Coaxial Cable Drums)
    await trx('inventory_items').insert({
      id: invBulkId,
      itemname: 'Belden 1694A 12G-SDI RG6 Coaxial Cable (100m Drum)',
      itemdescription: 'Precision video coaxial cable for 12G-SDI 4K UHD transmission',
      make: 'Belden',
      model: '1694A',
      srno: 'BLD-1694A-BATCH-01',
      serialno: 'BLD-1694A-BATCH-01',
      folderid: 'IF-INBOX',
      kindid: 'IK-MISC',
      status: 'In Store',
      currentlocation: 'Mumbai Central Hub',
      currency: 'INR',
      asset_value: 45000.00,
      quantity_total: 10.000000,
      quantity_available: 10.000000,
      quantity_reserved: 0.000000,
      quantity_precision: 0,
      quantity_unit: 'drum',
      is_quantity_tracked: 1,
      is_batch: 1,
      is_set: 0,
      qrcode: await qrcode.toDataURL(invBulkId),
      client_label: clientLabelFromId(invBulkId),
      is_deleted: 0,
      lastupdated: now
    });

    // 2. Individual Conversion-Ready Item (Blackmagic Micro Converter)
    await trx('inventory_items').insert({
      id: invConvId,
      itemname: 'Blackmagic Micro Converter SDI to HDMI 12G',
      itemdescription: 'Broadcast quality SDI to HDMI converter with 33 point 3D LUT support',
      make: 'Blackmagic Design',
      model: 'CONVCMIC/SH12G',
      srno: 'BMD-CNV-BATCH-99',
      serialno: 'BMD-CNV-BATCH-99',
      product_id: converterProdId,
      folderid: 'IF-INBOX',
      kindid: 'IK-MISC',
      status: 'In Store',
      currentlocation: 'Mumbai Central Hub',
      currency: 'INR',
      asset_value: 12500.00,
      quantity_total: 5.000000,
      quantity_available: 5.000000,
      quantity_reserved: 0.000000,
      quantity_precision: 0,
      quantity_unit: 'pcs',
      is_quantity_tracked: 1,
      is_batch: 0,
      is_set: 0,
      qrcode: await qrcode.toDataURL(invConvId),
      client_label: clientLabelFromId(invConvId),
      is_deleted: 0,
      lastupdated: now
    });

    console.log(`[SEED 4/4] Inventory created: Bulk ${invBulkId} (10 drums), Conversion-ready ${invConvId} (5 pcs)`);
    });
  } catch (err) {
    console.error('[SEED ERROR]', err);
    throw err;
  } finally {
    try {
      await db.raw("SET session_replication_role = 'origin'");
    } catch (e) {
      console.warn('Could not restore session_replication_role:', e.message);
    }
  }

  await flushRedisCache();

  console.log('\n=== CLEAN SLATE & SEED COMPLETED SUCCESSFULLY ===');
}

if (require.main === module) {
  cleanSlateAndSeed()
    .then(() => {
      console.log('Script execution finished.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Script failed:', err);
      process.exit(1);
    });
}

module.exports = { cleanSlateAndSeed };
