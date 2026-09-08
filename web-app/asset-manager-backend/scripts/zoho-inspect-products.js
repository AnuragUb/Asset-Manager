/**
 * READ-ONLY Zoho Products field inspection.
 * Does not create, update, or delete Zoho records.
 * Does not change OAuth tokens or scopes.
 *
 * Run (container): node scripts/zoho-inspect-products.js
 */
const fs = require('fs');
const path = require('path');
const zoho = require('../services/zohoService');

function serializeField(field) {
  const read = (fn) => {
    try {
      if (typeof field[fn] !== 'function') return null;
      const value = field[fn]();
      if (value == null) return null;
      if (typeof value.getValue === 'function') return String(value.getValue());
      return value;
    } catch {
      return null;
    }
  };
  return {
    label: read('getFieldLabel'),
    apiName: read('getAPIName'),
    dataType: read('getDataType'),
    custom: read('getCustomField'),
    readOnly: read('getReadOnly'),
    systemMandatory: read('getSystemMandatory')
  };
}

async function main() {
  const fields = await zoho.inspectModuleFields('Products');
  if (!fields || !Array.isArray(fields) || fields.length === 0) {
    console.error('INSPECT_FAILED: inspectModuleFields returned no fields');
    process.exit(2);
  }
  const rows = fields.map(serializeField).filter((row) => row.apiName);
  const wanted = [
    'Product_Name',
    'Description',
    'Product_Code',
    'Unit_Price',
    'Make',
    'Model',
    'HSN_Code',
    'Qty_in_Stock',
    'Unit',
    'Usage_Unit',
    'Product_Category',
    'Category',
    'Product_Active'
  ];
  const byName = new Map(rows.map((row) => [row.apiName, row]));
  const capability = {};
  for (const name of wanted) {
    capability[name] = byName.has(name) ? byName.get(name) : null;
  }
  const report = {
    ok: true,
    inspectedAt: new Date().toISOString(),
    module: 'Products',
    count: rows.length,
    capability,
    fields: rows
  };
  const outDir = path.join(__dirname, 'reports');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'phase8-zoho-product-fields.json');
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    ok: true,
    count: rows.length,
    outFile,
    capability: Object.fromEntries(
      Object.entries(capability).map(([k, v]) => [k, v ? { apiName: v.apiName, dataType: v.dataType, custom: v.custom } : null])
    )
  }, null, 2));
}

main()
  .then(async () => {
    try {
      const { db } = require('../utils');
      if (db && typeof db.destroy === 'function') await db.destroy();
    } catch (_) {
      /* ignore */
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error('INSPECT_FAILED', err && err.code, err && err.message);
    process.exit(1);
  });
