/**
 * Zoho CRM Purchase Order adapter.
 *
 * Reuses zohoService.init / FileStore / BigInt boundary.
 * Never calls handleSyncResponse.
 * Never mutates Zoho POs (pull-only GET).
 * Never writes OAuth tokens; scopes live in zohoService.ZOHO_OAUTH_SCOPES.
 */
const ZOHOCRMSDK = require('@zohocrm/nodejs-sdk-8.0');
const zohoService = require('./zohoService');

const PO_GET_FIELDS = [
  'PO_Number',
  'Subject',
  'Vendor_Name',
  'PO_Date',
  'Due_Date',
  'Status',
  'Purchase_Items',
  'Sub_Total',
  'Discount',
  'Tax',
  'Adjustment',
  'Grand_Total',
  'Tracking_Number',
  'Requisition_No'
].join(',');

const LINE_GET_FIELDS = [
  'id',
  'Sequence_Number',
  'Product_Name',
  'Description',
  'Quantity',
  'List_Price',
  'Discount',
  'Tax',
  'Net_Total',
  'Total'
].join(',');

function httpError(message, statusCode, reasonCode, details) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (reasonCode) err.reasonCode = reasonCode;
  if (details) err.details = details;
  return err;
}

function asZohoIdString(value, fieldName) {
  if (value == null || value === '') return null;
  if (typeof zohoService.zohoIdToString === 'function') {
    try {
      return zohoService.zohoIdToString(value);
    } catch (err) {
      throw httpError(err.message || `${fieldName} is not a valid Zoho id`, 400, 'INVALID_ZOHO_ID');
    }
  }
  if (typeof value === 'bigint') return value.toString();
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) {
    throw httpError(`${fieldName} must be a decimal string`, 400, 'INVALID_ZOHO_ID');
  }
  return text;
}

function lookupId(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object') {
    if (typeof value.getId === 'function') {
      try {
        return asZohoIdString(value.getId(), 'lookup');
      } catch {
        return null;
      }
    }
    if (value.id != null) return asZohoIdString(value.id, 'lookup');
  }
  try {
    return asZohoIdString(value, 'lookup');
  } catch {
    return null;
  }
}

function lookupName(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object') {
    try {
      if (typeof value.getName === 'function') {
        const name = value.getName();
        if (name != null && String(name).trim()) return String(name).trim();
      }
    } catch {
      // ignore SDK getter failures
    }
    try {
      if (typeof value.getKeyValue === 'function') {
        for (const key of ['name', 'Name', 'Product_Name']) {
          const got = value.getKeyValue(key);
          if (got == null || got === '') continue;
          if (typeof got === 'object' && typeof got.getValue === 'function') {
            const inner = got.getValue();
            if (inner != null && String(inner).trim()) return String(inner).trim();
          } else if (String(got).trim()) {
            return String(got).trim();
          }
        }
      }
    } catch {
      // ignore SDK getter failures
    }
    if (value.name != null && String(value.name).trim()) return String(value.name).trim();
    if (value.Name != null && String(value.Name).trim()) return String(value.Name).trim();
    if (value.Product_Name != null && String(value.Product_Name).trim()) {
      return String(value.Product_Name).trim();
    }
    return null;
  }
  const text = String(value).trim();
  return text || null;
}

function readKey(record, apiName) {
  try {
    if (!record) return null;
    if (typeof record.getKeyValue === 'function') {
      const value = record.getKeyValue(apiName);
      if (value == null || value === '') return null;
      if (typeof value === 'object' && typeof value.getValue === 'function') {
        return value.getValue();
      }
      return value;
    }
    return record[apiName] != null ? record[apiName] : null;
  } catch {
    return null;
  }
}

function readZohoChoice(responseObject, getter) {
  try {
    if (!responseObject || typeof responseObject[getter] !== 'function') return null;
    const value = responseObject[getter]();
    if (value == null) return null;
    if (typeof value.getValue === 'function') return String(value.getValue());
    return String(value);
  } catch {
    return null;
  }
}

