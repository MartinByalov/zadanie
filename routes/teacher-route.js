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

// Права (scope), които искаме да поискаме
const scopes = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/drive.file',
];

// Разрешени учителски имейли (от .env, разделени със запетая)
const ALLOWED_TEACHERS = process.env.ALLOWED_TEACHERS
  ? process.env.ALLOWED_TEACHERS.split(',')
  : [];

// ID на папката с ученически файлове (service account)
const STUDENT_FOLDER_ID = process.env.STUDENT_FOLDER_ID;

// Настройка на директория за временно качване
const uploadDir = path.join(__dirname, '..', 'uploads', 'teacher');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Конфигурация на multer за качване на един файл, максимум 10MB
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 10 * 1024 * 1024 },
});

// В помощна функция взимаме папка за даден учител от Firestore
async function getTeacherFolderID(email) {
  const docRef = db.collection('teachers').doc(email);
  const doc = await docRef.get();
  if (!doc.exists) {
    throw new Error('Teacher not found in Firestore');
  }
  return doc.data().folderID;
}

// GET /teacher - показва dashboard с файловете и форма за качване
router.get('/', requireTeacher, async (req, res) => {
  try {
    const email = req.session.teacher.email;

    // Тук си слагаш кода за вземане на файлове от Google Drive
    // Примерно:
    const teacherFiles = await getTeacherFiles(email);
    const studentFiles = await getStudentFiles();

    // Рендирай с данните
    res.render('teacher', {
      teacherEmail: email,
      teacherFiles: teacherFiles,
      studentFiles: studentFiles,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Грешка при зареждане на панела.');
  }
});

 
// GET /teacher/login - стартира Google OAuth процес за учители
router.get('/login', (req, res) => {
  req.session.redirectTo = req.query.redirectTo || '/teacher';
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
  });
  res.redirect(authUrl);
});

// GET /teacher/oauth2callback - callback от Google OAuth
router.get('/oauth2callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    console.error('OAuth грешка:', error);
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

    // Проверка дали email е разрешен учител
    if (!email || !ALLOWED_TEACHERS.includes(email)) {
      console.warn('Неоторизиран опит за вход:', email);
      return res.status(403).send('Достъпът е отказан.');
    }

    // Записваме refresh token в Firestore
    if (tokens.refresh_token) {
      await saveRefreshToken(email, tokens.refresh_token);
    }

    // Запазваме в сесията
    req.session.teacher = {
      email,
      name: userinfo.data.name,
      picture: userinfo.data.picture,
      tokens,
    };

    req.session.save((err) => {
      if (err) {
        console.error('Грешка при запис на сесия:', err);
        return res.status(500).send('Грешка със сесията');
      }
      const redirectTo = req.session.redirectTo || '/teacher';
      delete req.session.redirectTo;
      res.redirect(redirectTo);
    });
  } catch (err) {
    console.error('OAuth callback грешка:', err);
    res.redirect('/teacher/login?error=auth_failed');
  }
});

// GET /teacher/teacher-files?teacher=email - API за файловете на учителя и учениците
router.get('/teacher-files', requireTeacher, async (req, res) => {
  const teacherEmail = req.query.teacher;
  if (!teacherEmail) {
    return res.status(400).json({ error: 'Липсва параметър teacher' });
  }

  try {
    // Вземаме папката на учителя
    const teacherDoc = await db.collection('teachers').doc(teacherEmail).get();
    if (!teacherDoc.exists) {
      return res.status(404).json({ error: 'Учителят не е намерен' });
    }
    const TEACHER_FOLDER_ID = teacherDoc.data().folderID;

    // Настройваме OAuth с токена от сесията
    oauth2Client.setCredentials(req.session.teacher.tokens);

    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    // Вземаме файловете на учителя
    const teacherFilesResponse = await drive.files.list({
      q: `'${TEACHER_FOLDER_ID}' in parents and trashed = false`,
      fields: 'files(id,name,webViewLink,iconLink,modifiedTime)',
      orderBy: 'modifiedTime desc',
      pageSize: 10,
    });

    // Вземаме ученическите файлове
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
    console.error('Грешка при вземане на файловете:', err);
    res.status(500).json({ error: 'Грешка при вземане на файловете' });
  }
});

// POST /teacher/upload - качване на файл в папката на учителя
router.post('/upload', requireTeacher, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('Моля, изберете файл за качване.');
  }

  try {
    const email = req.session.teacher.email;

    // Вземаме refresh token
    const refreshToken = await getRefreshToken(email);
    if (!refreshToken) {
      return res.status(403).send('Моля влезте в системата, за да качите файл.');
    }
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    // Обновяване на access token
    try {
      const newTokenObj = await oauth2Client.getAccessToken();
      if (!newTokenObj || !newTokenObj.token) {
        throw new Error('No access token returned');
      }
      oauth2Client.setCredentials({
        access_token: newTokenObj.token,
        refresh_token: refreshToken,
      });
    } catch (e) {
      console.error('Неуспешно обновяване на токена:', e);
      return res.status(
403).send('Грешка с токена, моля влезте отново.');
}
const drive = google.drive({ version: 'v3', auth: oauth2Client });

// Вземаме папката на учителя
const TEACHER_FOLDER_ID = await getTeacherFolderID(email);

// Подготвяме метаданни и файл
const fileMetadata = {
  name: req.file.originalname,
  parents: [TEACHER_FOLDER_ID],
};

const media = {
  mimeType: req.file.mimetype,
  body: fs.createReadStream(req.file.path),
};

// Качваме файла в Google Drive
const file = await drive.files.create({
  resource: fileMetadata,
  media: media,
  fields: 'id, name, webViewLink',
});

// Изтриваме локалното копие след качване
fs.unlink(req.file.path, (err) => {
  if (err) {
    console.error('Грешка при изтриване на локален файл:', err);
  }
});

// Редирект към dashboard с успех
res.redirect('/teacher');
} catch (err) {
console.error('Error uploading file:', err);
res.status(500).send('Възникна грешка при качване на файла.');
}
});

router.get('/teacher/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error(err);
      return res.status(500).send('Грешка при изход');
    }
    res.redirect('/'); // пренасочваме към ученическата страница
  });
});
 

module.exports = router;