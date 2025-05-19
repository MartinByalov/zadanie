const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { google } = require('googleapis');
const { v4: uuidv4 } = require('uuid');

const { firestore, teacherDrive, studentDrive, oauth2Client } = require('../config/googleAuth');
const { requireTeacher } = require('../middleware/requireTeacher');
const { saveRefreshToken, getRefreshToken } = require('../services/token-service');

const router = express.Router();

const scopes = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid'
];

const ALLOWED_TEACHERS = process.env.ALLOWED_TEACHERS
  ? process.env.ALLOWED_TEACHERS.split(',').map(e => e.trim())
  : [];

const STUDENT_FOLDER_ID = process.env.STUDENT_FOLDER_ID;

const uploadDir = path.join(__dirname, '..', 'uploads', 'teacher');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 100 * 1024 * 1024 },
});

// Помощна функция за замяна на undefined с null (рекурсивно)
function cleanUndefined(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  for (const key of Object.keys(obj)) {
    if (obj[key] === undefined) {
      obj[key] = null;
    } else if (typeof obj[key] === 'object') {
      cleanUndefined(obj[key]);
    }
  }
  return obj;
}

async function getTeacherFolderID(email) {
  const docRef = firestore.collection('teachers').doc(email);
  const doc = await docRef.get();
  if (!doc.exists) {
    throw new Error('Teacher not found in Firestore');
  }
  return doc.data().folderID;
}

async function getTeacherFiles(email, tokens) {
  oauth2Client.setCredentials(tokens);

  const TEACHER_FOLDER_ID = await getTeacherFolderID(email);

  const [teacherFilesResponse, studentFilesResponse] = await Promise.all([
    teacherDrive.files.list({
      q: `'${TEACHER_FOLDER_ID}' in parents and trashed = false`,
      fields: 'files(id,name,webViewLink,iconLink,modifiedTime)',
      orderBy: 'modifiedTime desc',
      pageSize: 10,
    }),
    studentDrive.files.list({
      q: `'${STUDENT_FOLDER_ID}' in parents and trashed = false`,
      fields: 'files(id,name,webViewLink,iconLink,modifiedTime)',
      orderBy: 'modifiedTime desc',
      pageSize: 10,
    })
  ]);

  return {
    teacherFiles: teacherFilesResponse.data.files,
    studentFiles: studentFilesResponse.data.files,
  };
}

// 👇 Начална страница за учител
router.get('/', requireTeacher, async (req, res) => {
  try {
    const email = req.session.teacher.email;
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

    const { teacherFiles, studentFiles } = await getTeacherFiles(email, oauth2Client.credentials);

    res.render('teacher-dashboard', {
      teacherFiles,
      studentFiles,
      teacherEmail: email,
    });
  } catch (err) {
    console.error('Error loading teacher dashboard:', err);
    res.status(500).send('Възникна грешка на сървъра.');
  }
});

// 👇 OAuth вход
router.get('/login', (req, res) => {
  const state = uuidv4();
  req.session.oauthState = state;

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent',
    state: state,
  });

  res.redirect(authUrl);
});

// 👇 OAuth callback
router.get('/oauth2callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    console.error('OAuth грешка:', error);
    return res.redirect('/teacher/login?error=auth_failed');
  }

  if (!code || !state || state !== req.session.oauthState) {
    console.error('Invalid or missing state');
    return res.status(403).send('Invalid state parameter');
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userinfo = await oauth2.userinfo.get();
    const email = userinfo.data.email;

    if (!email || !ALLOWED_TEACHERS.includes(email)) {
      console.warn('Опит за неоторизиран достъп:', email);
      return res.status(403).send('Достъпът е отказан.');
    }

    if (tokens.refresh_token) {
      await saveRefreshToken(email, tokens.refresh_token);
    }

    const teacherData = {
      email: email,
      name: userinfo.data.name,
      picture: userinfo.data.picture,
      tokens: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        scope: tokens.scope,
        token_type: tokens.token_type,
        expiry_date: tokens.expiry_date,
      }
    };

    req.session.teacher = cleanUndefined(teacherData);

    delete req.session.oauthState;

    req.session.save(err => {
      if (err) {
        console.error('Session save error:', err);
        return res.status(500).send('Session error');
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

// 👇 Качване на файл
router.post('/upload', requireTeacher, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).send('Изберете файл.');

  try {
    const email = req.session.teacher.email;
    const refreshToken = await getRefreshToken(email);
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    const { token } = await oauth2Client.getAccessToken();
    oauth2Client.setCredentials({ access_token: token, refresh_token: refreshToken });

    const folderId = await getTeacherFolderID(email);
    const fileMetadata = {
      name: req.file.originalname,
      parents: [folderId],
    };
    const media = {
      mimeType: req.file.mimetype,
      body: fs.createReadStream(req.file.path),
    };

    await teacherDrive.files.create({
      resource: fileMetadata,
      media,
      fields: 'id',
    });

    fs.unlink(req.file.path, () => {});

    res.redirect('/teacher');
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).send('Грешка при качване.');
  }
});

// 👇 Изход
router.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Session destroy error:', err);
      return res.status(500).send('Logout failed');
    }

    res.clearCookie('connect.sid');
    res.redirect('/');
  });
});

module.exports = router;
