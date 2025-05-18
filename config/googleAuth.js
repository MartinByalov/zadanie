const { google } = require('googleapis');
const admin = require('firebase-admin');
require('dotenv').config();

const serviceAccountJson = process.env.SERVICE_ACCOUNT_JSON;

let firestore = null;
let studentAuth = null;

// Създаване на OAuth2 клиент за учители
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Инициализация на Firebase Admin SDK от JSON стринг (без файл)
if (serviceAccountJson) {
  try {
    const serviceAccount = JSON.parse(serviceAccountJson);

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      firestore = admin.firestore();
      console.log('Firestore initialized from SERVICE_ACCOUNT_JSON');
    }

    // Инициализация на GoogleAuth за service account (студенти)
    studentAuth = new google.auth.GoogleAuth({
      credentials: serviceAccount,
      scopes: ['https://www.googleapis.com/auth/drive']
    });

  } catch (err) {
    console.error('Failed to parse or initialize service account JSON:', err.message);
  }
} else {
  console.warn('SERVICE_ACCOUNT_JSON environment variable not found. Student uploads disabled.');
}

// Зареждане на refresh token (ако съществува)
try {
  const fs = require('fs');
  const path = require('path');
  const refreshTokenPath = path.join(__dirname, '..', 'refresh-token.txt');
  if (fs.existsSync(refreshTokenPath)) {
    const refreshToken = fs.readFileSync(refreshTokenPath, 'utf8').trim();
    oauth2Client.setCredentials({ refresh_token: refreshToken });
  }
} catch (err) {
  console.warn('Failed to load refresh token:', err.message);
}

// Инициализация на Drive API за учители
const teacherDrive = google.drive({
  version: 'v3',
  auth: oauth2Client,
  params: { supportsAllDrives: true, includeItemsFromAllDrives: true }
});

// Инициализация на Drive API за ученици (service account)
const studentDrive = studentAuth
  ? google.drive({
      version: 'v3',
      auth: studentAuth,
      params: { supportsAllDrives: true, includeItemsFromAllDrives: true }
    })
  : null;

module.exports = {
  firestore,
  teacherDrive,
  studentDrive,
  oauth2Client
};
