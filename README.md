# GEM Muse MCP OAuth Proxy

A small OAuth 2.1 authorization server that sits in front of the GEM Muse
MCP Bridge so ChatGPT can connect to it.

**Why it exists:** ChatGPT's "Add custom MCP server" form only supports
OAuth, No authentication, or OAuth-or-no-authentication. There is no field
for a static API key or bearer token, and the bridge only accepts a static
bearer token (`MCP_BEARER_TOKEN`). This proxy adds the OAuth layer ChatGPT
needs: ChatGPT signs in with OAuth (dynamic client registration + PKCE),
and the proxy forwards MCP requests to the bridge using the bridge token
held server-side. The bridge itself is not modified.

## How it works

1. ChatGPT discovers the proxy from `/.well-known/oauth-protected-resource/mcp`
   and `/.well-known/oauth-authorization-server`.
2. ChatGPT registers itself at `POST /oauth/register` (RFC 7591, public
   client, no secret).
3. ChatGPT sends the user to `GET /oauth/authorize`. The approve page asks
   for the admin password (`OAUTH_ADMIN_PASSWORD`). On approval, the proxy
   redirects back with a signed authorization code (JWT, 10 minutes).
4. ChatGPT swaps the code at `POST /oauth/token`, proving PKCE, and gets an
   access token (15 minutes) and a refresh token (30 days).
5. ChatGPT calls `POST /mcp` with the access token. The proxy verifies it
   and forwards the request to the bridge with the bridge bearer token,
   streaming the response back.

All tokens are stateless signed JWTs (HS256). The signing key is derived
from the bridge bearer token, so there is no extra signing secret to
manage, and rotating `BRIDGE_BEARER_TOKEN` invalidates every token the
proxy has ever issued.

## Endpoints

| Route | Method | Purpose |
| --- | --- | --- |
| `/` | GET | Status page (configuration as true/false only) |
| `/.well-known/oauth-protected-resource` | GET | Protected Resource Metadata (RFC 9728) |
| `/.well-known/oauth-protected-resource/mcp` | GET | Same metadata, scoped to `/mcp` |
| `/.well-known/oauth-authorization-server` | GET | Authorization Server Metadata (RFC 8414) |
| `/oauth/register` | POST | Dynamic Client Registration (RFC 7591) |
| `/oauth/authorize` | GET, POST | Approve page and approval |
| `/oauth/token` | POST | `authorization_code` and `refresh_token` grants |
| `/mcp` | GET, POST | Proxied MCP endpoint (streamable HTTP, SSE) |

## Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `BRIDGE_BEARER_TOKEN` | Yes | The bridge's bearer token. Also the seed for the proxy's token signing key. Never put it in code or chat. |
| `BRIDGE_URL` | No | Defaults to `https://gem-muse-mcp-bridge.vercel.app/mcp`. |
| `OAUTH_ADMIN_PASSWORD` | Yes | The password typed on the approve page. Pick a strong one. If it is unset, approvals are refused. |

## Run locally

```text
BRIDGE_BEARER_TOKEN=dummy-test-token \
OAUTH_ADMIN_PASSWORD=test-password \
node local-dev.mjs
```

Then open `http://localhost:3100/`. Use dummy values for local testing,
never the real bridge token.

## Deploy to Vercel

1. Put this folder in a Git repository (or deploy the folder with the
   Vercel CLI).
2. Create a Vercel project from it (Node.js 22+, no build step, no
   dependencies to install).
3. In the project settings, add the environment variables above for
   Production and Preview: `BRIDGE_BEARER_TOKEN` and
   `OAUTH_ADMIN_PASSWORD`. Paste the real values yourself in Vercel;
   never commit them.
4. Deploy. Note the project's URL, for example
   `https://gem-muse-mcp-oauth-proxy.vercel.app`.

## Connect ChatGPT

1. In ChatGPT, open Plugins, tap the plus button, then
   **Add custom MCP server**.
2. Name: `GEM Muse MCP Bridge`
3. Connection: Server URL, `https://<your-proxy-domain>/mcp`
4. Authentication: **OAuth**
5. Tick "I understand and want to continue", then **Create as a plugin**.
6. ChatGPT will open the proxy's approve page. Type the admin password
   and approve. ChatGPT then lists the bridge's tools.

## Security notes

- No secret value is ever logged, returned, or written to a file. The
  status page only reports true/false for whether each secret is set.
- The admin password is compared in constant time.
- Redirect URIs must be https (http only for localhost), and fragments
  are rejected.
- The bridge token is only ever sent to the bridge, over https, from the
  server side. ChatGPT never sees it.
- The proxy never stores client registrations, codes, or tokens. Codes,
  access tokens and refresh tokens are signed JWTs, verified on every use.
