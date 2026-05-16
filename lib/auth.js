const jwt = require('jsonwebtoken');

function verifyJwt(req) {
  const secret = process.env.TWITCH_EXT_SECRET;
  if (!secret) return null;
  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  try {
    return jwt.verify(token, Buffer.from(secret, 'base64'));
  } catch { return null; }
}

// Returns the Twitch numeric ID — used as the Firestore doc key for users + inventories.
async function resolveUser(req) {
  const payload = verifyJwt(req);
  if (!payload || !payload.user_id) return { error: 'Unauthorized', twitchId: null };
  return { twitchId: payload.user_id };
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = { verifyJwt, resolveUser, cors };
