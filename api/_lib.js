// Shared helpers for the GEM Muse MCP OAuth proxy.
// Node built-ins only. No secret value is ever logged, returned, or written.
import crypto from 'node:crypto';

export const BRIDGE_URL_DEFAULT = 'https://gem-muse-mcp-bridge.vercel.app/mcp';

export function getBridgeUrl() {
  return process.env.BRIDGE_URL || BRIDGE_URL_DEFAULT;
}

export function getBridgeToken() {
  return process.env.BRIDGE_BEARER_TOKEN || '';
}

export function getAdminPassword() {
  return process.env.OAUTH_ADMIN_PASSWORD || '';
}

// Origin of this proxy, derived from the incoming request. Never hardcoded.
export function getOrigin(req) {
  const proto =
    req.headers['x-forwarded-proto'] ||
    (req.socket && req.socket.encrypted ? 'https' : 'http');
  const host =
    req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  return `${proto}://${host}`;
}

// --- base64url ---

export function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64url');
}

export function b64urlDecode(str) {
  return Buffer.from(str, 'base64url');
}

// --- JWT (HS256, node:crypto only) ---
// Signing key is derived from the bridge bearer token, so no extra secret
// env var is needed. Rotating BRIDGE_BEARER_TOKEN invalidates every token
// this proxy has ever issued.

export function signingKey() {
  return crypto
    .createHash('sha256')
    .update('gem-oauth-proxy-signing-v1:' + getBridgeToken())
    .digest('hex');
}

export function signJwt(payload, expiresInSeconds) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + expiresInSeconds };
  const encHeader = b64urlEncode(JSON.stringify(header));
  const encBody = b64urlEncode(JSON.stringify(body));
  const signature = crypto
    .createHmac('sha256', signingKey())
    .update(encHeader + '.' + encBody)
    .digest();
  return encHeader + '.' + encBody + '.' + b64urlEncode(signature);
}

// Returns the payload object on success, or null when the token is invalid
// or expired. Never throws.
export function verifyJwt(token) {
  try {
    if (typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [encHeader, encBody, encSig] = parts;
    const expected = crypto
      .createHmac('sha256', signingKey())
      .update(encHeader + '.' + encBody)
      .digest();
    const actual = b64urlDecode(encSig);
    if (actual.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(actual, expected)) return null;
    const payload = JSON.parse(b64urlDecode(encBody).toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || payload.exp <= now) return null;
    return payload;
  } catch {
    return null;
  }
}

// --- constant-time comparison ---

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a ?? ''), 'utf8');
  const bb = Buffer.from(String(b ?? ''), 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function sha256B64url(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('base64url');
}

// --- redirect URI validation ---
// https only, except plain http on localhost. Fragments are rejected.

export function isValidRedirectUri(value) {
  try {
    const u = new URL(value);
    if (u.hash) return false;
    if (u.protocol === 'https:') return true;
    if (
      u.protocol === 'http:' &&
      (u.hostname === 'localhost' || u.hostname === '127.0.0.1')
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// --- response helpers ---

export function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  });
  res.end(body);
}

export function sendHtml(res, status, html) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(html);
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- request parsing ---
// Vercel may pre-parse the body into req.body; locally it is a raw stream.
// Both shapes are handled, so the handlers behave the same either way.

export async function readRawBody(req) {
  if (req.body !== undefined) {
    if (typeof req.body === 'string') return req.body;
    if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
    return JSON.stringify(req.body);
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

export async function readJsonBody(req) {
  if (req.body !== undefined && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  const raw = await readRawBody(req);
  return JSON.parse(raw);
}

export function readFormBody(req) {
  return readRawBody(req).then((raw) => {
    if (req.body !== undefined && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      return req.body;
    }
    return Object.fromEntries(new URLSearchParams(raw).entries());
  });
}

// Query params: Vercel populates req.query; fall back to parsing req.url.
export function parseQuery(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  const u = new URL(req.url || '/', 'http://localhost');
  return Object.fromEntries(u.searchParams.entries());
}
