// GET /relay/inbox — list queued chat messages not yet answered.
// Protected by RELAY_SECRET (header x-relay-secret). Used by the polling
// job that delivers messages to Muse. Never exposes any secret.
import { kvConfigured, kvListPending } from './_kv.js';
import { getRelaySecret, safeEqual, sendJson } from './_lib.js';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.writeHead(405, { allow: 'GET' });
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
  if (!kvConfigured()) {
    sendJson(res, 503, {
      error: 'not_configured',
      error_description: 'Message store is not configured on this deployment.',
    });
    return;
  }
  try {
    const messages = await kvListPending();
    sendJson(res, 200, { messages });
  } catch {
    sendJson(res, 502, { error: 'store_unavailable' });
  }
}
