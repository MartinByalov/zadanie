const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const fsp = require('fs').promises;
const { google } = require('googleapis');
const { v4: uuidv4 } = require('uuid');

const { firestore, teacherDrive, studentDrive, oauth2Client } = require('../config/googleAuth');
const { requireTeacher } = require('../middleware/requireTeacher');
const { saveRefreshToken, getRefreshToken } = require('../services/token-service');

const router = express.Router();

// ПРОМЯНА: Променете обхвата на 'https://www.googleapis.com/auth/drive'
const scopes = [
  'https://www.googleapis.com/auth/drive', // Променено от drive.file на drive
  'https://www.googleapis.com/auth/userinfo.email',
  'openid'
];

const ALLOWED_TEACHERS = process.env.ALLOWED_TEACHERS
  ? process.env.ALLOWED_TEACHERS.split(',').map(e => e.trim())
  : [];

// Използваме тази константа за ID на папката за ученически файлове
const STUDENT_FOLDER_ID = process.env.STUDENT_FOLDER_ID;

// Ensures the upload directory exists.
const uploadDir = path.join(__dirname, '..', 'uploads', 'teacher');
fsp.mkdir(uploadDir, { recursive: true }).catch(console.error);

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 100 * 1024 * 1024 },
});

// Cleans an object by setting undefined values to null.
function cleanUndefined(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  for (const key of Object.keys(obj)) {
    if (obj[key] === undefined) {
      obj[key] = null;
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      cleanUndefined(obj[key]);
    }
  }
  return obj;
}

// Retrieves the teacher's root folder ID from Firestore.
async function getTeacherFolderID(email) {
  try {
    const docRef = firestore.collection('teachers').doc(email);
    const doc = await docRef.get();
    if (!doc.exists) {
      throw new Error('Teacher not found in Firestore');
    }
    return doc.data().folderID;
  } catch (err) {
    console.error('Error getting teacher folder ID:', err);
    throw err;
  }
}

// Fetches files and subfolders by a given folder ID.
async function getFolderById(folderId, driveInstance = teacherDrive) { // Добавяме driveInstance параметър
  try {
    const res = await driveInstance.files.list({ // Използваме driveInstance
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'files(id,name,webViewLink,iconLink,modifiedTime,mimeType)',
      orderBy: 'modifiedTime desc',
    });
    return res.data.files || [];
  } catch (err) {
    console.error('Error fetching folder by ID:', err);
    throw err;
  }
}

async function getFolderMetadata(folderId, driveInstance = teacherDrive) { // Добавяме driveInstance параметър
  try {
    const res = await driveInstance.files.get({ // Използваме driveInstance
      fileId: folderId,
      fields: 'id, name, parents, webViewLink, iconLink, modifiedTime, mimeType', // Добавени полета
    });
    return res.data;
  } catch (err) {
    console.error('Error fetching folder metadata:', err);
    throw err;
  }
}

async function buildBreadcrumbs(folderId, defaultTeacherRootFolderId, driveInstance = teacherDrive) { // Добавяме driveInstance
    const breadcrumbs = [];
    let currentId = folderId;

    while (currentId) {
        const metadata = await getFolderMetadata(currentId, driveInstance); // Използваме driveInstance
        if (!metadata) break;

        breadcrumbs.unshift({ id: metadata.id, name: metadata.name });

        if (currentId === defaultTeacherRootFolderId) {
            break;
        }

        if (!metadata.parents || metadata.parents.length === 0 || metadata.parents[0] === currentId) {
            break;
        }
        currentId = metadata.parents[0];
    }
    return breadcrumbs;
}

router.get('/', (req, res) => {
    // If the teacher session exists, redirect to the dashboard
    if (req.session.teacher && req.session.teacher.email) {
        return res.redirect('/teacher/dashboard');
    }
    // Otherwise, redirect to the Google OAuth initiation URL
    res.redirect('/teacher/login');
});

