const { getDb } = require('../../lib/firebase');
const { verifyJwt, cors } = require('../../lib/auth');
const { resolveTwitchUser } = require('../../lib/twitch');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const payload = verifyJwt(req);
  if (!payload || !payload.user_id) return res.status(401).json({ error: 'Unauthorized' });

  const db = getDb();
  const twitchId = payload.user_id;
  const loginHint = (req.query.login || '').toLowerCase();

  const userRef = db.collection('users').doc(twitchId);
  let userDoc = await userRef.get();
  let user;

  const fallbackName = `angler_${twitchId}`;

  if (!userDoc.exists) {
    // The Twitch extension frontend has no access to the viewer's login name,
    // so loginHint is usually empty. Resolve the real name from Helix; fall
    // back to angler_<id> if the lookup fails (creation must not be blocked).
    let username = loginHint;
    if (!username) {
      const resolved = await resolveTwitchUser(twitchId);
      username = resolved?.displayName || fallbackName;
    }
    user = {
      username, twitchId, coins: 0, lastFished: 0, lastAutoFished: 0,
      totalCaught: 0, totalValue: 0,
      equippedRod: 'basic_rod', equippedBoat: 'wooden_raft',
      equippedBait: null, equippedLure: null, banned: false, createdAt: Date.now(),
    };
    await userRef.set(user);
    await db.collection('inventories').doc(twitchId).set({
      fish: [], afkFish: [], rods: ['basic_rod'], boats: ['wooden_raft'], baits: [], lures: [],
    });
  } else {
    user = userDoc.data();
    // Refresh username from JWT login on every call so display name stays current.
    if (loginHint && user.username !== loginHint) {
      await userRef.update({ username: loginHint });
      user.username = loginHint;
    } else if (!loginHint && user.username === fallbackName) {
      // Self-heal accounts created before Helix was wired up (or when an
      // earlier lookup failed). Only runs while the name is still the
      // fallback, so it stops once resolved — no per-request Helix calls.
      const resolved = await resolveTwitchUser(twitchId);
      if (resolved?.displayName) {
        await userRef.update({ username: resolved.displayName });
        user.username = resolved.displayName;
      }
    }
  }

  const username = user.username || loginHint || twitchId;

  const [invSnap, fishSnap, itemsSnap] = await Promise.all([
    db.collection('inventories').doc(twitchId).get(),
    db.collection('fish').get(),
    db.collection('items').get(),
  ]);

  const inv = invSnap.exists ? invSnap.data() : { fish: [], afkFish: [], rods: ['basic_rod'], boats: ['wooden_raft'], baits: [], lures: [] };
  const allFish = fishSnap.docs.map(d => d.data());
  const allItems = itemsSnap.docs.map(d => d.data());

  const getFish = id => allFish.find(f => f.id === id) || null;
  const getItem = id => allItems.find(i => i.id === id) || null;

  const mapFish = (f, idx) => {
    const def = getFish(f.fishId);
    const weight = f.weight ?? +(((def?.minWeight || 0) + (def?.maxWeight || 1)) / 2).toFixed(2);
    return {
      index: idx, id: f.fishId,
      caughtAt: f.caughtAt || null,
      name: f.fishName || def?.name || f.fishId,
      emoji: def?.emoji || '🐟',
      rarity: f.rarity || def?.rarity || 'common',
      value: f.value || 0, weight,
      mutation: f.mutation || null, locked: f.locked || false,
      imageUrl: f.imageUrl || def?.imageUrl,
    };
  };
  const fishList = (inv.fish || []).map(mapFish);
  const afkFishList = (inv.afkFish || []).map(mapFish);

  const equippedRod  = getItem(user.equippedRod);
  const equippedBait = getItem(user.equippedBait);
  const equippedLure = getItem(user.equippedLure);
  const equippedBoat = getItem(user.equippedBoat || 'wooden_raft');
  const ownedRods  = (inv.rods  || []).map(id => getItem(id)).filter(Boolean);
  const ownedBoats = (inv.boats || ['wooden_raft']).map(id => getItem(id)).filter(Boolean);
  const baits = (inv.baits || []).map(b => { const i = getItem(b.itemId); return i ? { ...i, quantity: b.quantity } : null; }).filter(Boolean);
  const lures = (inv.lures || []).map(b => { const i = getItem(b.itemId); return i ? { ...i, quantity: b.quantity } : null; }).filter(Boolean);

  res.json({
    exists: true, username, displayName: username,
    lastFished: user.lastFished || 0, coins: user.coins || 0,
    lastAutoFished: user.lastAutoFished || 0,
    fishCount: fishList.length,
    fishValue: fishList.reduce((s, f) => s + f.value, 0),
    fishList,
    afkFishCount: afkFishList.length,
    afkFishValue: afkFishList.reduce((s, f) => s + f.value, 0),
    afkFishList,
    equipped: {
      rod:  equippedRod  ? { id: equippedRod.id,  name: equippedRod.name,  emoji: equippedRod.emoji,  modifiers: equippedRod.modifiers  } : null,
      bait: equippedBait ? { id: equippedBait.id, name: equippedBait.name, emoji: equippedBait.emoji,
              quantity: (inv.baits || []).find(b => b.itemId === user.equippedBait)?.quantity || 0, modifiers: equippedBait.modifiers } : null,
      lure: equippedLure ? { id: equippedLure.id, name: equippedLure.name, emoji: equippedLure.emoji, modifiers: equippedLure.modifiers } : null,
      boat: equippedBoat ? { id: equippedBoat.id, name: equippedBoat.name, emoji: equippedBoat.emoji, modifiers: equippedBoat.modifiers, imageUrl: equippedBoat.imageUrl } : null,
    },
    inventory: { rods: ownedRods, boats: ownedBoats, baits, lures },
  });
};
