const { getDb } = require('../../lib/firebase');
const { resolveUser, cors } = require('../../lib/auth');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { twitchId, error } = await resolveUser(req);
  if (error) return res.status(401).json({ error });
  if (!twitchId) return res.status(400).json({ error: 'User not found' });

  const { slot } = req.body || {};
  const slotMap = { rod: 'equippedRod', boat: 'equippedBoat', bait: 'equippedBait', lure: 'equippedLure' };
  const field = slotMap[slot];
  if (!field) return res.status(400).json({ error: 'Invalid slot' });

  // Slots that always have a default fall back to it; consumables go to null.
  const defaults = { rod: 'basic_rod', boat: 'wooden_raft', bait: null, lure: null };
  const value = defaults[slot];
  await getDb().collection('users').doc(twitchId).update({ [field]: value });
  res.json({ success: true, message: 'Unequipped!' });
};
