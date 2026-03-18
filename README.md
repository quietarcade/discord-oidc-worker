<p align="center">
  <img src="https://github.com/user-attachments/assets/a992766f-24d7-4271-88b4-62333265a1bf" alt="Herugrim" width="250">
</p>

# Herugrim — Discord OIDC Provider for Cloudflare Access

A fork of [Erisa/discord-oidc-worker](https://github.com/Erisa/discord-oidc-worker) with improvements for role-based admin detection, richer user profile claims, and environment-based configuration.

Allows you to authenticate with Cloudflare Access using your Discord account via a Cloudflare Worker. Wraps OIDC around the Discord OAuth2 API.

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/meduseld-io/herugrim)

## What Changed from the Original

### `worker.js`

- **Environment-based configuration** — all config reads from Wrangler environment variables (`env.CLIENT_ID`, `env.CLIENT_SECRET`, etc.) instead of hardcoded constants. Secrets stay out of source code.
- **Removed KV dependency** — signing keys are generated in-memory via `crypto.subtle.generateKey()` instead of stored in Cloudflare KV.
- **Migrated to Hono** — replaced the raw `addEventListener("fetch")` handler with [Hono](https://honojs.dev/) for cleaner routing.
- **Added `discord_user` claim to ID token** — the JWT includes a `discord_user` object with: `id`, `username`, `global_name`, `avatar`, `discriminator`, and `is_admin`.
- **Added optional admin role detection** — when `ADMIN_ROLE_ID` is set, the worker checks guild membership for that role and sets `is_admin` accordingly. `ADMIN_GUILD_ID` defaults to `ALLOWED_GUILDS[0]` if not set separately.
- **Dynamic OAuth scopes** — only requests `guilds.members.read` when admin detection is enabled, reducing permissions for simpler setups.
- **Added error handling** — Discord API responses are validated with descriptive error messages on failure.
- **Added `/health` endpoint** — returns `{ "status": "ok" }` for uptime monitoring.
- **Added guild restriction** — users must be a member of an allowed guild to authenticate (optional).

### `wrangler.toml`

- **Removed KV namespace binding** — only `name`, `main`, `compatibility_date`, and `[vars]` template remain.

### `package.json`

- **Simplified** — only `hono`, `jose`, and `wrangler` as dependencies. Two scripts: `dev` and `deploy`.

### Removed from Original

- `config.json` / `config.sample.json` — configuration is via environment variables
- KV namespace requirement

## Setup

Requirements:

- A Cloudflare account with Workers enabled
- A Cloudflare Access account with a `<name>.cloudflareaccess.com` subdomain
- A [Discord developer application](https://discord.com/developers/applications) with OAuth2 configured
  - Redirect URI: `https://<name>.cloudflareaccess.com/cdn-cgi/access/callback`
- Node.js installed

### Quick Deploy

Click the deploy button above, or manually:

1. Clone the repo and install dependencies:
   ```bash
   git clone https://github.com/meduseld-io/herugrim.git
   cd herugrim
   npm install
   ```

2. Set your environment variables in `wrangler.toml`:
   ```toml
   [vars]
   CLIENT_ID = "your-discord-app-id"
   REDIRECT_URI = "https://yourname.cloudflareaccess.com/cdn-cgi/access/callback"

   # Optional — restrict to specific Discord servers (comma-separated)
   ALLOWED_GUILDS = "guild-id-1,guild-id-2"

   # Optional — detect admin role
   ADMIN_GUILD_ID = ""
   ADMIN_ROLE_ID = ""
   ```

3. Set your client secret as a Wrangler secret (keeps it out of source):
   ```bash
   npx wrangler secret put CLIENT_SECRET
   ```

4. Test locally:
   ```bash
   npm run dev
   ```

5. Deploy:
   ```bash
   npm run deploy
   ```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `CLIENT_ID` | Yes | Discord application OAuth2 client ID |
| `CLIENT_SECRET` | Yes | Discord application OAuth2 client secret (use `wrangler secret put`) |
| `REDIRECT_URI` | Yes | `https://<name>.cloudflareaccess.com/cdn-cgi/access/callback` |
| `ALLOWED_GUILDS` | No | Comma-separated guild IDs to restrict access. Empty = allow any Discord user |
| `ADMIN_GUILD_ID` | No | Guild to check for admin role. Defaults to first `ALLOWED_GUILDS` entry |
| `ADMIN_ROLE_ID` | No | Discord role ID that grants admin. Empty = skip admin detection |

## Endpoints

| Path | Description |
|---|---|
| `GET /health` | Health check — returns `{ "status": "ok" }` |
| `GET /.well-known/openid-configuration` | OIDC discovery document |
| `GET /authorize` | Redirects to Discord OAuth2 consent screen |
| `POST /token` | Exchanges authorization code for tokens |
| `GET /jwks.json` | JSON Web Key Set for token verification |

## Cloudflare Access Configuration

1. Go to [Cloudflare Zero Trust](https://one.dash.cloudflare.com) → Settings → Authentication
2. Add a new OpenID Connect login method:
   - **App ID**: Your Discord application ID
   - **Client secret**: Your Discord OAuth2 secret
   - **Auth URL**: `https://discord-oidc.<your-workers-subdomain>.workers.dev/authorize`
   - **Token URL**: `https://discord-oidc.<your-workers-subdomain>.workers.dev/token`
   - **Certificate URL**: `https://discord-oidc.<your-workers-subdomain>.workers.dev/jwks.json`
   - **PKCE**: Enabled
   - **OIDC Claims**: `id`, `preferred_username`, `name`, `discord_user`

The `discord_user` claim appears under the `custom` key in the Cloudflare Access identity response and contains `id`, `username`, `global_name`, `avatar`, `discriminator`, and `is_admin`.

## Credits

- Original project: [Erisa/discord-oidc-worker](https://github.com/Erisa/discord-oidc-worker) by [Erisa](https://github.com/Erisa)
- Process flow inspired by [kimcore/discord-oidc](https://github.com/kimcore/discord-oidc)
- Ideas from [eidam/cf-access-workers-oidc](https://github.com/eidam/cf-access-workers-oidc)

## License

MIT — see [LICENSE](LICENSE).
