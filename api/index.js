// GET /
// Small status page. Shows configuration as presence booleans only.
// Never shows any secret value.
import {
  escapeHtml,
  getAdminPassword,
  getBridgeToken,
  getBridgeUrl,
  sendHtml,
} from './_lib.js';

export const config = { api: { bodyParser: false } };

export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.writeHead(405, { allow: 'GET' });
    res.end();
    return;
  }
  sendHtml(
    res,
    200,
    '<!doctype html><html><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>GEM Muse MCP OAuth Proxy</title></head>' +
      '<body style="font-family:sans-serif;max-width:560px;margin:48px auto;padding:0 16px;">' +
      '<h1>GEM Muse MCP OAuth Proxy</h1>' +
      '<p>OAuth proxy in front of the GEM Muse MCP Bridge. ChatGPT connects ' +
      'to this proxy with OAuth; the proxy forwards MCP requests to the ' +
      'bridge using the bridge token held server-side.</p>' +
      '<ul>' +
      '<li>Bridge URL: <code>' +
      escapeHtml(getBridgeUrl()) +
      '</code></li>' +
      '<li>Bridge token configured: ' +
      (getBridgeToken() ? 'true' : 'false') +
      '</li>' +
      '<li>Admin password configured: ' +
      (getAdminPassword() ? 'true' : 'false') +
      '</li>' +
      '</ul>' +
      '<p>MCP endpoint: <code>/mcp</code></p>' +
      '</body></html>',
  );
}
