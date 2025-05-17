const admin = require('firebase-admin');

let serviceAccount;

if (process.env.FIREBASE_KEY_JSON) {
  serviceAccount = JSON.parse(process.env.FIREBASE_KEY_JSON);
} else {
  serviceAccount = require('./config/firebase-key.json');
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function saveRefreshToken(email, refreshToken) {
  try {
    await db.collection('tokens').doc(email).set({
      refreshToken: refreshToken
    }); 
    console.log(`Refresh token saved for user ${email}`);
  } catch (error) {
    console.error('Error saving token:', error);
  }
}

async function getRefreshToken(email) {
  try {
    const doc = await db.collection('tokens').doc(email).get();
    if (!doc.exists) {
      console.log(`No token found for ${email}`);
      return null;
    }
    return doc.data().refreshToken;
  } catch (error) {
    console.error('Error getting token:', error);
    return null;
  }
}

module.exports = {
  saveRefreshToken,
  getRefreshToken
};
