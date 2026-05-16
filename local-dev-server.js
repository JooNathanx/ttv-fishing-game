// ────────────────────────────────────────────────────────────────────────
// LOCAL DEVELOPMENT SERVER
// Run this to test the Vercel API locally before deploying
// 
// Usage:
//   npm run dev
//   or
//   node vercel-api/local-dev-server.js
// ────────────────────────────────────────────────────────────────────────

const http = require('http');
const url = require('url');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

// ── Configuration ──────────────────────────────────────────────────────
const PORT = 3000;
const API_VERSION = 'v1.0';

// For local testing, use this secret (same structure as Twitch secret)
// In production, use environment variables!
const LOCAL_DEV_SECRET = Buffer.from('dev_secret_12345').toString('base64');

console.log(`
╔════════════════════════════════════════════════════════════╗
║         LOCAL DEVELOPMENT SERVER STARTING...              ║
║                                                            ║
║  📡  API Server: http://localhost:${PORT}                  ║
║  🔐  Dev Secret: dev_secret_12345                         ║
║  ⏰  Timestamp: ${new Date().toISOString()}                ║
║                                                            ║
║  To test your panel:                                      ║
║  1. Change panel-config.js: ENV = 'LOCAL'                ║
║  2. Open panel.html in a browser                          ║
║  3. Check browser console for API calls                   ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
`);

// ── JWT Authentication Helper ──────────────────────────────────────────
function verifyJwt(authHeader) {
  const token = (authHeader || '').replace(/^Bearer\s+/i, '');
  if (!token) {
    console.log('  ⚠️  No auth token provided');
    return null;
  }
  
  // For local testing: accept mock tokens from panel testing
  if (token === 'mock_jwt_token_for_testing') {
    console.log(`  ✓ Mock token verified (LOCAL TESTING)`);
    return { user_id: 'test_user_123', channel_id: 'test_channel' };
  }
  
  try {
    const decoded = jwt.verify(token, LOCAL_DEV_SECRET);
    console.log(`  ✓ Token verified for user: ${decoded.user_id}`);
    return decoded;
  } catch (err) {
    console.log(`  ✗ Token verification failed: ${err.message}`);
    return null;
  }
}

// ── Generate Test Token ────────────────────────────────────────────────
function generateTestToken(userId = '123456789') {
  const payload = { user_id: userId, channel_id: 'test_channel', exp: Math.floor(Date.now() / 1000) + 3600 };
  const token = jwt.sign(payload, LOCAL_DEV_SECRET);
  return token;
}

// ── CORS Headers ───────────────────────────────────────────────────────
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');
}

// ── Mock API Response Data ─────────────────────────────────────────────
// Shape mirrors vercel-api/api/ext/me.js so panel.js renderPanel() works as in production.
const BASIC_ROD = { id: 'basic_rod', name: 'Basic Rod', emoji: '🎣', modifiers: {} };
const IRON_ROD  = { id: 'iron_rod',  name: 'Iron Rod',  emoji: '🪝', modifiers: { cooldownReduction: 2 } };
const WOODEN_RAFT = { id: 'wooden_raft', name: 'Wooden Raft', emoji: '🪵', modifiers: {}, imageUrl: null };
const STANDARD_BAIT = { id: 'standard_bait', name: 'Standard Bait', emoji: '🪱', modifiers: { coinBonus: 1.1 } };

const MOCK_FISH_LIST = [
  { index: 0, id: 'goldfish',  caughtAt: Date.now() - 60000,  name: 'Common Goldfish', emoji: '🐟', rarity: 'common', value: 10, weight: 0.5, mutation: null, locked: false },
  { index: 1, id: 'blue_fin',  caughtAt: Date.now() - 120000, name: 'Rare Blue Fin',   emoji: '🐠', rarity: 'rare',   value: 50, weight: 1.2, mutation: null, locked: false },
];
const MOCK_AFK_FISH_LIST = [
  { index: 0, id: 'goldfish', caughtAt: Date.now() - 300000, name: 'Common Goldfish', emoji: '🐟', rarity: 'common', value: 10, weight: 0.5, mutation: null, locked: false },
];

const MOCK_ME = {
  exists: true,
  username: 'testuser',
  displayName: 'testuser',
  lastFished: Date.now() - 60000,
  lastAutoFished: Date.now() - 120000,
  coins: 1000,
  fishCount: MOCK_FISH_LIST.length,
  fishValue: MOCK_FISH_LIST.reduce((s, f) => s + f.value, 0),
  fishList: MOCK_FISH_LIST,
  afkFishCount: MOCK_AFK_FISH_LIST.length,
  afkFishValue: MOCK_AFK_FISH_LIST.reduce((s, f) => s + f.value, 0),
  afkFishList: MOCK_AFK_FISH_LIST,
  equipped: {
    rod:  BASIC_ROD,
    bait: null,
    lure: null,
    boat: WOODEN_RAFT,
  },
  inventory: {
    rods: [BASIC_ROD, IRON_ROD],
    boats: [WOODEN_RAFT],
    baits: [{ ...STANDARD_BAIT, quantity: 5 }],
    lures: [],
  },
};