function mapScopeFailure(error) {
  const msg = String((error && error.message) || '');
  const code = String((error && error.code) || '');
  const combined = `${msg} ${code}`;
  if (code === 'ZOHO_NOT_CONFIGURED' || code === 'ZOHO_NOT_AUTHORIZED') {
    return httpError(
      msg || (code === 'ZOHO_NOT_CONFIGURED' ? 'Zoho OAuth is not configured' : 'Zoho is not authorized'),
      401,
      code
    );
  }
  if (/OAUTH_SCOPE_MISMATCH|invalid oauth scope/i.test(combined)) {
    return httpError(
      'Zoho Purchase Order GET requires ZohoCRM.modules.purchaseorders.READ. Reauthorize Zoho to grant this scope.',
      403,
      'PO_OAUTH_SCOPE_REQUIRED'
    );
  }
  if (/NO_PERMISSION/i.test(combined)) {
    return httpError(
      'The connected Zoho user does not have permission to the Purchase Orders module.',
      403,
      'ZOHO_MODULE_PERMISSION'
    );
  }
  const classified = typeof zohoService.classifyZohoError === 'function'
    ? zohoService.classifyZohoError(error)
    : null;
  if (classified === '401') {
    return httpError(msg || 'Zoho access token is invalid or expired', 401, 'ZOHO_401');
  }
  if (classified === 'OAUTH') {
    return httpError(msg || 'Zoho authorization failed', 401, 'ZOHO_OAUTH');
  }
  if (classified === '403') return httpError(msg || 'Zoho forbidden', 403, 'ZOHO_403');
  if (classified === 'RATE_LIMIT') return httpError(msg || 'Zoho rate limited', 429, 'ZOHO_429');
  if (classified === 'TIMEOUT') return httpError(msg || 'Zoho timeout', 504, 'ZOHO_TIMEOUT');
  if (error && error.code === 'ZOHO_PRODUCT_NOT_FOUND') {
    return httpError('Zoho Purchase Order was not found', 404, 'ZOHO_PO_NOT_FOUND');
  }
  return null;
}

function wrapZohoError(error, fallbackCode = 'ZOHO_ERROR') {
  const scoped = mapScopeFailure(error);
  if (scoped) return scoped;
  if (error && error.statusCode) return error;
  const msg = String((error && error.message) || 'Zoho Purchase Order request failed');
  if (/not found|204|404/i.test(msg)) {
    return httpError('Zoho Purchase Order was not found', 404, 'ZOHO_PO_NOT_FOUND');
  }
  const err = httpError(msg, error && error.httpStatus ? error.httpStatus : 502, fallbackCode);
  err.code = error && error.code;
  return err;
}

function picklistStatus(value) {
  const raw = value && typeof value === 'object' && typeof value.getValue === 'function'
    ? value.getValue()
    : value;
  const text = String(raw || '').trim();
  if (!text) return 'CREATED';
  const upper = text.toUpperCase().replace(/\s+/g, '_');
  if (upper === 'CREATED' || upper === 'APPROVED' || upper === 'DELIVERED' || upper === 'CANCELLED') {
    return upper;
  }
  return upper;
}