// Renders the teacher dashboard.
router.get('/dashboard', requireTeacher, async (req, res) => {

console.log('GET /teacher/dashboard route hit (from teacher-route.js)!'); // <-- ДОБАВЕТЕ ТОВА
    console.log('Request URL:', req.originalUrl); // <-- ДОБАВЕТЕ ТОВА
    console.log('Query parameters:', req.query); // <-- ДОБАВЕТЕ ТОВА
    console.log('Folder ID from query:', req.query.folderId); // <-

  try {
    if (!req.session.teacher || !req.session.teacher.email) {
      return res.redirect('/teacher/login');
    }

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

    // --- Добавена логика за визуализация на ученически файлове ---
    let studentFiles = [];
    if (STUDENT_FOLDER_ID) {
        studentFiles = await getFolderById(STUDENT_FOLDER_ID, studentDrive); // Използваме studentDrive
    } else {
        console.warn('STUDENT_FOLDER_ID is not configured. Student files will not be displayed.');
    }
  
    const teacherRootFolderID = await getTeacherFolderID(email);
    const currentFolderId = req.query.folderId || teacherRootFolderID; // Текуща папка или основната

    const teacherMaterials = await getFolderById(currentFolderId, teacherDrive); // Взимаме файловете за учителя
    const teacherBreadcrumbs = await buildBreadcrumbs(currentFolderId, teacherRootFolderID, teacherDrive); // Изграждаме breadcrumbs

    res.render('teacher-dashboard', { // Увери се, че това е името на твоя EJS темплейт
      teacherEmail: email,
      teacherMaterials: teacherMaterials, // Подаваме файловете на учителя
      studentFiles: studentFiles, // Подаваме ученическите файлове
      currentDisplayFolderId: currentFolderId, // Корекция на името
      teacherMaterialFolderId: teacherRootFolderID, // Корекция на името
      breadcrumbs: teacherBreadcrumbs, // Подаваме breadcrumbs
      studentUploadFolderId: STUDENT_FOLDER_ID // Добавено
    });

  } catch (err) {
    console.error('Error loading teacher dashboard:', err);
    res.status(500).render('error', {
      message: 'Възникна грешка на сървъра.',
      error: process.env.NODE_ENV === 'development' ? err : {}
    });
  }
});

