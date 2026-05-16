// Resolves a Twitch numeric user_id to a real username/display name via the
// Helix API. Twitch never exposes the viewer's login to an extension frontend,
// so this is the only way to show real names instead of angler_<id> fallbacks.
//
// Requires env vars:
//   TWITCH_CLIENT_ID     — your extension/app Client ID
//   TWITCH_CLIENT_SECRET — the App Client Secret (Applications → Manage,
//                          NOT the Extension Secret)

let _appToken = null;       // { token, expiresAt }  cached per warm lambda

async function getAppAccessToken() {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  // Reuse cached token until ~60s before expiry.
  if (_appToken && Date.now() < _appToken.expiresAt - 60000) {
    return _appToken.token;
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
  });

  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) {
    console.error('[twitch] token fetch failed:', res.status, await res.text().catch(() => ''));
    return null;
  }
  const data = await res.json();
  _appToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
  return _appToken.token;
}

// Verbose resolver — returns a diagnostic object describing each step.
// Used by both resolveTwitchUser (thin wrapper) and the /api/ext/debug endpoint.
async function resolveTwitchUserDebug(twitchId) {
  const hasId = !!process.env.TWITCH_CLIENT_ID;
  const hasSecret = !!process.env.TWITCH_CLIENT_SECRET;
  const diag = { hasClientId: hasId, hasClientSecret: hasSecret, step: 'start' };

  if (!hasId || !hasSecret) {
    diag.step = 'missing-env';
    diag.error = 'TWITCH_CLIENT_ID and/or TWITCH_CLIENT_SECRET not set in this deployment';
    return diag;
  }

  try {
    diag.step = 'token';
    const token = await getAppAccessToken();
    if (!token) {
      diag.error = 'App access token request failed (check Client ID/Secret values and that the deployment was rebuilt after setting them)';
      return diag;
    }
    diag.tokenObtained = true;

    diag.step = 'helix-users';
    const res = await fetch(
      `https://api.twitch.tv/helix/users?id=${encodeURIComponent(twitchId)}`,
      {
        headers: {
          'Client-Id': process.env.TWITCH_CLIENT_ID,
          Authorization: `Bearer ${token}`,
        },
      }
    );
    diag.helixStatus = res.status;
    if (!res.ok) {
      diag.error = `Helix /users returned ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`;
      return diag;
    }
    const data = await res.json();
    const u = data?.data?.[0];
    if (!u) {
      diag.step = 'no-user';
      diag.error = `Helix returned no user for id ${twitchId}`;
      return diag;
    }
    diag.step = 'ok';
    diag.login = u.login;
    diag.displayName = u.display_name || u.login;
    return diag;
  } catch (err) {
    diag.step = 'exception';
    diag.error = err.message;
    return diag;
  }
}

// Returns { login, displayName } or null on any failure (caller falls back).
async function resolveTwitchUser(twitchId) {
  const d = await resolveTwitchUserDebug(twitchId);
  if (d.step === 'ok') return { login: d.login, displayName: d.displayName };
  console.error('[twitch] resolve failed:', d.step, d.error || '');
  return null;
}

module.exports = { resolveTwitchUser, resolveTwitchUserDebug };