function decimalOrNull(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object' && typeof value.getValue === 'function') {
    return decimalOrNull(value.getValue());
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Calendar date (YYYY-MM-DD) from Zoho Date / ISO / JS Date.toString dumps. */
function normalizeZohoDate(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object' && typeof value.getValue === 'function') {
    return normalizeZohoDate(value.getValue());
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const text = String(value).trim();
  if (!text) return null;
  const isoDay = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoDay) return isoDay[1];
  const parsed = Date.parse(text);
  if (!Number.isNaN(parsed)) {
    const dt = new Date(parsed);
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dt.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return text;
}

/** ISO timestamp string from Zoho Modified_Time / Date objects. */
function normalizeZohoDateTime(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object' && typeof value.getValue === 'function') {
    return normalizeZohoDateTime(value.getValue());
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  const text = String(value).trim();
  if (!text) return null;
  const parsed = Date.parse(text);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  return text;
}

function normalizeLine(record, index) {
  const rawId = typeof record.getId === 'function' ? record.getId() : readKey(record, 'id');
  if (rawId == null || rawId === '') {
    const err = httpError(
      `Purchase_Items[${index}] has no stable Zoho line id`,
      409,
      'LINE_ID_MISSING'
    );
    throw err;
  }
  const zohoLineId = asZohoIdString(rawId, 'zoho_line_id');
  const productLookup = readKey(record, 'Product_Name');
  const qty = decimalOrNull(readKey(record, 'Quantity'));
  return {
    zohoLineId,
    sequenceNumber: decimalOrNull(readKey(record, 'Sequence_Number')),
    zohoProductId: lookupId(productLookup),
    zohoProductName: lookupName(productLookup) || (productLookup && productLookup.Product_Name) || null,
    description: readKey(record, 'Description') != null ? String(readKey(record, 'Description')) : null,
    quantity: qty == null ? 0 : qty,
    listPrice: decimalOrNull(readKey(record, 'List_Price')),
    discount: decimalOrNull(readKey(record, 'Discount')),
    tax: decimalOrNull(readKey(record, 'Tax')),
    netTotal: decimalOrNull(readKey(record, 'Net_Total')) || decimalOrNull(readKey(record, 'Total')),
    unit: null
  };
}

function normalizePurchaseOrder(record) {
  const rawId = typeof record.getId === 'function' ? record.getId() : readKey(record, 'id');
  const zohoPoId = asZohoIdString(rawId, 'zoho_po_id');
  const vendor = readKey(record, 'Vendor_Name');
  const itemsRaw = readKey(record, 'Purchase_Items') || [];
  const items = Array.isArray(itemsRaw) ? itemsRaw : [];
  const lines = items.map((item, i) => normalizeLine(item, i));
  return {
    zohoPoId,
    poNumber: readKey(record, 'PO_Number') != null ? String(readKey(record, 'PO_Number')) : null,
    subject: readKey(record, 'Subject') != null ? String(readKey(record, 'Subject')) : null,
    status: picklistStatus(readKey(record, 'Status')),
    vendorZohoId: lookupId(vendor),
    vendorName: lookupName(vendor),
    poDate: normalizeZohoDate(readKey(record, 'PO_Date')),
    dueDate: normalizeZohoDate(readKey(record, 'Due_Date')),
    subTotal: decimalOrNull(readKey(record, 'Sub_Total')),
    discount: decimalOrNull(readKey(record, 'Discount')),
    tax: decimalOrNull(readKey(record, 'Tax')),
    grandTotal: decimalOrNull(readKey(record, 'Grand_Total')),
    modifiedTime: normalizeZohoDateTime(readKey(record, 'Modified_Time')),
    lines
  };
}

function unwrapGet(response, notFoundCode) {
  if (response == null) {
    throw httpError('Zoho Purchase Orders returned no response', 502, 'ZOHO_EMPTY_RESPONSE');
  }
  const status = response.getStatusCode && response.getStatusCode();
  if (status === 204 || status === 404) {
    throw httpError('Zoho Purchase Order was not found', 404, notFoundCode);
  }
  const responseObject = response.getObject();
  if (responseObject instanceof ZOHOCRMSDK.Record.APIException) {
    const zohoCode = readZohoChoice(responseObject, 'getCode');
    const msg = readZohoChoice(responseObject, 'getMessage') || zohoCode || 'Zoho API exception';
    const err = new Error(msg);
    err.code = zohoCode || 'ZOHO_API_EXCEPTION';
    err.httpStatus = status;
    throw wrapZohoError(err);
  }
  if (!(responseObject instanceof ZOHOCRMSDK.Record.ResponseWrapper)) {
    throw httpError('Zoho Purchase Orders returned an unexpected response', 502, 'ZOHO_UNEXPECTED_RESPONSE');
  }
  return responseObject.getData() || [];
}

async function getPurchaseOrder(externalId) {
  await zohoService.init();
  const id = asZohoIdString(externalId, 'zoho_po_id');
  try {
    const recordOperations = new ZOHOCRMSDK.Record.RecordOperations('Purchase_Orders');
    const paramInstance = new ZOHOCRMSDK.ParameterMap();
    await paramInstance.add(ZOHOCRMSDK.Record.GetRecordParam.FIELDS, PO_GET_FIELDS);
    const response = await recordOperations.getRecord(
      zohoService.toZohoRecordBigInt(id, 'zoho_po_id'),
      paramInstance
    );
    const records = unwrapGet(response, 'ZOHO_PO_NOT_FOUND');
    if (!records.length) throw httpError('Zoho Purchase Order was not found', 404, 'ZOHO_PO_NOT_FOUND');
    return normalizePurchaseOrder(records[0]);
  } catch (error) {
    if (error && error.reasonCode) throw error;
    throw wrapZohoError(error);
  }
}

async function listPurchaseOrders({ page = 1, perPage = 50 } = {}) {
  await zohoService.init();
  try {
    const recordOperations = new ZOHOCRMSDK.Record.RecordOperations('Purchase_Orders');
    const paramInstance = new ZOHOCRMSDK.ParameterMap();
    await paramInstance.add(ZOHOCRMSDK.Record.GetRecordsParam.FIELDS, PO_GET_FIELDS);
    await paramInstance.add(ZOHOCRMSDK.Record.GetRecordsParam.PAGE, Math.max(1, Number(page) || 1));
    await paramInstance.add(ZOHOCRMSDK.Record.GetRecordsParam.PER_PAGE, Math.min(200, Math.max(1, Number(perPage) || 50)));
    const response = await recordOperations.getRecords(paramInstance);
    const records = unwrapGet(response, 'ZOHO_PO_NOT_FOUND');
    const info = response.getObject() && response.getObject().getInfo && response.getObject().getInfo();
    return {
      purchaseOrders: records.map((row) => normalizePurchaseOrder(row)),
      moreRecords: !!(info && info.getMoreRecords && info.getMoreRecords()),
      page: info && info.getPage ? info.getPage() : page,
      perPage: info && info.getPerPage ? info.getPerPage() : perPage
    };
  } catch (error) {
    if (error && error.reasonCode) throw error;
    throw wrapZohoError(error);
  }
}

async function getPurchaseOrderLines(externalId) {
  const po = await getPurchaseOrder(externalId);
  return po.lines;
}

module.exports = {
  PO_GET_FIELDS,
  LINE_GET_FIELDS,
  listPurchaseOrders,
  getPurchaseOrder,
  getPurchaseOrderLines,
  normalizePurchaseOrder,
  normalizePurchaseOrderLine: normalizeLine,
  asZohoIdString,
  mapScopeFailure,
  wrapZohoError
};
