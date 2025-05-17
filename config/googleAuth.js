const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// OAuth2 конфигурация за учители
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Зареждане на refresh token (ако съществува)
try {
  const refreshTokenPath = path.join(__dirname, '..', 'refresh-token.txt');
  if (fs.existsSync(refreshTokenPath)) {
    const refreshToken = fs.readFileSync(refreshTokenPath, 'utf8').trim();
    oauth2Client.setCredentials({ refresh_token: refreshToken });
  }
} catch (err) {
  console.warn('Failed to load refresh token:', err.message);
}

// Service account конфигурация за ученици
let studentAuth;
const serviceAccountPath = path.join(__dirname, '..', 'service-account.json');
if (fs.existsSync(serviceAccountPath)) {
  studentAuth = new google.auth.GoogleAuth({
    keyFile: serviceAccountPath,
    scopes: ['https://www.googleapis.com/auth/drive']
  });
} else {
  console.warn('Service account file not found. Student uploads will be disabled.');
}

// Инициализация на Drive API
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
  SCOPES: [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'openid'
  ]
};