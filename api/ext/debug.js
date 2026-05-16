// TEMPORARY diagnostic endpoint — delete after confirming Helix works.
// Usage:
//   GET /api/ext/debug                       -> env-var presence (booleans only)
//   GET /api/ext/debug?twitchId=486705408    -> live Helix lookup with step trace
// Never returns secret values, only whether they are present.
const { cors } = require('../../lib/auth');
const { resolveTwitchUserDebug } = require('../../lib/twitch');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const env = {
    TWITCH_CLIENT_ID: !!process.env.TWITCH_CLIENT_ID,
    TWITCH_CLIENT_SECRET: !!process.env.TWITCH_CLIENT_SECRET,
    TWITCH_EXT_SECRET: !!process.env.TWITCH_EXT_SECRET,
    FIREBASE_SERVICE_ACCOUNT: !!process.env.FIREBASE_SERVICE_ACCOUNT,
  };

  const twitchId = req.query.twitchId;
  let helix = null;
  if (twitchId) helix = await resolveTwitchUserDebug(String(twitchId));

  res.json({ ok: true, env, helix });
};
