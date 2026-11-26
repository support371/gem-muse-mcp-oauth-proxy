// Minimal client for the Upstash Redis REST API (Vercel KV).
// Connection values are added automatically when a KV database is linked
// to the project. No secret value is ever logged or returned.
export function kvConfigured() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

async function kvCommand(...args) {
  const base = (process.env.KV_REST_API_URL || '').replace(/\/$/, '');
  const token = process.env.KV_REST_API_TOKEN || '';
  const res = await fetch(base, {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + token,
      'content-type': 'application/json',
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error('KV request failed with status ' + res.status);
  const data = await res.json();
  if (data.error) throw new Error('KV error: ' + data.error);
  return data.result;
}

const INBOX_KEY = 'relay:inbox';
const SEEN_KEY = 'relay:seen';
const REPLIES_KEY = 'relay:replies';

export async function kvStoreMessage(record) {
  await kvCommand('LPUSH', INBOX_KEY, JSON.stringify(record));
}

// Messages queued by ChatGPT that have not been answered yet.
export async function kvListPending() {
  const [items, seen] = await Promise.all([
    kvCommand('LRANGE', INBOX_KEY, '0', '-1'),
    kvCommand('SMEMBERS', SEEN_KEY),
  ]);
  const seenSet = new Set(Array.isArray(seen) ? seen : []);
  return (Array.isArray(items) ? items : [])
    .map((raw) => {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    })
    .filter((m) => m && m.id && !seenSet.has(m.id));
}

export async function kvStoreReply(messageId, reply) {
  const record = { reply, replied_at: new Date().toISOString() };
  await kvCommand('HSET', REPLIES_KEY, messageId, JSON.stringify(record));
  await kvCommand('SADD', SEEN_KEY, messageId);
}

export async function kvGetReply(messageId) {
  const raw = await kvCommand('HGET', REPLIES_KEY, messageId);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
