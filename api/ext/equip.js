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
  const [userDoc, invDoc, itemsSnap] = await Promise.all([
    db.collection('users').doc(twitchId).get(),
    db.collection('inventories').doc(twitchId).get(),
    db.collection('items').get(),
  ]);

  const user = userDoc.data();
  const inv = invDoc.exists ? invDoc.data() : {};
  const item = itemsSnap.docs.map(d => d.data()).find(i => i.id === itemId);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  const slotMap = { rod: 'equippedRod', boat: 'equippedBoat', bait: 'equippedBait', lure: 'equippedLure' };
  const field = slotMap[item.type];
  if (!field) return res.status(400).json({ error: 'Unknown item type' });

  // Ownership check
  if (item.type === 'rod' && !(inv.rods || []).includes(itemId)) return res.json({ error: "You don't own that rod." });
  if (item.type === 'boat' && !(inv.boats || []).includes(itemId)) return res.json({ error: "You don't own that boat." });
  if (item.type === 'bait') { const b = (inv.baits || []).find(e => e.itemId === itemId); if (!b || b.quantity <= 0) return res.json({ error: "You don't have that bait." }); }
  if (item.type === 'lure') { const l = (inv.lures || []).find(e => e.itemId === itemId); if (!l || l.quantity <= 0) return res.json({ error: "You don't have that lure." }); }

  await db.collection('users').doc(twitchId).update({ [field]: itemId });
  res.json({ success: true, message: `Equipped ${item.name}!` });
};
