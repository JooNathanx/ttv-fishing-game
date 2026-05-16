const { getDb } = require('../../lib/firebase');
const { cors } = require('../../lib/auth');

// Whitelist of sortable fields (prevents arbitrary field reads)
const METRICS = {
  totalValue:  { field: 'totalValue',  label: 'Total Value Caught' },
  totalCaught: { field: 'totalCaught', label: 'Fish Caught' },
  coins:       { field: 'coins',       label: 'Current Coins' },
};

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const metricKey = String(req.query.metric || 'totalValue');
  const meta = METRICS[metricKey];
  if (!meta) return res.status(400).json({ error: 'Invalid metric' });

  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 100);

  try {
    const snap = await getDb()
      .collection('users')
      .orderBy(meta.field, 'desc')
      .limit(limit)
      .get();

    const entries = snap.docs
      .filter(d => !d.data().banned)
      .map((doc, i) => {
        const d = doc.data();
        return {
          rank: i + 1,
          username: d.username || 'Anonymous',
          coins: d.coins || 0,
          totalCaught: d.totalCaught || 0,
          totalValue: d.totalValue || 0,
        };
      });

    res.json({ metric: metricKey, label: meta.label, entries });
  } catch (e) {
    console.error('leaderboard failed', e);
    res.status(500).json({ error: 'Leaderboard temporarily unavailable' });
  }
};
