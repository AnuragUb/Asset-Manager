/**
 * Apply a Set to a Delivery Challan (PHYSICAL_TALLY_AUTHORITY_ADR §10).
 *
 * A Set is a product recipe (set_requirement: product × quantity). Physical units are
 * chosen only when the Set is put on a DC. DC items that belong to a Set carry:
 *   setId, setName, setKits, setGroup (one per applied Set), setRequirementId
 * On draft create every requirement must be fully picked (required × kits). An Asset
 * line asking for fewer units than the Asset holds is split with Break first, because a
 * DC Asset line always moves the whole record.
 */
const { db } = require('../utils');
const reasonCatalog = require('./dcReasonCatalog');
const breakService = require('./breakService');

const EPS = 1e-9;

function httpError(message, statusCode, reasonCode, details) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (reasonCode) err.reasonCode = reasonCode;
  if (details) err.details = details;
  return err;
}

function trimText(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtQty(v) {
  return String(Math.round(num(v) * 1e6) / 1e6);
}

async function outOrExitedStatuses() {
  return [...new Set([
    'sold', 'scraped', 'retired', 'consumed',
    'replaced', 'issued foc', 'returned to vendor',
    'out on demo', 'out on rental', 'out for repair',
    'demo', 'rental', 'in-repair',
    ...(await reasonCatalog.assetStatuses())
  ])];
}

async function loadActiveSet(runner, setId) {
  const id = trimText(setId);
  if (!id) throw httpError('setId is required', 400, 'SET_REQUIRED');
  const row = await runner('managed_sets').whereRaw('LOWER(id) = LOWER(?)', [id]).first();
  if (!row) throw httpError(`Set ${id} not found`, 404, 'SET_NOT_FOUND');
  if (String(row.status || '').toUpperCase() !== 'ACTIVE') {
    throw httpError(`Set ${row.name || row.id} is ${row.status}; only ACTIVE Sets can be put on a DC`, 409, 'SET_NOT_ACTIVE');
  }
  return row;
}

async function loadRequirements(runner, setId) {
  const rows = await runner('set_requirement as r')
    .leftJoin('product as p', 'p.id', 'r.product_id')
    .where('r.set_id', setId)
    .orderBy('r.sort_order', 'asc')
    .orderBy('r.created_at', 'asc')
    .select('r.id', 'r.product_id', 'r.quantity', 'r.unit', 'p.name as product_name', 'p.make', 'p.model');
  if (!rows.length) {
    throw httpError('This Set has no product requirements, so it cannot be put on a DC', 409, 'SET_NO_REQUIREMENTS');
  }
  return rows;
}

function parseKits(raw) {
  const kits = Number(raw == null || raw === '' ? 1 : raw);
  if (!Number.isInteger(kits) || kits < 1 || kits > 500) {
    throw httpError('Number of kits must be a whole number between 1 and 500', 400, 'INVALID_KITS');
  }
  return kits;
}

/** ACTIVE Sets that have at least one requirement, for the DC "Add Set" picker. */
async function listSets({ q } = {}) {
  let query = db('managed_sets as s')
    .whereRaw("UPPER(s.status) = 'ACTIVE'")
    .whereExists(function hasRequirements() {
      this.select(db.raw('1')).from('set_requirement as r').whereRaw('r.set_id = s.id');
    })
    .select('s.id', 's.name', 's.set_code', 's.product_id')
    .orderBy('s.name', 'asc')
    .limit(200);
  const needle = trimText(q);
  if (needle) {
    query = query.andWhere(function search() {
      this.whereILike('s.name', `%${needle}%`).orWhereILike('s.id', `%${needle}%`).orWhereILike('s.set_code', `%${needle}%`);
    });
  }
  const sets = await query;
  const counts = sets.length
    ? await db('set_requirement').whereIn('set_id', sets.map((s) => s.id)).groupBy('set_id').select('set_id').count('* as n')
    : [];
  const countBy = new Map(counts.map((c) => [c.set_id, Number(c.n)]));
  return sets.map((s) => ({
    id: s.id,
    name: s.name,
    setCode: s.set_code,
    productId: s.product_id || null,
    requirementCount: countBy.get(s.id) || 0
  }));
}

/**
 * For each requirement, the in-store holdings of that Product that a DC may take
 * (same eligibility as /api/dc/holdings-search).
 */
async function pickOptions(setId, { kits: rawKits } = {}) {
  const kits = parseKits(rawKits);
  const set = await loadActiveSet(db, setId);
  const requirements = await loadRequirements(db, set.id);
  const statuses = await outOrExitedStatuses();
  const productIds = [...new Set(requirements.map((r) => r.product_id))];

  const eligible = (table) => {
    let query = db(table)
      .whereIn('product_id', productIds)
      .where(function notDeleted() { this.where('is_deleted', 0).orWhereNull('is_deleted'); })
      .andWhere(function notOut() {
        this.whereNull('status').orWhereRaw(
          `LOWER(TRIM(status)) NOT IN (${statuses.map(() => '?').join(', ')})`,
          statuses
        );
      })
      .andWhere('quantity_total', '>', 0)
      .andWhere('quantity_available', '>', 0)
      .andWhere(function active() { this.whereNull('lineage_status').orWhereRaw("UPPER(lineage_status) = 'ACTIVE'"); });
    if (table === 'assets') {
      query = query.andWhere(function notRetired() { this.where('is_retired', 0).orWhereNull('is_retired'); });
    }
    return query;
  };

  const assets = await eligible('assets')
    .select('id', 'itemname', 'srno', 'status', 'currentlocation', 'product_id', 'quantity_total',
      'quantity_available', 'quantity_unit', 'is_quantity_tracked')
    .orderBy('itemname', 'asc')
    .limit(500);
  let inventory = [];
  if (await db.schema.hasTable('inventory_items')) {
    inventory = await eligible('inventory_items')
      .select('id', 'itemname', 'status', 'currentlocation', 'product_id', 'quantity_total',
        'quantity_available', 'quantity_unit')
      .orderBy('itemname', 'asc')
      .limit(500);
  }

  const { universalDecrypt: decrypt } = require('./encryptionService');

  const holdingsFor = (productId) => [
    ...assets.filter((a) => a.product_id === productId).map((a) => {
      const tracked = Number(a.is_quantity_tracked) === 1;
      const available = tracked ? num(a.quantity_available) : 1;
      return {
        resourceType: 'ASSET',
        resourceId: a.id,
        name: a.itemname || a.id,
        srNo: (() => { try { return decrypt(a.srno) || ''; } catch (_) { return ''; } })(),
        status: a.status,
        location: a.currentlocation,
        quantityTotal: tracked ? num(a.quantity_total) : 1,
        quantityAvailable: available,
        unit: a.quantity_unit || 'Nos',
        splittable: tracked && available > 1
      };
    }),
    ...inventory.filter((i) => i.product_id === productId).map((i) => ({
      resourceType: 'INVENTORY',
      resourceId: i.id,
      name: i.itemname || i.id,
      srNo: '',
      status: i.status,
      location: i.currentlocation,
      quantityTotal: num(i.quantity_total),
      quantityAvailable: num(i.quantity_available),
      unit: i.quantity_unit || 'Nos',
      splittable: true
    }))
  ];

  // SET_COMMERCIAL_DEFINITION_ADR §5: the printed DC shows the kit as one line with the
  // Set name and the commercial product's description.
  const product = set.product_id
    ? await db('product').where({ id: set.product_id }).first('description', 'hsn_code', 'make', 'model')
    : null;
  const description = trimText(product && product.description)
    || require('./productService').renderSetDescription(set.name, requirements);

  return {
    set: {
      id: set.id,
      name: set.name,
      setCode: set.set_code,
      productId: set.product_id || null,
      description,
      hsn: trimText(product && product.hsn_code) || '',
      make: trimText(product && product.make) || '',
      model: trimText(product && product.model) || ''
    },
    kits,
    requirements: requirements.map((r) => {
      const holdings = holdingsFor(r.product_id);
      const needed = num(r.quantity) * kits;
      const inStock = holdings.reduce((acc, h) => acc + h.quantityAvailable, 0);
      return {
        id: r.id,
        productId: r.product_id,
        productName: r.product_name || r.product_id,
        make: r.make || null,
        model: r.model || null,
        unit: r.unit || 'Nos',
        perKit: num(r.quantity),
        needed,
        inStock,
        short: Math.max(0, needed - inStock),
        holdings
      };
    })
  };
}

function isSetItem(item) {
  return item && trimText(item.setId) && trimText(item.setGroup);
}

/**
 * Validate the Set-tagged items of a DC draft (inside the create transaction) and split
 * multi-unit Assets so each line holds exactly the picked quantity. Mutates items in place.
 * @returns {{ groups: number, splits: Array<{ from: string, to: string, quantity: number }> }}
 */
async function prepareSetItems(trx, items, { actor, host } = {}) {
  const list = Array.isArray(items) ? items : [];
  const setItems = list.filter(isSetItem);
  if (!setItems.length) return { groups: 0, splits: [] };

  const seen = new Set();
  for (const item of list) {
    const rid = trimText(item.assetId || item.resourceId);
    if (!rid) continue;
    const key = `${String(item.resourceType || 'ASSET').toUpperCase()}:${rid.toLowerCase()}`;
    if (seen.has(key)) {
      throw httpError(`${rid} appears more than once on this DC; pick it once with the full quantity`, 400, 'DC_DUPLICATE_HOLDING');
    }
    seen.add(key);
  }

  const groups = new Map();
  for (const item of setItems) {
    const g = String(item.setGroup);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(item);
  }

  const splits = [];
  for (const [groupId, groupItems] of groups) {
    const setIds = new Set(groupItems.map((i) => String(i.setId).toLowerCase()));
    const kitValues = new Set(groupItems.map((i) => String(i.setKits == null ? 1 : i.setKits)));
    if (setIds.size !== 1 || kitValues.size !== 1) {
      throw httpError(`Set group ${groupId} mixes different Sets or kit counts`, 400, 'SET_GROUP_INVALID');
    }
    const set = await loadActiveSet(trx, groupItems[0].setId);
    const kits = parseKits(groupItems[0].setKits);
    const requirements = await loadRequirements(trx, set.id);
    const reqById = new Map(requirements.map((r) => [r.id, r]));
    const picked = new Map(requirements.map((r) => [r.id, 0]));

    for (const item of groupItems) {
      const req = reqById.get(trimText(item.setRequirementId));
      if (!req) {
        throw httpError(`A line of ${set.name} is not linked to one of its components`, 400, 'SET_REQUIREMENT_INVALID');
      }
      const resourceType = String(item.resourceType || 'ASSET').toUpperCase() === 'INVENTORY' ? 'INVENTORY' : 'ASSET';
      const table = resourceType === 'INVENTORY' ? 'inventory_items' : 'assets';
      const rid = trimText(item.assetId || item.resourceId);
      const holding = rid
        ? await trx(table).whereRaw('LOWER(id) = LOWER(?)', [rid]).forUpdate().first()
        : null;
      if (!holding) throw httpError(`${rid || 'A line'} of ${set.name} was not found`, 404, 'SET_HOLDING_NOT_FOUND');
      if (String(holding.product_id || '') !== String(req.product_id)) {
        throw httpError(`${holding.id} is not ${req.product_name || req.product_id}`, 409, 'SET_PRODUCT_MISMATCH');
      }
      const qty = num(item.qty);
      if (!(qty > 0)) throw httpError(`Enter a quantity for ${holding.id}`, 400, 'SET_QTY_REQUIRED');

      if (resourceType === 'ASSET') {
        const tracked = Number(holding.is_quantity_tracked) === 1;
        const total = tracked ? num(holding.quantity_total) : 1;
        const available = tracked ? num(holding.quantity_available) : 1;
        if (qty - available > EPS) {
          throw httpError(`${holding.id} has ${fmtQty(available)} available; ${set.name} line asks for ${fmtQty(qty)}`, 409, 'SET_INSUFFICIENT_QUANTITY');
        }
        if (total - qty > EPS) {
          const broken = await breakService.breakQuantity({
            holdingType: 'ASSET',
            parentId: holding.id,
            mode: 'BREAK',
            amount: qty,
            actor: actor || 'dc',
            host,
            trx
          });
          const child = (broken.children || [])[0];
          if (!child) throw httpError(`Could not split ${holding.id}`, 500, 'SET_SPLIT_FAILED');
          splits.push({ from: holding.id, to: child.id, quantity: qty });
          item.splitFrom = holding.id;
          item.assetId = child.id;
          if (item.resourceId) item.resourceId = child.id;
        }
      } else if (qty - num(holding.quantity_available) > EPS) {
        throw httpError(`${holding.id} has ${fmtQty(holding.quantity_available)} available; ${set.name} line asks for ${fmtQty(qty)}`, 409, 'SET_INSUFFICIENT_QUANTITY');
      }
      picked.set(req.id, picked.get(req.id) + qty);
    }

    const problems = [];
    for (const req of requirements) {
      const needed = num(req.quantity) * kits;
      const got = picked.get(req.id);
      if (Math.abs(got - needed) > EPS) {
        problems.push(`${req.product_name || req.product_id}: picked ${fmtQty(got)} of ${fmtQty(needed)}`);
      }
    }
    if (problems.length) {
      throw httpError(`${set.name} × ${kits} is not complete — ${problems.join('; ')}`, 409, 'SET_INCOMPLETE', { problems });
    }
  }
  return { groups: groups.size, splits };
}

module.exports = {
  listSets,
  pickOptions,
  prepareSetItems,
  isSetItem
};
