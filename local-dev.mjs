// Local dev server for the OAuth proxy. Serves the same api handlers that
// Vercel runs, so local behaviour matches the deployment.
//
// Run:  BRIDGE_BEARER_TOKEN=dummy-test-token \
//       OAUTH_ADMIN_PASSWORD=test-password \
//       node local-dev.mjs
// Then open http://localhost:3100/ (or set PORT).
import http from 'node:http';
import authorize from './api/oauth-authorize.js';
import token from './api/oauth-token.js';
import register from './api/oauth-register.js';
import protectedResource from './api/oauth-protected-resource.js';
import authorizationServer from './api/oauth-authorization-server.js';
import mcp from './api/mcp.js';
import index from './api/index.js';

const routes = new Map([
  ['/.well-known/oauth-protected-resource', protectedResource],
  ['/.well-known/oauth-protected-resource/mcp', protectedResource],
  ['/.well-known/oauth-authorization-server', authorizationServer],
  ['/oauth/register', register],
  ['/oauth/authorize', authorize],
  ['/oauth/token', token],
  ['/mcp', mcp],
  ['/', index],
]);

const port = Number(process.env.PORT || 3100);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    req.query = Object.fromEntries(url.searchParams.entries());
    const handler = routes.get(url.pathname);
    if (!handler) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found');
      return;
    }
    await handler(req, res);
  } catch (err) {
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('Internal error');
  }
});

server.listen(port, () => {
  console.log(`GEM Muse MCP OAuth proxy listening on http://localhost:${port}`);
});
