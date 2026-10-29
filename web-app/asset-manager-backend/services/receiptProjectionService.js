/**
 * Phase 7 Receipt Note Zoho projection outbox.
 *
 * Physical POST never calls Zoho inside a database transaction.
 * With ZOHO_RECEIPT_MODULE set, post fetches that receipt's Outbound PO from Zoho
 * and creates one custom-module record. Otherwise the outbox is SKIPPED.
 */
const { db } = require('../utils');

const STATUSES = Object.freeze(['PENDING', 'SENT', 'FAILED', 'RETRY', 'SKIPPED']);

let testAdapter = null;

function httpError(message, statusCode, reasonCode, details) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (reasonCode) err.reasonCode = reasonCode;
  if (details) err.details = details;
  return err;
}

function testAdapterReady() {
  return typeof testAdapter === 'object' && testAdapter && typeof testAdapter.createReceipt === 'function';
}

function adapterConfigured() {
  if (testAdapterReady()) return true;
  return require('./zohoReceiptAdapter').isConfigured();
}

function setAdapterForTests(adapter) {
  testAdapter = adapter && typeof adapter.createReceipt === 'function' ? adapter : null;
}

function getAdapter() {
  if (testAdapterReady()) return testAdapter;
  const live = require('./zohoReceiptAdapter');
  return live.isConfigured() ? live : null;
}

function classifyRemoteError(err) {
  const status = Number(err && (err.statusCode || err.status)) || 0;
  const code = String((err && (err.reasonCode || err.code)) || '').toUpperCase();
  if (status === 401 || status === 403) return { retry: false, errorCode: status === 401 ? 'OAUTH_FAILURE' : 'FORBIDDEN' };
  if (status === 429) return { retry: true, errorCode: 'RATE_LIMIT' };
  if (status >= 400 && status < 500) return { retry: false, errorCode: 'REMOTE_4XX' };
  if (status >= 500) return { retry: true, errorCode: 'REMOTE_5XX' };
  if (code.includes('TIMEOUT') || /timeout/i.test(String(err && err.message))) {
    return { retry: true, errorCode: 'TIMEOUT' };
  }
  if (/malformed|invalid json|unexpected token/i.test(String(err && err.message))) {
    return { retry: false, errorCode: 'MALFORMED_RESPONSE' };
  }
  return { retry: true, errorCode: 'REMOTE_FAILURE' };
}

async function enqueue(trx, {
  receiptNoteId,
  poSource,
  poId,
  zohoPoId,
  skipReason
}) {
  const adapter = getAdapter();
  const status = adapter ? 'PENDING' : 'SKIPPED';
  const reason = adapter ? null : (skipReason || 'ADAPTER_NOT_CONFIGURED');
  const now = new Date().toISOString();
  await trx('receipt_projection_outbox').insert({
    receipt_note_id: receiptNoteId,
    po_source: poSource || 'LOCAL',
    po_id: poId || null,
    zoho_po_id: zohoPoId || null,
    zoho_receipt_id: null,
    status,
    idempotency_key: `RN-PROJECT:${receiptNoteId}`,
    attempt_count: 0,
    next_attempt_at: adapter ? now : null,
    last_error: null,
    last_error_code: null,
    request_fingerprint: receiptNoteId,
    skip_reason: reason,
    created_at: now,
    updated_at: now
  });
  return { status, skipReason: reason };
}

async function getOutbox(runner, receiptNoteId) {
  return runner('receipt_projection_outbox').where({ receipt_note_id: receiptNoteId }).first();
}

async function attempt(receiptNoteId, { actor } = {}) {
  const adapter = getAdapter();
  const row = await db('receipt_projection_outbox').where({ receipt_note_id: receiptNoteId }).first();
  if (!row) throw httpError('Projection outbox row not found', 404, 'OUTBOX_NOT_FOUND');
  if (row.status === 'SENT' && row.zoho_receipt_id) {
    return { outbox: row, replayed: true };
  }
  if (!adapter) {
    const now = new Date().toISOString();
    await db('receipt_projection_outbox').where({ id: row.id }).update({
      status: 'SKIPPED',
      skip_reason: 'ADAPTER_NOT_CONFIGURED',
      updated_at: now
    });
    return { outbox: await getOutbox(db, receiptNoteId), skipped: true };
  }

  const note = await db('receipt_note').where({ id: receiptNoteId }).first();
  const lines = await db('receipt_note_line').where({ receipt_note_id: receiptNoteId }).orderBy('sort_order');
  try {
    const result = await adapter.createReceipt({
      receiptNote: note,
      lines,
      idempotencyKey: row.idempotency_key
    });
    const remoteId = result && (result.remoteId || result.id) ? String(result.remoteId || result.id) : null;
    if (!remoteId) {
      throw Object.assign(new Error('Adapter returned a malformed response (missing remote id)'), {
        statusCode: 502,
        reasonCode: 'MALFORMED_RESPONSE'
      });
    }
    const now = new Date().toISOString();
    await db('receipt_projection_outbox').where({ id: row.id }).update({
      status: 'SENT',
      zoho_receipt_id: remoteId,
      attempt_count: Number(row.attempt_count || 0) + 1,
      last_error: null,
      last_error_code: null,
      sent_at: now,
      updated_at: now,
      skip_reason: null
    });
    await db('receipt_event').insert({
      receipt_note_id: receiptNoteId,
      type: 'PROJECTION_SENT',
      actor: actor || null,
      timestamp: now,
      note: `Zoho projection SENT ${remoteId}`,
      metadata_json: JSON.stringify({ zoho_receipt_id: remoteId, correlation: row.idempotency_key })
    });
    return { outbox: await getOutbox(db, receiptNoteId), sent: true };
  } catch (err) {
    const classified = classifyRemoteError(err);
    const now = new Date().toISOString();
    const nextStatus = classified.retry ? 'RETRY' : 'FAILED';
    await db('receipt_projection_outbox').where({ id: row.id }).update({
      status: nextStatus,
      attempt_count: Number(row.attempt_count || 0) + 1,
      last_error: String(err.message || err).slice(0, 2000),
      last_error_code: classified.errorCode,
      next_attempt_at: classified.retry ? new Date(Date.now() + 60 * 1000).toISOString() : null,
      updated_at: now
    });
    await db('receipt_event').insert({
      receipt_note_id: receiptNoteId,
      type: 'PROJECTION_FAILED',
      actor: actor || null,
      timestamp: now,
      note: String(err.message || err).slice(0, 500),
      metadata_json: JSON.stringify({
        errorCode: classified.errorCode,
        retry: classified.retry,
        status: nextStatus
      })
    });
    return { outbox: await getOutbox(db, receiptNoteId), failed: true, errorCode: classified.errorCode };
  }
}

async function projectToZoho(receiptNoteId, actor) {
  if (!adapterConfigured()) {
    throw httpError(
      'Zoho receipt adapter is not configured. Physical receipt is authoritative; no GRN exists.',
      501,
      'ADAPTER_NOT_CONFIGURED'
    );
  }
  return attempt(receiptNoteId, { actor });
}

module.exports = {
  STATUSES,
  adapterConfigured,
  setAdapterForTests,
  enqueue,
  getOutbox,
  attempt,
  projectToZoho
};
