// GET /mcp and POST /mcp
// The proxied MCP endpoint. Requires a valid proxy access token (Bearer
// JWT issued by /oauth/token). On success, forwards the request to the
// bridge with the bridge bearer token held server-side, and streams the
// bridge response back unchanged (including SSE streams).
import { Readable } from 'node:stream';
import {
  getBridgeToken,
  getBridgeUrl,
  getOrigin,
  verifyJwt,
} from './_lib.js';

export const config = { api: { bodyParser: false } };

const FORWARDED_REQUEST_HEADERS = [
  'content-type',
  'accept',
  'mcp-session-id',
  'mcp-protocol-version',
];

const FORWARDED_RESPONSE_HEADERS = [
  'content-type',
  'mcp-session-id',
  'mcp-protocol-version',
  'cache-control',
];

function unauthorized(res, origin) {
  res.writeHead(401, {
    'www-authenticate':
      'Bearer resource_metadata="' +
      origin +
      '/.well-known/oauth-protected-resource/mcp"',
    'content-type': 'application/json',
    'cache-control': 'no-store',
  });
  res.end(
    JSON.stringify({
      error: 'unauthorized',
      error_description: 'A valid access token is required.',
    }),
  );
}

// Read the raw request body. If the platform pre-parsed it into req.body,
// use that; otherwise read the stream.
async function readRequestBody(req) {
  if (req.body !== undefined) {
    if (typeof req.body === 'string') return req.body;
    if (Buffer.isBuffer(req.body)) return req.body;
    return JSON.stringify(req.body);
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.writeHead(405, { allow: 'GET, POST' });
    res.end();
    return;
  }

  const origin = getOrigin(req);

  const auth = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/.exec(auth);
  const payload = match ? verifyJwt(match[1]) : null;
  if (!payload || payload.type !== 'access_token') {
    unauthorized(res, origin);
    return;
  }

  const bridgeToken = getBridgeToken();
  if (!bridgeToken) {
    res.writeHead(503, { 'content-type': 'text/plain' });
    res.end(
      'Proxy not configured: BRIDGE_BEARER_TOKEN is not set on this deployment.',
    );
    return;
  }

  const headers = {};
  for (const name of FORWARDED_REQUEST_HEADERS) {
    if (req.headers[name] !== undefined) headers[name] = req.headers[name];
  }
  headers.authorization = 'Bearer ' + bridgeToken;

  const isBodyless = req.method === 'GET' || req.method === 'HEAD';
  let body;
  if (!isBodyless) {
    body = await readRequestBody(req);
  }

  let upstream;
  try {
    upstream = await fetch(getBridgeUrl(), {
      method: req.method,
      headers,
      body: isBodyless ? undefined : body,
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'bad_gateway',
        error_description: 'Could not reach the bridge.',
      }),
    );
    return;
  }

  const outHeaders = {};
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) outHeaders[name] = value;
  }
  res.writeHead(upstream.status, outHeaders);
  if (upstream.body) {
    Readable.fromWeb(upstream.body).pipe(res);
  } else {
    res.end();
  }
}
