// teacher-route.js

const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const admin = require('firebase-admin');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const { google } = require('googleapis');

const requireTeacher = require('../middleware/requireTeacher');
const { studentDrive } = require('../config/googleAuth'); // service account за ученически файлове
const { saveRefreshToken, getRefreshToken } = require('../services/token-service');

const router = express.Router();

// Инициализация на Firebase admin (ако още не е инициализиран)
if (!admin.apps.length) {
  initializeApp({
    credential: applicationDefault(),
  });
}
const db = getFirestore();

// Google OAuth2 клиент за учители
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Права, които искаме за достъп (скоупове)
const scopes = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/drive.file',
];

// Списък с разрешени учителски email-и (от .env)
const ALLOWED_TEACHERS = process.env.ALLOWED_TEACHERS
  ? process.env.ALLOWED_TEACHERS.split(',')
  : [];

// ID на папката с ученически файлове (service account)
const STUDENT_FOLDER_ID = process.env.STUDENT_FOLDER_ID;

// Настройка на временно качване на файлове
const uploadDir = path.join(__dirname, '..', 'uploads', 'teacher');

// Създаване на директория за качване, ако не съществува
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Конфигурация на multer за качване на един файл с лимит 10MB
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Помощна функция: Вземане на Google Drive folderID за учител по email от Firestore
async function getTeacherFolderID(email) {
  const docRef = db.collection('teachers').doc(email);
  const doc = await docRef.get();
  if (!doc.exists) {
    throw new Error('Teacher not found in Firestore');
  }
  return doc.data().folderID;
}

/**
 * Рут: GET /teacher
 * Зарежда dashboard с файловете на учителя и учениците.
 * Изисква аутентикация с requireTeacher middleware.
 */
router.get('/', requireTeacher, async (req, res) => {
  try {
    const email = req.session.teacher.email;

    // Вземаме refresh token за учителя от Firestore (ако има)
    const refreshToken = await getRefreshToken(email);

    if (refreshToken) {
      oauth2Client.setCredentials({
        refresh_token: refreshToken,
        access_token: req.session.teacher.tokens.access_token,
        scope: req.session.teacher.tokens.scope,
        token_type: req.session.teacher.tokens.token_type,
        expiry_date: req.session.teacher.tokens.expiry_date,
      });
    } else {
      oauth2Client.setCredentials(req.session.teacher.tokens);
    }

    // Вземаме папката на учителя
    const TEACHER_FOLDER_ID = await getTeacherFolderID(email);

    // Инициализираме Google Drive API
    const drive = google.drive({
      version: 'v3',
      auth: oauth2Client,
      params: {
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      },
    });

    // Вземаме файловете на учителя от Google Drive
    const teacherFilesResponse = await drive.files.list({
      q: `'${TEACHER_FOLDER_ID}' in parents and trashed = false`,
      fields: 'files(id,name,webViewLink,iconLink,modifiedTime)',
      orderBy: 'modifiedTime desc',
      pageSize: 10,
    });

    // Вземаме файловете на учениците от общата папка, чрез service account
    let studentFiles = [];
    try {
      const studentFilesResponse = await studentDrive.files.list({
        q: `'${STUDENT_FOLDER_ID}' in parents and trashed = false`,
        fields: 'files(id,name,webViewLink,iconLink,modifiedTime)',
        orderBy: 'modifiedTime desc',
        pageSize: 10,
      });
      studentFiles = studentFilesResponse.data.files;
    } catch (err) {
      console.error('Error fetching student files:', err);
    }

    // Рендиране на прост HTML dashboard (може да ползваш шаблонизатор вместо това)
    res.send(`
      <!DOCTYPE html>
      <html lang="bg">
      <head>
        <meta charset="UTF-8" />
        <title>Teacher Dashboard</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 900px; margin: auto; padding: 20px; }
          .header { display: flex; justify-content: space-between; align-items: center; }
          .file-grid { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 20px; }
          .file-card { border: 1px solid #ccc; border-radius: 4px; padding: 10px; width: 220px; box-sizing: border-box; }
          .file-icon { width: 20px; height: 20px; vertical-align: middle; margin-right: 8px; }
          .file-name { font-weight: bold; color: #333; text-decoration: none; }
          .file-date { font-size: 0.85em; color: #666; margin-top: 5px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Учителски панел</h1>
          <a href="/teacher/logout">Изход</a>
        </div>

        <section>
          <h2>Качи нов учебен материал</h2>
          <form action="/teacher/upload" method="post" enctype="multipart/form-data">
            <input type="file" name="file" required />
            <button type="submit">Качи</button>
          </form>
        </section>

        <section>
          <h2>Файлове на учителя</h2>
          ${teacherFilesResponse.data.files.length > 0 ? `
            <div class="file-grid">
              ${teacherFilesResponse.data.files.map(file => `
                <div class="file-card">
                  <img src="${file.iconLink}" alt="икона" class="file-icon" />
                  <a href="${file.webViewLink}" target="_blank" class="file-name">${file.name}</a>
                  <div class="file-date">${new Date(file.modifiedTime).toLocaleString()}</div>
                </div>
              `).join('')}
            </div>
          ` : `<p>Няма качени файлове.</p>`}
        </section>

        <section>
          <h2>Файлове на учениците</h2>
          ${studentFiles.length > 0 ? `
            <div class="file-grid">
              ${studentFiles.map(file => `
                <div class="file-card">
                  <img src="${file.iconLink}" alt="икона" class="file-icon" />
                  <a href="${file.webViewLink}" target="_blank" class="file-name">${file.name}</a>
                  <div class="file-date">${new Date(file.modifiedTime).toLocaleString()}</div>
                </div>
              `).join('')}
            </div>
          ` : `<p>Няма качени ученически файлове.</p>`}
        </section>
      </body>
      </html>
    `);

  } catch (err) {
    console.error('Error loading teacher dashboard:', err);
    res.status(500).send('Възникна грешка на сървъра.');
  }
});

