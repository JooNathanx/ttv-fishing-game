const { getDb } = require('../../lib/firebase');
const { resolveUser, cors } = require('../../lib/auth');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { twitchId, error } = await resolveUser(req);
  if (error) return res.status(401).json({ error });
  if (!twitchId) return res.status(400).json({ error: 'User not found' });

  const { filter } = req.body || {};
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

      let soldFish, remaining;
      if (!filter || filter === 'all') {
        soldFish = fish.filter(f => !f.locked);
        remaining = fish.filter(f => f.locked);
      } else {
        soldFish = fish.filter(f => f.rarity === filter && !f.locked);
        remaining = fish.filter(f => f.rarity !== filter || f.locked);
      }

      if (soldFish.length === 0) { earlyError = { error: 'No fish to sell (might be locked).' }; return; }

      const earned = soldFish.reduce((s, f) => s + (f.value || 0), 0);
      const newCoins = (user.coins || 0) + earned;

      t.update(userRef, { coins: newCoins });
      t.set(invRef, { fish: remaining }, { merge: true });

      result = { success: true, count: soldFish.length, totalValue: earned, newBalance: newCoins };
    });
  } catch (e) {
    console.error('sell tx failed', e);
    return res.status(500).json({ error: 'Sell failed — please try again' });
  }

  if (earlyError) return res.json(earlyError);
  res.json(result);
};
