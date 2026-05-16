const { getDb } = require('../../lib/firebase');
const { resolveUser, cors } = require('../../lib/auth');
const config = require('../../lib/config');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { twitchId, error } = await resolveUser(req);
  if (error) return res.status(401).json({ error });
  if (!twitchId) return res.status(400).json({ error: 'User not found' });

  // Optional: transfer a single AFK fish by its index in the afkFish array.
  // Omit to transfer all (original bulk behaviour).
  const rawIndex = req.body && req.body.index;
  const singleIndex = (rawIndex === 0 || rawIndex) ? Number(rawIndex) : null;

  const db = getDb();
  const invRef = db.collection('inventories').doc(twitchId);

  let earlyError = null;
  let result = null;

  try {
    await db.runTransaction(async (t) => {
      const invDoc = await t.get(invRef);
      const inv = invDoc.exists ? invDoc.data() : { fish: [], afkFish: [] };
      const fish = inv.fish || [];
      const afkFish = inv.afkFish || [];

      if (afkFish.length === 0) { earlyError = { error: 'No AFK fish to transfer.' }; return; }

      const room = Math.max(0, config.MAX_INVENTORY - fish.length);
      if (room === 0) {
        earlyError = { error: `Inventory full (${config.MAX_INVENTORY}/${config.MAX_INVENTORY}). Sell some fish first.` };
        return;
      }

      let moved, left;
      if (singleIndex !== null) {
        if (!Number.isInteger(singleIndex) || singleIndex < 0 || singleIndex >= afkFish.length) {
          earlyError = { error: 'That fish is no longer in the AFK pile.' };
          return;
        }
        moved = [afkFish[singleIndex]];
        left = afkFish.filter((_, i) => i !== singleIndex);
      } else {
        moved = afkFish.slice(0, room);
        left = afkFish.slice(room);
      }

      t.set(invRef, { fish: [...fish, ...moved], afkFish: left }, { merge: true });

      result = {
        success: true,
        movedCount: moved.length,
        leftCount: left.length,
        movedValue: moved.reduce((s, f) => s + (f.value || 0), 0),
        newFishCount: fish.length + moved.length,
      };
    });
  } catch (e) {
    console.error('afk-transfer tx failed', e);
    return res.status(500).json({ error: 'Transfer failed — please try again' });
  }

  if (earlyError) return res.json(earlyError);
  res.json(result);
};
