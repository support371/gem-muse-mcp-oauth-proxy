// GET /.well-known/oauth-protected-resource
// GET /.well-known/oauth-protected-resource/mcp
// Protected Resource Metadata (RFC 9728). Tells an OAuth client which
// authorization server guards this proxy's /mcp endpoint.
import { getOrigin, sendJson } from './_lib.js';

export const config = { api: { bodyParser: false } };

export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.writeHead(405, { allow: 'GET' });
    res.end();
    return;
  }
  const origin = getOrigin(req);
  sendJson(res, 200, {
    resource: origin + '/mcp',
    authorization_servers: [origin],
    bearer_methods_supported: ['header'],
  });
}
