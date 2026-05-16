module.exports = {
  BASE_COOLDOWN_SECONDS: 30,
  MAX_INVENTORY: 500,

  AFK_MAX_INVENTORY: 500,
  AUTO_CAST_COOLDOWN_MS: 2 * 60 * 1000,

  BASE_RARITY_WEIGHTS: {
    common: 60, rare: 25, epic: 10, legendary: 4, mythic: 0.8, celestial: 0.2, secret: 0.01,
  },

  RARITY_ORDER: ['common', 'rare', 'epic', 'legendary', 'mythic', 'celestial', 'secret'],

  MUTATIONS: [
    { id: 'rotten',   name: 'Rotten',   emoji: '🤢', mult: 0.5,  weight: 80  },
    { id: 'frozen',   name: 'Frozen',   emoji: '🧊', mult: 1.5,  weight: 100 },
    { id: 'burn',     name: 'Burn',     emoji: '🔥', mult: 1.6,  weight: 90  },
    { id: 'electric', name: 'Electric', emoji: '⚡', mult: 1.65, weight: 80  },
    { id: 'golden',   name: 'Golden',   emoji: '✨', mult: 2.0,  weight: 50  },
    { id: 'rainbow',  name: 'Rainbow',  emoji: '🌈', mult: 3.0,  weight: 40  },
    { id: 'cupid',    name: 'Cupid',    emoji: '💘', mult: 3.1,  weight: 20  },
    { id: 'aurora',   name: 'Aurora',   emoji: '🌌', mult: 3.5,  weight: 15  },
    { id: 'shadow',   name: 'Shadow',   emoji: '🌑', mult: 3.8,  weight: 10  },
    { id: 'diamond',  name: 'Diamond',  emoji: '💎', mult: 4.0,  weight: 8   },
    { id: 'cosmic',   name: 'Cosmic',   emoji: '🌠', mult: 5.0,  weight: 5   },
    { id: 'abyssal',  name: 'Abyssal',  emoji: '🕳️', mult: 6.0,  weight: 2   },
  ],
  // Sum of MUTATIONS.weight ≈ 500. P(mutation) = 500 / (500 + MUTATION_NONE_WEIGHT)
  // 1500 → ~25% mutation rate. Raise to lower the rate; lower to raise it.
  MUTATION_NONE_WEIGHT: 1500,
};
