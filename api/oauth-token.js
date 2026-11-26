// POST /oauth/token
// Swaps an authorization code for an access token (with PKCE verification),
// or swaps a refresh token for a new access token. All tokens are stateless
// signed JWTs: access tokens live 15 minutes, refresh tokens 30 days.
import {
  readFormBody,
  safeEqual,
  sendJson,
  sha256B64url,
  signJwt,
  verifyJwt,
} from './_lib.js';

export const config = { api: { bodyParser: false } };

const ACCESS_TTL_SECONDS = 900; // 15 minutes
const REFRESH_TTL_SECONDS = 30 * 24 * 3600; // 30 days

function issueTokens(res, clientId, scope) {
  const access_token = signJwt(
    { type: 'access_token', client_id: clientId, scope },
    ACCESS_TTL_SECONDS,
  );
  const refresh_token = signJwt(
    { type: 'refresh_token', client_id: clientId, scope },
    REFRESH_TTL_SECONDS,
  );
  sendJson(res, 200, {
    access_token,
    token_type: 'Bearer',
    expires_in: ACCESS_TTL_SECONDS,
    refresh_token,
    scope,
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, { allow: 'POST' });
    res.end();
    return;
  }

  let form;
  try {
    form = await readFormBody(req);
  } catch {
    sendJson(res, 400, {
      error: 'invalid_request',
      error_description: 'Could not read the form body.',
    });
    return;
  }

  if (form.grant_type === 'authorization_code') {
    const { code, redirect_uri, client_id, code_verifier } = form;
    if (!code || !redirect_uri || !client_id || !code_verifier) {
      sendJson(res, 400, {
        error: 'invalid_request',
        error_description:
          'code, redirect_uri, client_id and code_verifier are required.',
      });
      return;
    }

    const payload = verifyJwt(code);
    if (!payload || payload.type !== 'auth_code') {
      sendJson(res, 400, {
        error: 'invalid_grant',
        error_description: 'The authorization code is invalid or expired.',
      });
      return;
    }
    if (payload.client_id !== client_id) {
      sendJson(res, 400, {
        error: 'invalid_grant',
        error_description: 'The authorization code was issued to a different client.',
      });
      return;
    }
    if (payload.redirect_uri !== redirect_uri) {
      sendJson(res, 400, {
        error: 'invalid_grant',
        error_description: 'redirect_uri does not match the authorization request.',
      });
      return;
    }
    if (!safeEqual(sha256B64url(code_verifier), payload.code_challenge)) {
      sendJson(res, 400, {
        error: 'invalid_grant',
        error_description: 'The PKCE code verifier does not match the challenge.',
      });
      return;
    }

    issueTokens(res, client_id, payload.scope || 'mcp');
    return;
  }

  if (form.grant_type === 'refresh_token') {
    if (!form.refresh_token) {
      sendJson(res, 400, {
        error: 'invalid_request',
        error_description: 'refresh_token is required.',
      });
      return;
    }
    const payload = verifyJwt(form.refresh_token);
    if (!payload || payload.type !== 'refresh_token') {
      sendJson(res, 400, {
        error: 'invalid_grant',
        error_description: 'The refresh token is invalid or expired.',
      });
      return;
    }
    if (form.client_id && payload.client_id !== form.client_id) {
      sendJson(res, 400, {
        error: 'invalid_grant',
        error_description: 'The refresh token was issued to a different client.',
      });
      return;
    }
    issueTokens(res, payload.client_id, payload.scope || 'mcp');
    return;
  }

  sendJson(res, 400, {
    error: 'unsupported_grant_type',
    error_description:
      'Only authorization_code and refresh_token grants are supported.',
  });
}
