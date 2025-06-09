const admin = require('firebase-admin');
const db = admin.firestore();

async function saveRefreshToken(userId, refreshToken) {
  try {
    await db.collection('tokens').doc(userId).set({
      refreshToken: refreshToken
    });
    console.log(`Refresh token saved for user ${userId}`);
  } catch (error) {
    console.error('Error saving token:', error);
  }
}   

async function getRefreshToken(userId) {
  const doc = await db.collection('tokens').doc(userId).get();
  if (!doc.exists) {
    console.log(`No token found in Firestore for user ${userId}`);
    return null;
  }
  const data = doc.data();
  console.log(`Refresh token fetched from Firestore for user ${userId}:`, data.refreshToken);
  return data.refreshToken;
} 

module.exports = {
  saveRefreshToken,
  getRefreshToken
};