const MOCK_DATA = {
  me: MOCK_ME,
  shop: [
    { id: 'iron_rod',      name: 'Iron Rod',      type: 'rod',  cost: 500, emoji: '🪝', description: 'Faster cooldown',     modifiers: { cooldownReduction: 2 }, enabled: true, buyable: true },
    { id: 'standard_bait', name: 'Standard Bait', type: 'bait', cost: 10,  emoji: '🪱', description: 'Common fishing bait', modifiers: { coinBonus: 1.1 },       enabled: true, buyable: true },
  ],
  leaderboard: [
    { username: 'TopFisher',    totalValue: 50000, rank: 1 },
    { username: 'testuser',     totalValue: 5000,  rank: 2 },
    { username: 'CasualAngler', totalValue: 3000,  rank: 3 },
  ],
};

// ── API Endpoint Handlers ──────────────────────────────────────────────
const API_ROUTES = {
  '/api/ext/me': (req, res, method) => {
    if (method !== 'GET') {
      res.writeHead(405);
      return res.end(JSON.stringify({ error: 'Method not allowed' }));
    }
    const auth = verifyJwt(req.headers.authorization);
    if (!auth) {
      res.writeHead(401);
      return res.end(JSON.stringify({ error: 'Unauthorized' }));
    }
    
    // Matches the real shape returned by vercel-api/api/ext/me.js
    res.writeHead(200);
    res.end(JSON.stringify(MOCK_DATA.me));
  },

  '/api/ext/fish': (req, res, method) => {
    if (method !== 'GET') {
      res.writeHead(405);
      return res.end(JSON.stringify({ error: 'Method not allowed' }));
    }
    const auth = verifyJwt(req.headers.authorization);
    if (!auth) {
      res.writeHead(401);
      return res.end(JSON.stringify({ error: 'Unauthorized' }));
    }
    res.writeHead(200);
    res.end(JSON.stringify({ fish: MOCK_DATA.me.fishList }));
  },

  '/api/ext/shop': (req, res, method) => {
    if (method !== 'GET') {
      res.writeHead(405);
      return res.end(JSON.stringify({ error: 'Method not allowed' }));
    }
    res.writeHead(200);
    res.end(JSON.stringify(MOCK_DATA.shop));
  },

  '/api/ext/leaderboard': (req, res, method) => {
    if (method !== 'GET') {
      res.writeHead(405);
      return res.end(JSON.stringify({ error: 'Method not allowed' }));
    }
    res.writeHead(200);
    res.end(JSON.stringify(MOCK_DATA.leaderboard));
  },

  '/api/ext/cast': (req, res, method) => {
    if (method !== 'POST') {
      res.writeHead(405);
      return res.end(JSON.stringify({ error: 'Method not allowed' }));
    }
    const auth = verifyJwt(req.headers.authorization);
    if (!auth) {
      res.writeHead(401);
      return res.end(JSON.stringify({ error: 'Unauthorized' }));
    }
    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      fish: { name: 'Test Fish', rarity: 'rare', value: 50 },
      newCoins: 1050,
    }));
  },

  '/api/health': (req, res, method) => {
    if (method !== 'GET') {
      res.writeHead(405);
      return res.end(JSON.stringify({ error: 'Method not allowed' }));
    }
    res.writeHead(200);
    res.end(JSON.stringify({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: API_VERSION,
      mode: 'LOCAL_DEVELOPMENT',
    }));
  },

  '/api/test-token': (req, res, method) => {
    if (method !== 'GET') {
      res.writeHead(405);
      return res.end(JSON.stringify({ error: 'Method not allowed' }));
    }
    const token = generateTestToken();
    res.writeHead(200);
    res.end(JSON.stringify({
      token,
      userId: '123456789',
      expiresIn: 3600,
      message: 'Use this token in the Authorization header: Bearer ' + token,
    }));
  },
};

// ── Request Handler ────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method.toUpperCase();

  console.log(`\n📨 ${method} ${pathname}`);

  setCorsHeaders(res);

  if (method === 'OPTIONS') {
    res.writeHead(200);
    return res.end();
  }

  // Find matching route
  const handler = API_ROUTES[pathname];
  if (handler) {
    try {
      handler(req, res, method);
    } catch (err) {
      console.error('  ✗ Error:', err.message);
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Internal server error', message: err.message }));
    }
  } else {
    console.log(`  ✗ Route not found`);
    res.writeHead(404);
    res.end(JSON.stringify({
      error: 'Not found',
      availableEndpoints: Object.keys(API_ROUTES),
    }));
  }
});

server.listen(PORT, () => {
  console.log(`✅ Server listening on http://localhost:${PORT}\n`);
  console.log(`Available endpoints:`);
  Object.keys(API_ROUTES).forEach(route => {
    console.log(`  GET|POST ${route}`);
  });
  console.log(`\nTo get a test token: curl http://localhost:${PORT}/api/test-token\n`);
});

// ── Graceful Shutdown ──────────────────────────────────────────────────
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

module.exports = { verifyJwt, generateTestToken, MOCK_DATA };
