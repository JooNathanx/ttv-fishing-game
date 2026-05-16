const admin = require('firebase-admin');

let db = null;

function getDb() {
  if (!db) {
    if (!admin.apps.length) {
      const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({ credential: admin.credential.cert(sa) });
    }
    db = admin.firestore();
  }
  return db;
}

module.exports = { getDb };
