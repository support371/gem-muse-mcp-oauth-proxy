// POST /relay/reply — store Muse's reply to a queued chat message.
// Body: { message_id, reply }. Protected by RELAY_SECRET
// (header x-relay-secret). Used by the polling job after it answers.
import { kvConfigured, kvStoreReply } from './_kv.js';
import { getRelaySecret, readJsonBody, safeEqual, sendJson } from './_lib.js';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, { allow: 'POST' });
    res.end();
    return;
  }
  const secret = getRelaySecret();
  if (!secret) {
    sendJson(res, 503, {
      error: 'not_configured',
      error_description: 'RELAY_SECRET is not set on this deployment.',
    });
    return;
  }
  if (!safeEqual(req.headers['x-relay-secret'], secret)) {
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: 'invalid_request' });
    return;
  }
  if (
    !body ||
    typeof body.message_id !== 'string' ||
    typeof body.reply !== 'string' ||
    !body.reply.trim()
  ) {
    sendJson(res, 400, {
      error: 'invalid_request',
      error_description: 'message_id and reply are required.',
    });
    return;
  }
  if (!kvConfigured()) {
    sendJson(res, 503, {
      error: 'not_configured',
      error_description: 'Message store is not configured on this deployment.',
    });
    return;
  }
  try {
    await kvStoreReply(body.message_id, body.reply.trim());
    sendJson(res, 200, { ok: true });
  } catch {
    sendJson(res, 502, { error: 'store_unavailable' });
  }
}