/**
 * Рут: GET /teacher/login
 * Започва OAuth2 процеса за учителски вход.
 */
router.get('/login', (req, res) => {
  req.session.redirectTo = req.query.redirectTo || '/teacher';
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline', // за получаване на refresh token
    scope: scopes,
  });
  res.redirect(authUrl);
});

/**
 * Рут: GET /teacher/oauth2callback
 * Обработва Google OAuth2 callback и създава сесия.
 */
router.get('/oauth2callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    console.error('OAuth error:', error);
    return res.redirect('/teacher/login?error=auth_failed');
  }

  if (!code) {
    return res.status(400).send('Липсва код за автентикация.');
  }

  try {
    // Вземаме tokens
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Вземаме информация за потребителя
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userinfo = await oauth2.userinfo.get();

    const email = userinfo.data.email;

    // Проверка дали е разрешен учител
    if (!email || !ALLOWED_TEACHERS.includes(email)) {
      console.warn('Неоторизиран опит за вход:', email);
      return res.status(403).send('Достъпът е отказан.');
    }

    // Записваме refresh token-а в Firestore
    if (tokens.refresh_token) {
      await saveRefreshToken(email, tokens.refresh_token);
    }

    // Запазваме данните в сесия
    req.session.teacher = {
      email,
      name: userinfo.data.name,
      picture: userinfo.data.picture,
      tokens,
    };

    req.session.save((err) => {
      if (err) {
        console.error('Грешка при запис на сесията:', err);
        return res.status(500).send('Грешка със сесията');
      }
      const redirectTo = req.session.redirectTo || '/teacher';
      delete req.session.redirectTo;
      res.redirect(redirectTo);
    });
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.redirect('/teacher/login?error=auth_failed');
  }
});

/**
 * Рут: GET /teacher/teacher-files?teacher=email
 * API за връщане на JSON с файловете на учителя и учениците.
 */
router.get('/teacher-files', async (req, res) => {
  const teacherEmail = req.query.teacher;
  if (!teacherEmail) {
    return res.status(400).json({ error: 'Липсва параметър teacher' });
  }

  try {
    // Вземаме папката на учителя
    const teacherDoc = await db.collection('teachers_upload').doc(teacherEmail).get();
    if (!teacherDoc.exists) {
      return res.status(404).json({ error: 'Учителят не е намерен' });
    }
    const TEACHER_FOLDER_ID = teacherDoc.data().folderID;

    // Подгответе OAuth2 client с токена от сесията
    oauth2Client.setCredentials(req.session.teacher.tokens);

    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    // Вземаме файловете на учителя
    const teacherFilesResponse = await drive.files.list({
      q: `'${TEACHER_FOLDER_ID}' in parents and trashed = false`,
      fields: 'files(id,name,webViewLink,iconLink,modifiedTime)',
      orderBy: 'modifiedTime desc',
      pageSize: 10,
    });

    // Вземаме файловете на учениците (service account)
    const studentFilesResponse = await studentDrive.files.list({
      q: `'${STUDENT_FOLDER_ID}' in parents and trashed = false`,
      fields: 'files(id,name,webViewLink,iconLink,modifiedTime)',
      orderBy: 'modifiedTime desc',
      pageSize: 10,
    });

    res.json({
      teacherFiles: teacherFilesResponse.data.files,
      studentFiles: studentFilesResponse.data.files,
    });
  } catch (err) {
    console.error('Error fetching files:', err);
    res.status(500).json({ error: 'Грешка при вземане на файловете' });
  }
});

/**
 * Рут: POST /teacher/upload
 * Качва файл в папката на учителя в Google Drive.
 */
router.post('/upload', requireTeacher, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('Моля, изберете файл за качване.');
  }

  try {
    const email = req.session.teacher.email;

    // Вземаме папката на учителя
    const TEACHER_FOLDER_ID = await getTeacherFolderID(email);

    oauth2Client.setCredentials(req.session.teacher.tokens);

    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    // Подготвяме метаданните и съдържанието
    const fileMetadata = {
      name: req.file.originalname,
      parents: [TEACHER_FOLDER_ID],
    };

    const media = {
      mimeType: req.file.mimetype,
      body: fs.createReadStream(req.file.path),
    };

    // Качваме файла
    await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id, name',
    });

    // Изтриваме временния файл
    fs.unlink(req.file.path, (err) => {
      if (err) console.error('Грешка при изтриване на временен файл:', err);
    });

    res.redirect('/teacher');
  } catch (err) {
    console.error('Грешка при качване на файл:', err);
    res.status(500).send('Грешка при качване на файла.');
  }
});

/**
 * Рут: GET /teacher/logout
 * Изход от системата, изтриване на сесията.
 */
router.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Грешка при изтриване на сесията:', err);
    }
    res.redirect('/teacher/login');
  });
});

module.exports = router;
