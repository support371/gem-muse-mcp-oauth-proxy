// GET /mcp and POST /mcp
// The proxied MCP endpoint. Requires a valid proxy access token (Bearer
// JWT issued by /oauth/token). On success, forwards the request to the
// bridge with the bridge bearer token held server-side, and streams the
// bridge response back unchanged (including SSE streams).
//
// Two relay tools are answered by the proxy itself, never forwarded:
// muse_send_chat (queue a chat message for Muse) and muse_check_reply
// (fetch Muse's reply). tools/list is forwarded to the bridge and the
// relay tools are appended to the result.
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { kvConfigured, kvGetReply, kvStoreMessage } from './_kv.js';
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

const RELAY_TOOLS = [
  {
    name: 'muse_send_chat',
    description:
      'Send a chat message to Muse. The message is queued for Muse, who replies within a few minutes. Use muse_check_reply with the returned message_id to fetch the reply.',
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'The chat message to send to Muse.',
        },
      },
      required: ['message'],
    },
  },
  {
    name: 'muse_check_reply',
    description:
      'Check whether Muse has replied to a message sent with muse_send_chat.',
    inputSchema: {
      type: 'object',
      properties: {
        message_id: {
          type: 'string',
          description: 'The message_id returned by muse_send_chat.',
        },
      },
      required: ['message_id'],
    },
  },
];

const RELAY_TOOL_NAMES = RELAY_TOOLS.map((t) => t.name);

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

// Parse a tools/list answer from the bridge, whether it came back as
// plain JSON or wrapped in SSE data: lines.
function extractJsonRpc(text) {
  try {
    return JSON.parse(text);
  } catch {
    // Not plain JSON: try SSE.
  }
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith('data:')) continue;
    try {
      return JSON.parse(line.slice(5).trim());
    } catch {
      // Not JSON; keep looking.
    }
  }
  return null;
}

function mcpResultHeaders(req, upstream) {
  const out = {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  };
  const sessionId = upstream ? upstream.headers.get('mcp-session-id') : null;
  if (sessionId) out['mcp-session-id'] = sessionId;
  const proto =
    (upstream && upstream.headers.get('mcp-protocol-version')) ||
    req.headers['mcp-protocol-version'];
  if (proto) out['mcp-protocol-version'] = proto;
  return out;
}

async function handleToolsList(req, res, rpc, headers) {
  let upstream;
  try {
    upstream = await fetch(getBridgeUrl(), {
      method: 'POST',
      headers,
      body: JSON.stringify(rpc),
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: rpc.id ?? null,
        error: { code: -32603, message: 'Could not reach the bridge.' },
      }),
    );
    return;
  }
  const text = await upstream.text();
  const parsed = extractJsonRpc(text);
  const outHeaders = mcpResultHeaders(req, upstream);
  if (!parsed || !parsed.result || !Array.isArray(parsed.result.tools)) {
    // Could not understand the bridge answer: pass it through unchanged.
    res.writeHead(upstream.status, outHeaders);
    res.end(text);
    return;
  }
  parsed.result.tools = [...parsed.result.tools, ...RELAY_TOOLS];
  res.writeHead(200, outHeaders);
  res.end(JSON.stringify(parsed));
}

async function handleRelayCall(req, res, rpc, clientId) {
  const outHeaders = mcpResultHeaders(req, null);
  const id = rpc.id ?? null;
  const send = (obj, isError = false) => {
    res.writeHead(200, outHeaders);
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(obj) }],
          ...(isError ? { isError: true } : {}),
        },
      }),
    );
  };
  if (!kvConfigured()) {
    send(
      {
        status: 'error',
        error: 'Message store is not configured on this deployment.',
      },
      true,
    );
    return;
  }
  const args = (rpc.params && rpc.params.arguments) || {};
  if (rpc.params.name === 'muse_send_chat') {
    const message =
      typeof args.message === 'string' ? args.message.trim() : '';
    if (!message) {
      send({ status: 'error', error: 'message is required.' }, true);
      return;
    }
    if (message.length > 4000) {
      send(
        {
          status: 'error',
          error: 'message is too long (max 4000 characters).',
        },
        true,
      );
      return;
    }
    const record = {
      id: crypto.randomUUID(),
      message,
      from_client: clientId || 'unknown',
      received_at: new Date().toISOString(),
    };
    try {
      await kvStoreMessage(record);
    } catch {
      send(
        { status: 'error', error: 'Could not store the message.' },
        true,
      );
      return;
    }
    send({
      status: 'queued',
      message_id: record.id,
      note: 'Muse will reply within a few minutes. Poll muse_check_reply with this message_id.',
    });
    return;
  }
  // muse_check_reply
  const messageId =
    typeof args.message_id === 'string' ? args.message_id : '';
  if (!messageId) {
    send({ status: 'error', error: 'message_id is required.' }, true);
    return;
  }
  try {
    const reply = await kvGetReply(messageId);
    if (!reply) {
      send({ status: 'waiting', message_id: messageId });
      return;
    }
    send({
      status: 'replied',
      message_id: messageId,
      reply: reply.reply,
      replied_at: reply.replied_at || null,
    });
  } catch {
    send(
      { status: 'error', error: 'Could not check for a reply.' },
      true,
    );
  }
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
  let body = '';
  if (!isBodyless) {
    const raw = await readRequestBody(req);
    body = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
  }

  // Local handling for the relay tools and tools/list.
  if (!isBodyless && body) {
    let rpc = null;
    try {
      rpc = JSON.parse(body);
    } catch {
      rpc = null;
    }
    if (rpc && typeof rpc === 'object' && typeof rpc.method === 'string') {
      if (
        rpc.method === 'tools/call' &&
        rpc.params &&
        RELAY_TOOL_NAMES.includes(rpc.params.name)
      ) {
        await handleRelayCall(req, res, rpc, payload.client_id);
        return;
      }
      if (rpc.method === 'tools/list') {
        await handleToolsList(req, res, rpc, headers);
        return;
      }
    }
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
