// POST /oauth/register
// Dynamic Client Registration (RFC 7591). ChatGPT registers itself here
// before starting the OAuth flow. No persistence is needed: the signed
// authorization code issued later binds client_id, redirect_uri and the
// PKCE challenge, so registration state is carried in the code itself.
import crypto from 'node:crypto';
import { isValidRedirectUri, readJsonBody, sendJson } from './_lib.js';

export const config = { api: { bodyParser: false } };

const SUPPORTED_GRANTS = ['authorization_code', 'refresh_token'];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, { allow: 'POST' });
    res.end();
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, {
      error: 'invalid_request',
      error_description: 'Request body is not valid JSON.',
    });
    return;
  }

  if (
    !body ||
    typeof body !== 'object' ||
    !Array.isArray(body.redirect_uris) ||
    body.redirect_uris.length === 0 ||
    !body.redirect_uris.every(
      (u) => typeof u === 'string' && isValidRedirectUri(u),
    )
  ) {
    sendJson(res, 400, {
      error: 'invalid_redirect_uri',
      error_description:
        'redirect_uris must be a non-empty array of https URLs (http is allowed only for localhost).',
    });
    return;
  }

  const grantTypes = body.grant_types ?? SUPPORTED_GRANTS;
  const responseTypes = body.response_types ?? ['code'];
  const authMethod = body.token_endpoint_auth_method ?? 'none';

  if (
    !Array.isArray(grantTypes) ||
    grantTypes.length === 0 ||
    !grantTypes.every((g) => SUPPORTED_GRANTS.includes(g))
  ) {
    sendJson(res, 400, {
      error: 'invalid_client_metadata',
      error_description:
        'grant_types must only contain authorization_code and refresh_token.',
    });
    return;
  }

  if (
    !Array.isArray(responseTypes) ||
    responseTypes.length === 0 ||
    !responseTypes.every((r) => r === 'code')
  ) {
    sendJson(res, 400, {
      error: 'invalid_client_metadata',
      error_description: 'response_types must only contain code.',
    });
    return;
  }

  if (authMethod !== 'none') {
    sendJson(res, 400, {
      error: 'invalid_client_metadata',
      error_description:
        'This server only supports public clients (token_endpoint_auth_method "none").',
    });
    return;
  }

  sendJson(res, 201, {
    client_id: crypto.randomUUID(),
    client_name: body.client_name,
    redirect_uris: body.redirect_uris,
    grant_types: grantTypes,
    response_types: responseTypes,
    token_endpoint_auth_method: 'none',
  });
}
