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
  const invRef = db.collection('inventories').doc(twitchId);

  let earlyError = null;
  let result = null;

  try {
    await db.runTransaction(async (t) => {
      const invDoc = await t.get(invRef);
      const inv = invDoc.exists ? invDoc.data() : { fish: [] };
      const fish = [...(inv.fish || [])];

      let foundIdx = -1;
      if (typeof caughtAt === 'number') {
        foundIdx = fish.findIndex(f => f.caughtAt === caughtAt);
      }
      if (foundIdx === -1 && typeof index === 'number' && index >= 0 && index < fish.length) {
        foundIdx = index;
      }
      if (foundIdx === -1) { earlyError = { error: 'Fish not found' }; return; }

      fish[foundIdx] = { ...fish[foundIdx], locked: !fish[foundIdx].locked };
      t.set(invRef, { fish }, { merge: true });

      result = { success: true, locked: fish[foundIdx].locked };
    });
  } catch (e) {
    console.error('toggle-fish-lock tx failed', e);
    return res.status(500).json({ error: 'Failed to toggle lock — please try again' });
  }

  if (earlyError) return res.json(earlyError);
  res.json(result);
};
