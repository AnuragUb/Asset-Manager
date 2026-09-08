/**
 * Phase 8 Zoho Product field capability.
 *
 * Captured READ-ONLY via inspectModuleFields('Products') on 2026-08-29
 * against the connected org (34 fields). See
 * scripts/reports/phase8-zoho-product-fields.json.
 *
 * Do not invent Zoho custom fields. Do not send Price or stock quantity.
 */
const INSPECTED_AT = '2026-08-29T06:37:34.562Z';

const WRITE_FIELDS = Object.freeze({
  Product_Name: { send: true, source: 'name', sdk: 'PRODUCT_NAME', custom: false },
  Description: { send: true, source: 'description', sdk: 'DESCRIPTION', custom: false },
  Product_Code: { send: 'if_non_null', source: 'product_code', sdk: 'PRODUCT_CODE', custom: false },
  Make: { send: 'if_non_null', source: 'make', sdk: null, custom: true },
  Model: { send: 'if_non_null', source: 'model', sdk: null, custom: true },
  HSN_Code: { send: 'if_non_null', source: 'hsn_code', sdk: null, custom: true }
});

const NEVER_SEND = Object.freeze([
  'Unit_Price',
  'Qty_in_Stock',
  'Qty_Ordered',
  'Qty_in_Demand',
  'Reorder_Level'
]);

const PRESENT_BUT_UNMAPPED = Object.freeze({
  Unit: 'No Zoho field named Unit. Usage_Unit is a picklist; AE unit is free text.',
  Usage_Unit: 'Picklist. Not mapped from AE free-text unit.',
  Product_Category: 'Picklist. Distinct from AE Kind / Product Category. Not mapped.',
  Manufacturer: 'Present on Zoho. Not in the approved Phase 8 write payload.'
});

const GET_FIELDS = 'Product_Name,Unit_Price,Description,Product_Code,Make,Model,HSN_Code';

module.exports = {
  INSPECTED_AT,
  WRITE_FIELDS,
  NEVER_SEND,
  PRESENT_BUT_UNMAPPED,
  GET_FIELDS
};
