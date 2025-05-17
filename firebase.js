const admin = require('firebase-admin');
const serviceAccount = require('./config/firebase-key.json');

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
