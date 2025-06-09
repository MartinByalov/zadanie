const { google } = require('googleapis');
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

class AuthInitializer {
  constructor() {
    this.firestore = null;
    this.studentAuth = null;
    this.oauth2Client = null;
    this.teacherDrive = null;
    this.studentDrive = null;
  }

  initialize() {
    try {
      this._initializeFirebase(); // Първо инициализираме Firebase
      this._initializeTeacherAuth();
      this._initializeStudentAuth();
      this._loadRefreshToken();
      this._initializeDriveApis(); 
      return this; // Връщаме инстанцията за допълнителни проверки
    } catch (error) {
      console.error('Initialization error:', error);
      throw error;
    }
  }

  _initializeFirebase() {
    if (!process.env.SERVICE_ACCOUNT_JSON) {
      throw new Error('SERVICE_ACCOUNT_JSON environment variable is required');
    }

    try {
      const serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT_JSON);
      
      // Проверка дали Firebase вече е инициализиран
      if (admin.apps.length === 0) {
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          databaseURL: process.env.FIREBASE_DATABASE_URL
        });
        console.log('Firebase Admin SDK initialized successfully');
      }

      // Винаги присвояваме firestore, независимо дали е нова инициализация
      this.firestore = admin.firestore();
      console.log('Firestore initialized successfully');

    } catch (error) {
      console.error('Firebase initialization failed:', error);
      throw new Error('Failed to initialize Firebase');
    }
  }

  _initializeTeacherAuth() {
    try {
      this.oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
      );
      console.log('OAuth2 client initialized for teachers');
    } catch (error) {
      console.error('Failed to initialize teacher auth:', error);
      throw new Error('Failed to initialize teacher authentication');
    }
  }

  _initializeStudentAuth() {
    try {
      if (!process.env.SERVICE_ACCOUNT_JSON) {
        console.warn('No service account configured for student auth');
        return;
      }

      const serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT_JSON);
      this.studentAuth = new google.auth.GoogleAuth({
        credentials: serviceAccount,
        scopes: [
          'https://www.googleapis.com/auth/drive',
          'https://www.googleapis.com/auth/drive.file'
        ]
      });
      console.log('Student auth initialized successfully');
    } catch (error) {
      console.error('Failed to initialize student auth:', error);
      this.studentAuth = null;
    }
  }

  _loadRefreshToken() {
    try {
      const refreshTokenPath = path.join(__dirname, '..', 'refresh-token.txt');
      if (fs.existsSync(refreshTokenPath)) {
        const refreshToken = fs.readFileSync(refreshTokenPath, 'utf8').trim();
        this.oauth2Client.setCredentials({ 
          refresh_token: refreshToken,
          access_type: 'offline'
        });
        console.log('Refresh token loaded successfully');
      }
    } catch (error) {
      console.warn('Could not load refresh token:', error.message);
    }
  }

  _initializeDriveApis() {
    const commonParams = {
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    };

    // Инициализация на Drive API за учители
    this.teacherDrive = google.drive({
      version: 'v3',
      auth: this.oauth2Client,
      params: commonParams
    });
    console.log('Teacher Drive API initialized');

    // Инициализация на Drive API за ученици (ако има studentAuth)
    if (this.studentAuth) {
      this.studentDrive = google.drive({
        version: 'v3',
        auth: this.studentAuth,
        params: commonParams
      });
      console.log('Student Drive API initialized');
    } else {
      console.warn('Student Drive API not initialized - no student auth');
    }
  }
}

// Инициализация и експорт
let authInstance;
try {
  authInstance = new AuthInitializer().initialize();
  console.log('Authentication services initialized successfully');
} catch (error) {
  console.error('FATAL: Failed to initialize authentication services:', error);
  process.exit(1);
}

module.exports = {
  firestore: authInstance.firestore,
  teacherDrive: authInstance.teacherDrive,
  studentDrive: authInstance.studentDrive,
  oauth2Client: authInstance.oauth2Client
};