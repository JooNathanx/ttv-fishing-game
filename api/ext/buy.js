const { getDb } = require('../../lib/firebase');
const { resolveUser, cors } = require('../../lib/auth');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { twitchId, error } = await resolveUser(req);
  if (error) return res.status(401).json({ error });
  if (!twitchId) return res.status(400).json({ error: 'User not found' });

  const { itemId } = req.body || {};
  if (!itemId) return res.status(400).json({ error: 'itemId required' });

  const db = getDb();

  // Items collection is static — read outside the transaction
  const itemsSnap = await db.collection('items').get();
  const item = itemsSnap.docs.map(d => d.data()).find(i => i.id === itemId);
  if (!item) return res.json({ error: 'Item not found' });
  if (!item.enabled || item.buyable === false) return res.json({ error: 'Item not available' });

  const userRef = db.collection('users').doc(twitchId);
  const invRef = db.collection('inventories').doc(twitchId);

  let earlyError = null;
  let result = null;

  try {
    await db.runTransaction(async (t) => {
      const [userDoc, invDoc] = await Promise.all([t.get(userRef), t.get(invRef)]);
      if (!userDoc.exists) { earlyError = { error: 'User not found' }; return; }

      const user = userDoc.data();
      const inv = invDoc.exists ? invDoc.data() : {};

      if ((user.coins || 0) < item.price) { earlyError = { error: 'Not enough coins' }; return; }

      const newInv = { ...inv };
      if (item.type === 'rod') {
        if ((newInv.rods || []).includes(itemId)) { earlyError = { error: 'Already owned' }; return; }
        newInv.rods = [...(newInv.rods || []), itemId];
      } else if (item.type === 'boat') {
        if ((newInv.boats || []).includes(itemId)) { earlyError = { error: 'Already owned' }; return; }
        newInv.boats = [...(newInv.boats || ['wooden_raft']), itemId];
      } else if (item.type === 'bait') {
        newInv.baits = [...(newInv.baits || [])];
        const existing = newInv.baits.find(b => b.itemId === itemId);
        if (existing) existing.quantity = (existing.quantity || 0) + 1;
        else newInv.baits.push({ itemId, quantity: 1 });
      } else if (item.type === 'lure') {
        newInv.lures = [...(newInv.lures || [])];
        const existing = newInv.lures.find(l => l.itemId === itemId);
        if (existing) existing.quantity = (existing.quantity || 0) + 1;
        else newInv.lures.push({ itemId, quantity: 1 });
      } else {
        earlyError = { error: 'Unknown item type' };
        return;
      }

      const newCoins = (user.coins || 0) - item.price;
      t.update(userRef, { coins: newCoins });
      t.set(invRef, newInv, { merge: true });

      result = { success: true, message: `Purchased ${item.name}!`, newBalance: newCoins };
    });
  } catch (e) {
    console.error('buy tx failed', e);
    return res.status(500).json({ error: 'Purchase failed — please try again' });
  }

  if (earlyError) return res.json(earlyError);
  res.json(result);
};
