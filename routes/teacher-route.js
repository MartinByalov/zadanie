const admin = require('firebase-admin');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

if (!admin.apps.length) {
  initializeApp({ credential: applicationDefault() });
}

const db = getFirestore();
console.log('Firestore initialized:', db ? 'OK' : 'NO');


const express = require('express');
const path = require('path');
const multer = require('multer');
const { google } = require('googleapis');
const fs = require('fs');
const requireTeacher = require('../middleware/requireTeacher');
const { studentDrive } = require('../config/googleAuth'); // Добавих firestore
const ALLOWED_TEACHERS = process.env.ALLOWED_TEACHERS.split(',');
const { saveRefreshToken, getRefreshToken } = require('../services/token-service');


/*
const json = fs.readFileSync('service-account.json', 'utf8');
const oneLineJson = JSON.stringify(JSON.parse(json));

console.log(oneLineJson);
*/

const router = express.Router();

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const scopes = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/drive.file'
];

const STUDENT_FOLDER_ID = process.env.STUDENT_FOLDER_ID;

// Configure uploads directory
const uploadDir = path.join(__dirname, '..', 'uploads', 'teacher');
const ensureUploadsDir = () => {
  try {
    fs.mkdirSync(uploadDir, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
};
ensureUploadsDir();

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// Helper функция за вземане на folderID на учителя от Firestore
async function getTeacherFolderID(email) {

 console.log('getTeacherFolderID called with email:', email);
  console.log('db:', db);

  const docRef = db.collection('teachers').doc(email);
  const docSnap = await docRef.get();

  if (!docSnap.exists) {
    throw new Error('Teacher not found');
  }

  return docSnap.data().folderID;
}

router.get('/', requireTeacher, async (req, res) => {
  try {
    const email = req.session.teacher.email;

    // Вземи refresh token от Firestore по email
    const refreshToken = await getRefreshToken(email);

    if (refreshToken) {
      oauth2Client.setCredentials({
        refresh_token: refreshToken,
        access_token: req.session.teacher.tokens.access_token,
        scope: req.session.teacher.tokens.scope,
        token_type: req.session.teacher.tokens.token_type,
        expiry_date: req.session.teacher.tokens.expiry_date
      });
    } else {
      oauth2Client.setCredentials(req.session.teacher.tokens);
    }

    // Вземи папката на учителя от Firestore
    const TEACHER_FOLDER_ID = await getTeacherFolderID(email);

    const drive = google.drive({
      version: 'v3',
      auth: oauth2Client,
      params: { supportsAllDrives: true, includeItemsFromAllDrives: true }
    });

    // Вземи файловете на учителя
    const teacherFiles = await drive.files.list({
      q: `'${TEACHER_FOLDER_ID}' in parents and trashed = false`,
      fields: 'files(id,name,webViewLink,iconLink,modifiedTime)',
      orderBy: 'modifiedTime desc',
      pageSize: 10
    });

    // Вземи студентските файлове чрез service account
    let studentFiles = [];
    try {
      const response = await studentDrive.files.list({
        q: `'${STUDENT_FOLDER_ID}' in parents and trashed = false`,
        fields: 'files(id,name,webViewLink,iconLink,modifiedTime)',
        orderBy: 'modifiedTime desc',
        pageSize: 10
      });
      studentFiles = response.data.files;
    } catch (err) {
      console.error('Error fetching student files:', err.message);
    }

    // Рендериране на дашборда (без промени)
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Teacher Dashboard</title>
  <link rel="stylesheet" href="/css/teacher.css">
  <link rel="icon" href="/favicon.ico" type="image/x-icon">
  <style>
    body { font-family: Arial, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; }
    .header { display: flex; justify-content: space-between; align-items: center; }
    .file-list { margin-top: 20px; }
    .file-item { padding: 10px; border-bottom: 1px solid #ddd; display: flex; align-items: center; }
    .file-icon { width: 20px; height: 20px; margin-right: 10px; }
    .file-date { margin-left: auto; font-size: 0.85em; color: #666; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Teacher Dashboard</h1>
    <a href="/teacher/logout">Logout</a>
  </div>

  <h2>Upload New Teaching Material</h2>
  <form action="/teacher/upload" method="post" enctype="multipart/form-data">
    <input type="file" name="file" required>
    <button type="submit">Upload</button>
  </form>

  <div>
  <h2>Teacher Files</h2>
  ${teacherFiles.data.files.length
      ? `<div class="file-grid">` + teacherFiles.data.files.map(file => `
          <div class="file-card">
            <img src="${file.iconLink}" alt="icon" class="file-icon" />
            <a href="${file.webViewLink}" target="_blank" class="file-name">${file.name}</a>
            <div class="file-date">${new Date(file.modifiedTime).toLocaleString()}</div>
          </div>
        `).join('') + `</div>`
      : '<p>No teacher files found.</p>'
    }
</div>

<div>
  <h2>Student Files</h2>
  ${studentFiles.length
      ? `<div class="file-grid">` + studentFiles.map(file => `
          <div class="file-card">
            <img src="${file.iconLink}" alt="icon" class="file-icon" />
            <a href="${file.webViewLink}" target="_blank" class="file-name">${file.name}</a>
            <div class="file-date">${new Date(file.modifiedTime).toLocaleString()}</div>
          </div>
        `).join('') + `</div>`
      : '<p>No student files found.</p>'
    }
</div>

</body>
</html>
    `);

  } catch (err) {
    console.error('Failed to load teacher dashboard:', err);
    res.status(500).send('Server error');
  }
});

// Login Initiation (без промяна)
router.get('/login', (req, res) => {
  req.session.redirectTo = req.query.redirectTo || '/teacher';
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes
  });
  res.redirect(authUrl);
});

// OAuth Callback (без промяна)
router.get('/oauth2callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    console.error('OAuth error:', error);
    return res.redirect('/teacher/login?error=auth_failed');
  }

  if (!code) {
    return res.status(400).send('Missing authentication code');
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userinfo = await oauth2.userinfo.get();

    const email = userinfo.data.email;

    if (!email || !ALLOWED_TEACHERS.includes(email)) {
      console.warn('Unauthorized login attempt:', email);
      return res.status(403).send('Access denied');
    }

    // Запази refresh token-а във Firestore по email
    if (tokens.refresh_token) {
      await saveRefreshToken(email, tokens.refresh_token);
    }

    req.session.teacher = {
      email: email,
      name: userinfo.data.name,
      picture: userinfo.data.picture,
      tokens: tokens
    };

    req.session.save(err => {
      if (err) {
        console.error('Session save error:', err);
        return res.status(500).send('Session error');
      }
      const redirectTo = req.session.redirectTo || '/teacher';
      delete req.session.redirectTo;
      res.redirect(redirectTo);
    });

  } catch (error) {
    console.error('OAuth callback error:', error);
    res.redirect('/teacher/login?error=auth_failed');
  }
});

// File Upload to Google Drive - редакция за папката от Firestore
router.post('/upload', requireTeacher, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('Please select a file');
  }

  try {
    const email = req.session.teacher.email;

    // Вземи папката на учителя от Firestore
    const TEACHER_FOLDER_ID = await getTeacherFolderID(email);

    oauth2Client.setCredentials(req.session.teacher.tokens);
    const drive = google.drive({
      version: 'v3',
      auth: oauth2Client,
      params: { supportsAllDrives: true, includeItemsFromAllDrives: true }
    });

    const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');

    const fileMetadata = {
      name: originalName,
      parents: [TEACHER_FOLDER_ID]
    };

    const media = {
      mimeType: req.file.mimetype,
      body: fs.createReadStream(req.file.path)
    };

    await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id,name,webViewLink',
      supportsAllDrives: true
    });

    fs.unlinkSync(req.file.path);

    res.redirect('/teacher');

  } catch (error) {
    console.error('Upload error:', error);

    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).send('Upload failed: ' + error.message);
  }
});

// User Info (без промяна)
router.get('/user', requireTeacher, (req, res) => {
  res.json({ user: req.session.teacher });
});

// Logout (без промяна)
router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

module.exports = router;
