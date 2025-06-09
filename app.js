require('dotenv').config();

const express = require('express');
const session = require('express-session');
const FirestoreStore = require('firestore-store')(session);
const path = require('path');
const admin = require('firebase-admin');

const app = express();

// Set EJS as the templating engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Initialize Firebase Admin SDK
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
const PORT = process.env.PORT || 3000;

// Middleware to clean session from undefined values (sets them to null)
// Defined once
function cleanSessionMiddleware(req, res, next) {
    if (req.session) {
        function replaceUndefinedWithNull(obj) {
            if (!obj || typeof obj !== 'object') return obj;
            Object.keys(obj).forEach(key => {
                if (obj[key] === undefined) {
                    obj[key] = null;
                } else if (typeof obj[key] === 'object' && obj[key] !== null) { // Added null check for objects
                    replaceUndefinedWithNull(obj[key]);
                }
            });
            return obj;
        }
        replaceUndefinedWithNull(req.session);
    }
    next();
}

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Trust proxy for NGINX or other reverse proxies
app.set('trust proxy', 1);

// Apply cleanSessionMiddleware BEFORE the session middleware
app.use(cleanSessionMiddleware);

// Firestore session store configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key', // Use a strong, random secret
    store: new FirestoreStore({
        database: db,
        collection: 'sessions'
    }),
    resave: false,
    saveUninitialized: false,
    cookie: {
    secure: false, // Изрично зададено на false за HTTP (localhost)
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 1 day
    sameSite: 'lax'
}
}));

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

app.use('/teacher', require('./routes/teacher-route'));

// Routes
// Mount student routes directly to the root path
app.use('/', require('./routes/student-route'));
// Teacher routes remain under /teacher


// 404 middleware for unhandled routes
app.use((req, res, next) => {
    res.status(404).send('Страницата не е намерена');
});

// Generic error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Нещо се обърка!');
});

// Start the server
app.listen(PORT, () => {
    console.log(`Сървърът работи на http://localhost:${PORT}`);
});