const { getDb } = require('../../lib/firebase');
const { resolveUser, cors } = require('../../lib/auth');
const config = require('../../lib/config');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { twitchId, error } = await resolveUser(req);
  if (error) return res.status(401).json({ error });
  if (!twitchId) return res.status(400).json({ error: 'User not found. Open the extension panel first.' });

  const auto = !!(req.body && req.body.auto);

  const db = getDb();

  // Static reference data — safe to read outside the transaction
  const [fishSnap, itemsSnap] = await Promise.all([
    db.collection('fish').get(),
    db.collection('items').get(),
  ]);
  const allFish = fishSnap.docs.map(d => d.data());
  const allItems = itemsSnap.docs.map(d => d.data());
  const getItem = id => allItems.find(i => i.id === id) || null;

  const userRef = db.collection('users').doc(twitchId);
  const invRef = db.collection('inventories').doc(twitchId);

  let earlyError = null;
  let result = null;

  try {
    await db.runTransaction(async (t) => {
      const [userDoc, invDoc] = await Promise.all([t.get(userRef), t.get(invRef)]);
      if (!userDoc.exists) { earlyError = { status: 404, body: { error: 'User not found' } }; return; }

      const user = userDoc.data();
      if (user.banned) { earlyError = { status: 200, body: { error: 'You are banned from fishing.' } }; return; }

      const inv = invDoc.exists ? invDoc.data() : { fish: [], afkFish: [], rods: ['basic_rod'], boats: ['wooden_raft'], baits: [], lures: [] };

      const rod  = getItem(user.equippedRod);
      const boat = getItem(user.equippedBoat);
      const bait = getItem(user.equippedBait);
      const lure = getItem(user.equippedLure);

      // Inventory cap (separate caps for manual vs AFK)
      if (auto) {
        if ((inv.afkFish || []).length >= config.AFK_MAX_INVENTORY) {
          earlyError = { status: 200, body: { error: `AFK inventory full (${config.AFK_MAX_INVENTORY}/${config.AFK_MAX_INVENTORY}).`, afkFull: true } };
          return;
        }
      } else {
        if ((inv.fish || []).length >= config.MAX_INVENTORY) {
          earlyError = { status: 200, body: { error: `Inventory full (${config.MAX_INVENTORY}/${config.MAX_INVENTORY}). Sell some fish first!` } };
          return;
        }
      }

      // Cooldown — fixed 2-min for auto, gear-based for manual (separate trackers)
      let cooldownMs, lastField, elapsed;
      const now = Date.now();
      if (auto) {
        cooldownMs = config.AUTO_CAST_COOLDOWN_MS;
        lastField = 'lastAutoFished';
        elapsed = now - (user.lastAutoFished || 0);
      } else {
        const cooldownReduction = (rod?.modifiers?.cooldownReduction || 0)
          + (bait?.modifiers?.cooldownReduction || 0)
          + (lure?.modifiers?.cooldownReduction || 0);
        cooldownMs = Math.max(5, config.BASE_COOLDOWN_SECONDS - cooldownReduction) * 1000;
        lastField = 'lastFished';
        elapsed = now - (user.lastFished || 0);
      }
      if (elapsed < cooldownMs) {
        earlyError = { status: 200, body: { error: `Wait ${Math.ceil((cooldownMs - elapsed) / 1000)}s to fish again`, cooldownMs: cooldownMs - elapsed } };
        return;
      }

      // Rarity weights — combine rarityBonus across all 4 gear slots
      const weights = { ...config.BASE_RARITY_WEIGHTS };
      for (const gear of [rod, boat, bait, lure]) {
        if (gear?.modifiers?.rarityBonus) {
          for (const [r, bonus] of Object.entries(gear.modifiers.rarityBonus)) {
            if (weights[r] !== undefined) weights[r] += bonus;
          }
        }
      }
      for (const r of config.RARITY_ORDER) weights[r] = Math.max(0, weights[r]);

      // Roll rarity
      const total = Object.values(weights).reduce((s, w) => s + w, 0);
      let roll = Math.random() * total;
      let rarity = 'common';
      for (const [r, w] of Object.entries(weights)) { roll -= w; if (roll <= 0) { rarity = r; break; } }

      // Guaranteed min rarity (lure)
      if (lure?.modifiers?.guaranteedMinRarity) {
        const order = config.RARITY_ORDER;
        const curIdx = order.indexOf(rarity), minIdx = order.indexOf(lure.modifiers.guaranteedMinRarity);
        if (curIdx < minIdx) rarity = lure.modifiers.guaranteedMinRarity;
      }

      // Pick fish from rarity pool
      const pool = allFish.filter(f => f.enabled && f.rarity === rarity);
      if (!pool.length) { earlyError = { status: 200, body: { error: 'No fish available. Try again later.' } }; return; }
      const fishTotal = pool.reduce((s, f) => s + (f.rarityWeight || 10), 0);
      let fishRoll = Math.random() * fishTotal;
      let caught = pool[0];
      for (const f of pool) { fishRoll -= (f.rarityWeight || 10); if (fishRoll <= 0) { caught = f; break; } }

      // Weight + coin multipliers
      const weight = +(caught.minWeight + Math.random() * Math.max(0, caught.maxWeight - caught.minWeight)).toFixed(2);
      let coinMult = 1.0;
      if (lure?.modifiers?.coinBonus) coinMult *= lure.modifiers.coinBonus;
      if (rod?.modifiers?.coinBonus && rod.modifiers.coinBonus !== 1.0) coinMult *= rod.modifiers.coinBonus;

      // Mutation — combine modifiers from all equipped gear
      let mutation = null;
      let mutPool = config.MUTATIONS;
      const gearMods = [rod, boat, bait, lure].filter(Boolean).map(g => g.modifiers || {});
      const onlyPositive = gearMods.some(m => m.onlyPositiveMutations);
      const blockNeg     = gearMods.some(m => m.blockNegativeMutations);
      const chanceBonus  = gearMods.reduce((s, m) => s + (m.mutationChanceBonus || 0), 0);

      if (onlyPositive) mutPool = mutPool.filter(m => m.mult > 1.0);
      else if (blockNeg) mutPool = mutPool.filter(m => m.mult >= 1.0);
      const noneW = Math.max(0, config.MUTATION_NONE_WEIGHT * (1 - (Math.min(chanceBonus, 99) / 100)));
      const mutTotal = mutPool.reduce((s, m) => s + m.weight, 0) + noneW;
      let mutRoll = Math.random() * mutTotal;
      if (mutRoll >= noneW) {
        mutRoll -= noneW;
        for (const m of mutPool) { mutRoll -= m.weight; if (mutRoll <= 0) { mutation = m; break; } }
      }
      const mutMult = mutation ? mutation.mult : 1.0;

      // Weight-based value multiplier (0.1× at min weight → 2.0× at max weight)
      const range = caught.maxWeight - caught.minWeight;
      const weightMult = range > 0 ? +(0.1 + Math.max(0, Math.min(1, (weight - caught.minWeight) / range)) * 1.9).toFixed(3) : 1.0;
      const value = Math.round(caught.baseValue * coinMult * mutMult * weightMult);

      const fishEntry = {
        fishId: caught.id, fishName: caught.name, rarity: caught.rarity,
        value, weight, locked: false, imageUrl: caught.imageUrl || null,
        mutation: mutation ? { id: mutation.id, name: mutation.name, emoji: mutation.emoji, mult: mutation.mult } : null,
        caughtAt: now,
      };

      const targetList = auto ? (inv.afkFish || []) : (inv.fish || []);
      const newTargetList = [...targetList, fishEntry];

      // Consume one bait if equipped
      let newBaits = inv.baits || [];
      let newEquippedBait = user.equippedBait;
      if (user.equippedBait) {
        const baitEntry = newBaits.find(b => b.itemId === user.equippedBait);
        if (baitEntry) {
          baitEntry.quantity--;
          if (baitEntry.quantity <= 0) {
            newBaits = newBaits.filter(b => b.itemId !== user.equippedBait);
            newEquippedBait = null;
          }
        }
      }

      // Consume one lure if equipped
      let newLures = inv.lures || [];
      let newEquippedLure = user.equippedLure;
      if (user.equippedLure) {
        const lureEntry = newLures.find(l => l.itemId === user.equippedLure);
        if (lureEntry) {
          lureEntry.quantity--;
          if (lureEntry.quantity <= 0) {
            newLures = newLures.filter(l => l.itemId !== user.equippedLure);
            newEquippedLure = null;
          }
        }
      }

      // Writes (atomic within the transaction)
      const userUpdate = {
        [lastField]: now,
        totalCaught: (user.totalCaught || 0) + 1,
        totalValue: (user.totalValue || 0) + value,
        equippedBait: newEquippedBait,
        equippedLure: newEquippedLure,
      };
      t.update(userRef, userUpdate);

      const invUpdate = { baits: newBaits, lures: newLures };
      if (auto) invUpdate.afkFish = newTargetList;
      else invUpdate.fish = newTargetList;
      t.set(invRef, invUpdate, { merge: true });

      result = {
        success: true,
        auto,
        fish: { id: caught.id, name: caught.name, emoji: caught.emoji || '🐟', rarity: caught.rarity, imageUrl: caught.imageUrl },
        value, weight, rarity: caught.rarity,
        mutation: mutation ? { id: mutation.id, name: mutation.name, emoji: mutation.emoji, mult: mutation.mult } : null,
        cooldownMs, newCoins: user.coins || 0,
        caughtAt: now,
        newFishCount: auto ? (inv.fish || []).length : newTargetList.length,
        newFishValue: (auto ? (inv.fish || []) : newTargetList).reduce((s, f) => s + (f.value || 0), 0),
        newAfkFishCount: auto ? newTargetList.length : (inv.afkFish || []).length,
        newAfkFishValue: (auto ? newTargetList : (inv.afkFish || [])).reduce((s, f) => s + (f.value || 0), 0),
      };
    });
  } catch (e) {
    console.error('cast tx failed', e);
    return res.status(500).json({ error: 'Cast failed — please try again' });
  }

  if (earlyError) return res.status(earlyError.status).json(earlyError.body);
  res.json(result);
};
