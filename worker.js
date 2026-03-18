import { Hono } from 'hono';
import * as jose from 'jose';

const app = new Hono();

let keypair;

async function getKeyPair() {
  if (!keypair) {
    keypair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify']
    );
  }
  return keypair;
}

/**
 * Read a required env var or throw.
 */
function requireEnv(env, key) {
  const val = env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

/**
 * Parse ALLOWED_GUILDS from a comma-separated string into an array.
 * Returns empty array if not set.
 */
function parseGuilds(env) {
  const raw = env.ALLOWED_GUILDS || '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/* ---------------- HEALTH ---------------- */

app.get('/health', (c) => {
  return c.json({ status: 'ok' });
});

/* ---------------- DISCOVERY ---------------- */

app.get('/.well-known/openid-configuration', (c) => {
  const base = new URL(c.req.url).origin;

  return c.json({
    issuer: base,
    authorization_endpoint: base + '/authorize',
    token_endpoint: base + '/token',
    jwks_uri: base + '/jwks.json',
    response_types_supported: ['code'],
    id_token_signing_alg_values_supported: ['RS256'],
    subject_types_supported: ['public'],
  });
});

/* ---------------- AUTHORIZE ---------------- */

app.get('/authorize', (c) => {
  const clientId = requireEnv(c.env, 'CLIENT_ID');
  const redirectUri = requireEnv(c.env, 'REDIRECT_URI');
  const adminRoleId = c.env.ADMIN_ROLE_ID || '';

  // Only request guilds.members.read when admin detection is enabled
  const scopes = adminRoleId
    ? 'identify email guilds guilds.members.read'
    : 'identify email guilds';

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes,
    state: c.req.query('state'),
  });

  return c.redirect('https://discord.com/oauth2/authorize?' + params);
});

/* ---------------- TOKEN ---------------- */

app.post('/token', async (c) => {
  const clientId = requireEnv(c.env, 'CLIENT_ID');
  const clientSecret = requireEnv(c.env, 'CLIENT_SECRET');
  const redirectUri = requireEnv(c.env, 'REDIRECT_URI');
  const allowedGuilds = parseGuilds(c.env);
  const adminRoleId = c.env.ADMIN_ROLE_ID || '';
  const adminGuildId = c.env.ADMIN_GUILD_ID || (allowedGuilds.length ? allowedGuilds[0] : '');

  const body = await c.req.parseBody();

  // Exchange authorization code for access token
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code: body.code,
    redirect_uri: redirectUri,
  });

  const token = await fetch('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  }).then((r) => r.json());

  if (token.error) {
    console.error('Discord token exchange failed:', token.error, token.error_description);
    return c.json({ error: 'Token exchange failed', detail: token.error_description }, 400);
  }

  // Fetch user profile
  const userRes = await fetch('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: 'Bearer ' + token.access_token },
  });

  if (!userRes.ok) {
    console.error('Discord user fetch failed:', userRes.status, await userRes.text());
    return c.text('Failed to fetch Discord user profile', 502);
  }

  const user = await userRes.json();

  if (!user.id) {
    console.error('Discord user response missing id:', user);
    return c.text('Invalid Discord user response', 502);
  }

  // Fetch guilds for restriction check
  const guildsRes = await fetch('https://discord.com/api/v10/users/@me/guilds', {
    headers: { Authorization: 'Bearer ' + token.access_token },
  });

  if (!guildsRes.ok) {
    console.error('Discord guilds fetch failed:', guildsRes.status, await guildsRes.text());
    return c.text('Failed to fetch Discord guilds', 502);
  }

  const guilds = await guildsRes.json();

  if (!Array.isArray(guilds)) {
    console.error('Discord guilds response is not an array:', guilds);
    return c.text('Invalid Discord guilds response', 502);
  }

  if (allowedGuilds.length) {
    const guildIds = guilds.map((g) => g.id);
    if (!allowedGuilds.some((id) => guildIds.includes(id))) {
      return c.text('Not in required Discord server', 403);
    }
  }

  // Check admin role (only when ADMIN_ROLE_ID is configured)
  let isAdmin = false;

  if (adminRoleId && adminGuildId) {
    try {
      const memberRes = await fetch(
        `https://discord.com/api/v10/users/@me/guilds/${adminGuildId}/member`,
        { headers: { Authorization: 'Bearer ' + token.access_token } }
      );

      if (!memberRes.ok) {
        console.error('Discord guild member fetch failed:', memberRes.status);
      } else {
        const member = await memberRes.json();
        if (member.roles && Array.isArray(member.roles)) {
          isAdmin = member.roles.includes(adminRoleId);
        }
      }
    } catch (e) {
      console.error('Failed to fetch guild member for admin check:', e);
    }
  }

  const { privateKey } = await getKeyPair();

  const idToken = await new jose.SignJWT({
    sub: user.id,
    name: user.global_name || user.username,
    preferred_username: user.username,
    email: user.email,
    discord_user: {
      id: user.id,
      username: user.username,
      global_name: user.global_name,
      avatar: user.avatar,
      discriminator: user.discriminator,
      is_admin: isAdmin,
    },
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setExpirationTime('1h')
    .setAudience(clientId)
    .setIssuer(new URL(c.req.url).origin)
    .sign(privateKey);

  return c.json({
    access_token: token.access_token,
    token_type: 'Bearer',
    id_token: idToken,
  });
});

/* ---------------- JWKS ---------------- */

app.get('/jwks.json', async (c) => {
  const { publicKey } = await getKeyPair();

  return c.json({
    keys: [
      {
        alg: 'RS256',
        ...(await crypto.subtle.exportKey('jwk', publicKey)),
      },
    ],
  });
});

export default app;
