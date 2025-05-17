const { google } = require('googleapis');
const admin = require('firebase-admin');
require('dotenv').config();

// ===== OAuth2 конфигурация за учители =====
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Зареждане на refresh token от файл (ако съществува локално)
try {
  const refreshTokenPath = require('path').join(__dirname, '..', 'refresh-token.txt');
  const fs = require('fs');
  if (fs.existsSync(refreshTokenPath)) {
    const refreshToken = fs.readFileSync(refreshTokenPath, 'utf8').trim();
    oauth2Client.setCredentials({ refresh_token: refreshToken });
  }
} catch (err) {
  console.warn('Failed to load refresh token:', err.message);
}

// ===== Service Account конфигурация за ученици =====
let studentAuth = null;
let firestore = null;

try {
  if (!process.env.SERVICE_ACCOUNT_JSON) {
    throw new Error('SERVICE_ACCOUNT_JSON is not defined in environment');
  }

  const serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT_JSON);

  // Инициализация на GoogleAuth за ученически Drive
  studentAuth = new google.auth.GoogleAuth({
    credentials: serviceAccount,
    scopes: ['https://www.googleapis.com/auth/drive']
  });

  // Инициализация на Firestore
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    firestore = admin.firestore();
  }
} catch (err) {
  console.warn('Service Account config failed:', err.message);
}

// ===== Инициализация на Drive API =====
const teacherDrive = google.drive({
  version: 'v3',
  auth: oauth2Client,
  params: { supportsAllDrives: true, includeItemsFromAllDrives: true }
});

const studentDrive = studentAuth ? google.drive({
  version: 'v3',
  auth: studentAuth,
  params: { supportsAllDrives: true, includeItemsFromAllDrives: true }
}) : null;

module.exports = {
  oauth2Client,
  teacherDrive,
  studentDrive,
  firestore,
  SCOPES: [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'openid'
  ]
};
