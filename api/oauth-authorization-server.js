// GET /.well-known/oauth-authorization-server
// Authorization Server Metadata (RFC 8414). Tells an OAuth client where to
// register, where to send the user to approve, and where to swap a code
// for tokens.
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
    issuer: origin,
    authorization_endpoint: origin + '/oauth/authorize',
    token_endpoint: origin + '/oauth/token',
    registration_endpoint: origin + '/oauth/register',
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['mcp'],
  });
}
