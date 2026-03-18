# Changelog

## [0.1.0-alpha](https://github.com/meduseld-io/herugrim/releases/tag/v0.1.0-alpha)

### New Features

- Discord role-based admin detection via `ADMIN_ROLE_ID` environment variable
- `discord_user` claims in OIDC id_token with full user profile data
- Guild restriction via `ALLOWED_GUILDS` environment variable
- `/health` endpoint for uptime monitoring
- Environment-based configuration — all config via Wrangler env vars and secrets
- Dynamic OAuth scopes — `guilds.members.read` only requested when admin detection is enabled
- Error handling on all Discord API calls with descriptive error messages
- Deploy to Cloudflare Workers button in README

### Refactoring

- Remove KV dependency — signing keys generated in-memory
- Remove `config.json` — all config via environment variables
- Migrate to Hono for routing
- Set JWT issuer dynamically from request origin
