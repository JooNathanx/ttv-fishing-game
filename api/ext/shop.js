const { getDb } = require('../../lib/firebase');
const { cors } = require('../../lib/auth');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const db = getDb();
  const snap = await db.collection('items').get();
  const items = snap.docs.map(d => d.data()).filter(i => i.enabled && i.buyable !== false);
  res.json(items);
};