// ПРОМЯНА: Обединяване на съдържанието на папка и breadcrumbs в един API отговор
router.get('/api/folder/:folderID', requireTeacher, async (req, res) => {

  
    try {
        const folderID = req.params.folderID;
        const email = req.session.teacher.email;
        const teacherRootFolderID = await getTeacherFolderID(email); // Вземете ID на основната папка

        const files = await getFolderById(folderID, teacherDrive); // Подаване на teacherDrive
        // ПРОМЯНА: Подайте teacherRootFolderID на buildBreadcrumbs
        const breadcrumbs = await buildBreadcrumbs(folderID, teacherRootFolderID, teacherDrive); // Подаване на teacherDrive

        res.json({
            files: files,
            breadcrumbs: breadcrumbs
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error fetching folder content.' });
    }
});

// Renders the teacher dashboard, handling direct URL access to a folder.
router.get('/folder/:folderID', requireTeacher, async (req, res) => {

 console.log('GET /teacher/dashboard/folder/:folderID route hit (from teacher-route.js)!'); // <-- ДОБАВЕТЕ ТОВА
    console.log('Request URL:', req.originalUrl); // <-- ДОБАВЕТЕ ТОВА
    console.log('URL parameter folderID:', req.params.folderID); // <-- ДОБАВЕТ

  try {
    if (!req.session.teacher || !req.session.teacher.email) {
      return res.redirect('/teacher/login');
    }

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

    // --- Добавена логика за визуализация на ученически файлове (повторение) ---
    let studentFiles = [];
    if (STUDENT_FOLDER_ID) {
        studentFiles = await getFolderById(STUDENT_FOLDER_ID, studentDrive); // Използваме studentDrive
    } else {
        console.warn('STUDENT_FOLDER_ID is not configured. Student files will not be displayed.');
    }

    const teacherRootFolderID = await getTeacherFolderID(email);
    const currentFolderId = req.params.folderID; // Взимаме folderID от URL параметрите

    const teacherMaterials = await getFolderById(currentFolderId, teacherDrive);
    const teacherBreadcrumbs = await buildBreadcrumbs(currentFolderId, teacherRootFolderID, teacherDrive);

    res.render('teacher-dashboard', { // Увери се, че това е името на твоя EJS темплейт
      teacherEmail: email,
      teacherFiles: teacherMaterials,
      studentFiles: studentFiles, // Подаваме ученическите файлове
      currentDisplayFolderId: currentFolderId, // Корекция на името
      teacherMaterialFolderId: teacherRootFolderID, // Корекция на името
      teacherBreadcrumbs: teacherBreadcrumbs, // Подаваме breadcrumbs
      studentUploadFolderId: STUDENT_FOLDER_ID // Добавено
    });

  } catch (err) {
    console.error('Error loading teacher folder page:', err);
    res.status(500).render('error', {
      message: 'Възникна грешка на сървъра.',
      error: process.env.NODE_ENV === 'development' ? err : {}
    });
  }
});
 
// ПРОМЯНА: Връщане на folderID и breadcrumbs за root папката
router.get('/root-folder', requireTeacher, async (req, res) => {
    try {
        const email = req.query.email; 
        if (!email) {
            return res.status(400).json({ error: 'Missing email parameter' });
        }

        if (email !== req.session.teacher.email) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const folderID = await getTeacherFolderID(email);
        if (!folderID) {
            return res.status(404).json({ error: 'Folder ID not found' });
        }

        // ПРОМЯНА: Когато сме в root-folder, defaultTeacherRootFolderId е самият folderID
        const breadcrumbs = await buildBreadcrumbs(folderID, folderID, teacherDrive); // Подаване на teacherDrive

        res.json({ folderID, breadcrumbs });

    } catch (err) {
        console.error('Error getting root folder:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Initiates the OAuth login process for teachers.
router.get('/login', (req, res) => {
  const state = uuidv4();
  req.session.oauthState = state;

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    state: state,
  });

  res.redirect(authUrl);
});

// Handles the OAuth callback after successful authentication.
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

// Handles file uploads from teachers to Google Drive.
router.post('/upload', requireTeacher, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Изберете файл.' });

  try {
    const email = req.session.teacher.email;
    const refreshToken = await getRefreshToken(email);
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    // Вземаме нов access token
    const { token } = await oauth2Client.getAccessToken();
    oauth2Client.setCredentials({
      access_token: token,
      refresh_token: refreshToken,
    });

    let folderId = req.body.folderId;
    if (!folderId) {
      folderId = await getTeacherFolderID(email);
    }

    const fileName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');

    const fileMetadata = {
      name: fileName,
      parents: [folderId],
    };

    await teacherDrive.files.create({
      resource: fileMetadata,
      media: {
        mimeType: req.file.mimetype,
        body: fs.createReadStream(req.file.path),
      },
      fields: 'id',
    });

    await fsp.unlink(req.file.path);

    res.redirect('/teacher?folderId=' + folderId); // Пренасочваме към текущата папка
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Грешка при качване.' });
  }
});

// Handles the creation of new folders in Google Drive.
router.post('/create-folder', requireTeacher, async (req, res) => {
  try {
    const email = req.session.teacher.email;
    // Използваме req.body.currentFolderId за родителска папка, ако е подадена
    const parentId = req.body.currentFolderId || await getTeacherFolderID(email);
    const name = req.body.folderName;

    await teacherDrive.files.create({
      resource: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      },
      fields: 'id',
    });

    res.redirect('/teacher?folderId=' + parentId); // Пренасочваме към родителската папка
  } catch (err) {
    console.error('Folder creation error:', err);
    res.status(500).json({ error: 'Неуспешно създаване на папка.' });
  }
});

router.post('/delete-item', requireTeacher, async (req, res) => {
  console.log('BODY:', req.body);

  const fileId = req.body.fileId || req.body.itemId;
  if (!fileId) {
    return res.status(400).json({ error: 'Missing fileId' });
  }

  try {
    const email = req.session.teacher.email;
    const refreshToken = await getRefreshToken(email);
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    await teacherDrive.files.update({
      fileId,
      resource: { trashed: true }
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Delete item error:', err);
    res.status(500).json({ error: 'Грешка при изтриване на елемента.' });
  }
});

// Logs out the teacher by destroying the session.
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