// GET /oauth/authorize and POST /oauth/authorize
// The human approval step. GET renders a plain approve page showing which
// client is asking and what scope it wants. POST checks the admin password
// (constant-time) and, on success, redirects back to the client with a
// signed authorization code (JWT, 10-minute expiry) that binds client_id,
// redirect_uri and the PKCE challenge.
import {
  escapeHtml,
  getAdminPassword,
  isValidRedirectUri,
  parseQuery,
  readFormBody,
  safeEqual,
  sendHtml,
  signJwt,
} from './_lib.js';

export const config = { api: { bodyParser: false } };

function page(title, body) {
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' +
    escapeHtml(title) +
    '</title></head><body style="font-family:sans-serif;max-width:480px;margin:48px auto;padding:0 16px;">' +
    '<h1>' +
    escapeHtml(title) +
    '</h1>' +
    body +
    '</body></html>'
  );
}

function errorPage(res, status, title, message) {
  sendHtml(
    res,
    status,
    page(
      title,
      '<p>' + escapeHtml(message) + '</p><p><a href="javascript:history.back()">Go back</a></p>',
    ),
  );
}

// Shared validation of the authorize request parameters, whether they came
// from the query string (GET) or the form body (POST).
function validateParams(p) {
  if (p.response_type !== 'code') {
    return 'response_type must be "code".';
  }
  if (!p.client_id) {
    return 'client_id is required.';
  }
  if (!p.redirect_uri || !isValidRedirectUri(p.redirect_uri)) {
    return 'redirect_uri must be an https URL (http is allowed only for localhost).';
  }
  if (!p.code_challenge) {
    return 'code_challenge is required.';
  }
  if (
    p.code_challenge_method !== undefined &&
    p.code_challenge_method !== 'S256'
  ) {
    return 'Only the S256 code challenge method is supported.';
  }
  const scope = p.scope || 'mcp';
  if (scope !== 'mcp') {
    return 'Only the "mcp" scope is supported.';
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const q = parseQuery(req);
    const error = validateParams(q);
    if (error) {
      errorPage(res, 400, 'Invalid request', error);
      return;
    }

    const hidden = [
      'response_type',
      'client_id',
      'redirect_uri',
      'scope',
      'state',
      'code_challenge',
      'code_challenge_method',
    ]
      .filter((name) => q[name] !== undefined)
      .map(
        (name) =>
          '<input type="hidden" name="' +
          name +
          '" value="' +
          escapeHtml(q[name]) +
          '">',
      )
      .join('\n');

    sendHtml(
      res,
      200,
      page(
        'Connect to the GEM Muse MCP Bridge',
        '<p>An app wants to connect to the GEM Muse MCP Bridge through this proxy.</p>' +
          '<p><strong>Client:</strong> ' +
          escapeHtml(q.client_id) +
          '<br><strong>Access requested:</strong> ' +
          escapeHtml(q.scope || 'mcp') +
          '</p>' +
          '<form method="post" action="/oauth/authorize">' +
          hidden +
          '<label for="password">Admin password</label><br>' +
          '<input type="password" id="password" name="password" required autocomplete="current-password" style="width:100%;padding:8px;margin:6px 0 12px;box-sizing:border-box;">' +
          '<br><button type="submit" style="padding:10px 20px;">Approve</button>' +
          '</form>' +
          '<p>Only approve this if you started the connection yourself.</p>',
      ),
    );
    return;
  }

  if (req.method === 'POST') {
    let form;
    try {
      form = await readFormBody(req);
    } catch {
      errorPage(res, 400, 'Invalid request', 'Could not read the form.');
      return;
    }

    const error = validateParams(form);
    if (error) {
      errorPage(res, 400, 'Invalid request', error);
      return;
    }

    const adminPassword = getAdminPassword();
    if (!adminPassword) {
      errorPage(
        res,
        503,
        'Not configured',
        'The proxy has no admin password set. The owner must set OAUTH_ADMIN_PASSWORD before anyone can approve a connection.',
      );
      return;
    }

    if (!form.password || !safeEqual(form.password, adminPassword)) {
      errorPage(
        res,
        401,
        'Wrong password',
        'The password did not match. Go back and try again.',
      );
      return;
    }

    const code = signJwt(
      {
        type: 'auth_code',
        client_id: form.client_id,
        redirect_uri: form.redirect_uri,
        code_challenge: form.code_challenge,
        scope: form.scope || 'mcp',
      },
      600,
    );

    const dest = new URL(form.redirect_uri);
    dest.searchParams.set('code', code);
    if (form.state) dest.searchParams.set('state', form.state);
    res.writeHead(302, { location: dest.toString() });
    res.end();
    return;
  }

  res.writeHead(405, { allow: 'GET, POST' });
  res.end();
}
