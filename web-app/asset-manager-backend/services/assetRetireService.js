/**
 * Asset Retire — controlled permanent exit that is not a sale
 * (PHYSICAL_TALLY_AUTHORITY_ADR §4).
 *
 * Mirrors DC SALE asset semantics: status + is_retired, quantity fields untouched.
 * Serial notations are retired (LOST for reason LOST); the asset's srno text is
 * kept as historical record.
 */
const { db } = require('../utils');

const RETIRE_REASONS = Object.freeze(['SCRAPPED', 'LOST', 'DAMAGED_BEYOND_REPAIR', 'WRITTEN_OFF']);
const RETIRE_REASON_LABELS = Object.freeze({
  SCRAPPED: 'Scrapped',
  LOST: 'Lost',
  DAMAGED_BEYOND_REPAIR: 'Damaged beyond repair',
  WRITTEN_OFF: 'Written off'
});
const BLOCKING_STATUSES = Object.freeze([
  'sold', 'scraped', 'retired',
  'out on demo', 'out on rental', 'out for repair',
  'out for internal use', 'in transit',
  'demo', 'rental', 'in-repair'
]);

function httpError(message, status, reasonCode, details) {
  const err = new Error(message);
  err.status = status;
  if (reasonCode) err.reasonCode = reasonCode;
  if (details) err.details = details;
  return err;
}

async function retireAsset({ assetId, reason, note, actor, logHistory } = {}) {
  const id = String(assetId || '').trim();
  if (!id) throw httpError('Asset ID is required', 400, 'INVALID_ASSET');
  const reasonKey = String(reason || '').trim().toUpperCase();
  if (!RETIRE_REASONS.includes(reasonKey)) {
    throw httpError(`reason must be one of ${RETIRE_REASONS.join(', ')}`, 400, 'INVALID_RETIRE_REASON');
  }
  const noteText = note == null ? '' : String(note).trim().slice(0, 2000);
  const who = String(actor || 'web');

  return db.transaction(async (trx) => {
    const asset = await trx('assets').whereRaw('LOWER(id) = LOWER(?)', [id]).forUpdate().first();
    if (!asset || Number(asset.is_deleted) === 1) throw httpError(`Asset ${id} not found`, 404, 'ASSET_NOT_FOUND');

    const status = String(asset.status || '').trim().toLowerCase();
    if (Number(asset.is_retired) === 1 || ['sold', 'scraped', 'retired'].includes(status)) {
      throw httpError(`Asset ${asset.id} is already sold or retired`, 409, 'ASSET_ALREADY_EXITED');
    }
    // Merged back or reclassified to inventory: the quantity now lives on another holding.
    if (String(asset.lineage_status || 'ACTIVE').trim().toUpperCase() !== 'ACTIVE') {
      throw httpError(
        `Asset ${asset.id} is closed (merged or reclassified to inventory) and cannot be retired. Retire the holding that now carries its quantity.`,
        409,
        'ASSET_INACTIVE'
      );
    }
    const returnableOut = await require('./dcReasonCatalog').assetStatuses({ returnable: true });
    if (BLOCKING_STATUSES.includes(status) || returnableOut.includes(status)) {
      throw httpError(
        `Asset ${asset.id} is currently "${asset.status}". Return it through its DC before retiring.`,
        409,
        'ASSET_OUT_ON_DC'
      );
    }
    if (Number(asset.is_set) === 1) {
      throw httpError('Set containers cannot be retired. Retire the individual components instead.', 409, 'ASSET_IS_SET');
    }

    const reservation = await trx('reservation')
      .where({ resource_type: 'ASSET', status: 'ACTIVE' })
      .whereRaw('LOWER(resource_id) = LOWER(?)', [asset.id])
      .first();
    if (reservation) {
      throw httpError(
        `Asset ${asset.id} is reserved (${reservation.owner_type} ${reservation.owner_id}). Release the reservation first.`,
        409,
        'ASSET_RESERVED',
        { reservationId: reservation.id, ownerType: reservation.owner_type, ownerId: reservation.owner_id }
      );
    }

    if (await trx.schema.hasTable('managed_set_components')) {
      const component = await trx('managed_set_components')
        .where({ is_active: true })
        .whereRaw('LOWER(asset_id) = LOWER(?)', [asset.id])
        .first();
      if (component) {
        throw httpError(
          `Asset ${asset.id} is a component of Set ${component.set_id}. Remove it from the Set first.`,
          409,
          'ASSET_IN_SET',
          { setId: component.set_id }
        );
      }
    }

    const openDc = await trx('delivery_challans')
      .whereIn('lifecycle_status', ['DRAFT', 'READY'])
      .whereNull('voided_at')
      .andWhere(function () {
        this.where('is_deleted', 0).orWhereNull('is_deleted');
      })
      .andWhereRaw('LOWER(CAST(assetids AS text)) LIKE ?', [`%"${asset.id.toLowerCase()}"%`])
      .select('id', 'challanno', 'lifecycle_status')
      .first();
    if (openDc) {
      throw httpError(
        `Asset ${asset.id} is on open DC ${openDc.challanno || openDc.id} (${openDc.lifecycle_status}). Void or dispatch it first.`,
        409,
        'ASSET_ON_OPEN_DC',
        { deliveryChallanId: openDc.id }
      );
    }

    const now = new Date().toISOString();
    await trx('assets').where({ id: asset.id }).update({
      status: 'Retired',
      is_retired: 1,
      retired_at: now,
      retired_by: who,
      retire_reason: reasonKey,
      retire_note: noteText || null,
      lastupdated: now
    });

    let serialsRetired = 0;
    if (await trx.schema.hasTable('serial_identity')) {
      serialsRetired = await trx('serial_identity')
        .where({ resource_type: 'ASSET', status: 'ACTIVE' })
        .whereRaw('LOWER(resource_id) = LOWER(?)', [asset.id])
        .update({ status: reasonKey === 'LOST' ? 'LOST' : 'RETIRED', updated_at: now });
    }

    if (typeof logHistory === 'function') {
      const label = RETIRE_REASON_LABELS[reasonKey];
      await logHistory(
        asset.id,
        'ASSET_RETIRED',
        asset.status,
        'Retired',
        who,
        `Retired: ${label}${noteText ? ` — ${noteText}` : ''}${serialsRetired ? ` (${serialsRetired} serial${serialsRetired === 1 ? '' : 's'} retired)` : ''}`,
        trx
      );
    }

    return {
      assetId: asset.id,
      priorStatus: asset.status,
      status: 'Retired',
      reason: reasonKey,
      retiredAt: now,
      retiredBy: who,
      serialsRetired
    };
  });
}

module.exports = {
  retireAsset,
  RETIRE_REASONS,
  RETIRE_REASON_LABELS
};
