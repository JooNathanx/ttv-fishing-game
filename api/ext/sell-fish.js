const { getDb } = require('../../lib/firebase');
const { resolveUser, cors } = require('../../lib/auth');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { twitchId, error } = await resolveUser(req);
  if (error) return res.status(401).json({ error });
  if (!twitchId) return res.status(400).json({ error: 'User not found' });

  const { index, caughtAt } = req.body || {};
  if (typeof index !== 'number' && typeof caughtAt !== 'number') {
    return res.status(400).json({ error: 'caughtAt or index required' });
  }

  const db = getDb();
  const userRef = db.collection('users').doc(twitchId);
  const invRef = db.collection('inventories').doc(twitchId);

  let earlyError = null;
  let result = null;

  try {
    await db.runTransaction(async (t) => {
      const [userDoc, invDoc] = await Promise.all([t.get(userRef), t.get(invRef)]);
      if (!userDoc.exists) { earlyError = { error: 'User not found' }; return; }

      const user = userDoc.data();
      const inv = invDoc.exists ? invDoc.data() : { fish: [] };
      const fish = inv.fish || [];

      // Prefer stable caughtAt lookup; fall back to index for legacy fish
      let foundIdx = -1;
      if (typeof caughtAt === 'number') {
        foundIdx = fish.findIndex(f => f.caughtAt === caughtAt);
      }
      if (foundIdx === -1 && typeof index === 'number' && index >= 0 && index < fish.length) {
        foundIdx = index;
      }
      if (foundIdx === -1) { earlyError = { error: 'Fish not found (it may have already been sold)' }; return; }

      const f = fish[foundIdx];
      if (f.locked) { earlyError = { error: 'That fish is locked!' }; return; }

      const value = f.value || 0;
      const newFish = fish.filter((_, i) => i !== foundIdx);
      const newCoins = (user.coins || 0) + value;

      t.update(userRef, { coins: newCoins });
      t.set(invRef, { fish: newFish }, { merge: true });

      result = { success: true, fishName: f.fishName || f.fishId, value, newBalance: newCoins };
    });
  } catch (e) {
    console.error('sell-fish tx failed', e);
    return res.status(500).json({ error: 'Sell failed — please try again' });
  }

  if (earlyError) return res.json(earlyError);
  res.json(result);
};
