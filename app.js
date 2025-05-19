require('dotenv').config();

const express = require('express');
const session = require('express-session');
const FirestoreStore = require('firestore-store')(session);
const path = require('path');
const admin = require('firebase-admin');

const app = express();

// Настройка на EJS като шаблонизатор
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Инициализация на Firebase Admin SDK
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

// Middleware за почистване на сесията от undefined
function cleanSessionMiddleware(req, res, next) {
  // Проверка дали има сесия
  if (req.session) {
    // Функция за рекурсивно заместване на undefined с null в обект
    function replaceUndefinedWithNull(obj) {
      if (!obj || typeof obj !== 'object') return obj;
      Object.keys(obj).forEach(key => {
        if (obj[key] === undefined) {
          obj[key] = null;
        } else if (typeof obj[key] === 'object') {
          replaceUndefinedWithNull(obj[key]);
        }
      });
      return obj;
    }

    // Почистваме req.session
    replaceUndefinedWithNull(req.session);
  }
  next();
}

// Добавяме middleware за почистване ПРЕДИ сесиите да се записват


// Middleware за body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ако ползваш reverse proxy като NGINX
app.set('trust proxy', 1);

// Firestore session store
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  store: new FirestoreStore({
    database: db,
    collection: 'sessions'
  }),
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,       // Ако HTTPS - сложи true
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 1 ден
    sameSite: 'lax'
  }
}));

app.use(cleanSessionMiddleware);

// Debugging middleware за сесията
app.use((req, res, next) => {
  if (req.session) {
    function replaceUndefinedWithNull(obj) {
      if (!obj || typeof obj !== 'object') return obj;
      Object.keys(obj).forEach(key => {
        if (obj[key] === undefined) {
          obj[key] = null;
        } else if (typeof obj[key] === 'object') {
          replaceUndefinedWithNull(obj[key]);
        }
      });
      return obj;
    }
    replaceUndefinedWithNull(req.session);
  }
  next(); 
});
 

// Статични файлове
app.use(express.static(path.join(__dirname, 'public')));

// Роутове
app.use('/', require('./routes/student-route'));
app.use('/teacher', require('./routes/teacher-route'));
app.use('/upload-student-file', require('./routes/student-route'));

// 404 middleware
app.use((req, res, next) => {
  res.status(404).send('Страницата не е намерена');
});

// Error middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Нещо се обърка!');
});

// Стартиране на сървъра
app.listen(PORT, () => {
  console.log(`Сървърът работи на http://localhost:${PORT}`);
});
