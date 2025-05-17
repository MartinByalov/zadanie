require('dotenv').config();

const express = require('express');
const session = require('express-session');
const FirestoreStore = require('firestore-store')(session);
const path = require('path');

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
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.set('trust proxy', 1); // ако си зад 1 reverse proxy като NGINX

// ✅ Firestore-based session store
app.use(session({
  secret: process.env.SESSION_SECRET,
  store: new FirestoreStore({
    database: db,                     // 🔧 Тук беше грешката (трябва "database", не "dataset")
    collection: 'sessions'            // 🔧 А не "kind"
  }),
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax'
  }
}));

// Debugging middleware
app.use((req, res, next) => {
  console.log('Session ID:', req.sessionID);
  console.log('Session data:', req.session);
  next();
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/', require('./routes/student-route'));
app.use('/teacher', require('./routes/teacher-route'));
app.use('/upload-student-file', require('./routes/student-route'));

// Server
app.listen(PORT, () => {
  console.log(`Сървърът работи на http://localhost:${PORT}`);
});

// 404 Middleware
app.use((req, res, next) => {
  res.status(404).send('Страницата не е намерена');
});

// Error Middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Нещо се обърка!');
});
