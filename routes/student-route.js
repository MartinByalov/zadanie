const express = require('express');
const path = require('path');
const multer = require('multer');
const { google } = require('googleapis');
const fs = require('fs');
const admin = require('firebase-admin');
require('dotenv').config();

const router = express.Router();

const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

if (!admin.apps.length) {
  initializeApp({ credential: applicationDefault() });
}
const db = getFirestore();

// Google Drive Auth
const SERVICE_ACCOUNT_PATH = path.join(__dirname, '..', 'service-account.json');
let studentAuth;
if (fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  studentAuth = new google.auth.GoogleAuth({
    keyFile: SERVICE_ACCOUNT_PATH,
    scopes: ['https://www.googleapis.com/auth/drive']
  });
} else {
  console.warn('Service account file not found. Student uploads will be disabled.');
}

// Multer
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = path.join(__dirname, '..', 'uploads', 'student');
      fs.mkdirSync(uploadDir, { recursive: true });
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      const ext = path.extname(originalName);
      const baseName = path.basename(originalName, ext);
      cb(null, `${baseName}-${uniqueSuffix}${ext}`);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// GET /
router.get('/', async (req, res) => {
  try {
    // Вземаме списъка с учители от колекцията "teachers", които са активни
    const teachersSnapshot = await db.collection('teachers')
      .where('active', '==', true)
      .get();

    const teachers = [];
    teachersSnapshot.forEach(doc => {
      teachers.push({ email: doc.id, ...doc.data() });
    });

    if (teachers.length === 0) {
      return res.send('<p>Няма добавени учители в системата.</p>');
    }

    const firstTeacher = teachers[0];
    const folderId = firstTeacher.folderID;

    const auth = await studentAuth.getClient();
    const drive = google.drive({ version: 'v3', auth });

    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'files(id, name, webViewLink, iconLink, modifiedTime)',
      orderBy: 'modifiedTime desc',
      pageSize: 10
    });

    const teacherFiles = response.data.files;

    res.send(`
      <!DOCTYPE html>
      <html lang="bg">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Student Assignment Upload</title>
        <link rel="stylesheet" href="/css/student.css" />
      </head>
      <body>
        <div class="container">
          <header>
            <h1>Student Assignment Upload</h1>
            <a href="/teacher" class="teacher-login">Teacher Login</a>
          </header>

          <div class="upload-section">
            <h2>Качи своето задание</h2>
            <form id="uploadForm" action="/upload" method="post" enctype="multipart/form-data">
              <input type="file" name="file" id="fileInput" required />
              <select id="teacherSelect" name="teacherEmail" required>
                ${teachers.map(t => `
                  <option value="${t.email}" data-name="${t.name}" ${t.email === firstTeacher.email ? 'selected' : ''}>
                    ${t.name} (${t.email})
                  </option>
                `).join('')}
              </select>
              <button type="submit" class="upload-btn">Качи</button>
            </form>
            <div id="uploadStatus"></div>
          </div>

          <div class="materials-section">
            <h2 id="teacherFilesTitle">Файлове от учител: ${firstTeacher.name}</h2>
            <div id="teacherCards" class="teacher-cards">
              ${
                teacherFiles.length > 0
                  ? teacherFiles.map(file => `
                    <div class="material-item">
                      <img src="${file.iconLink}" class="file-icon" alt="File icon" />
                      <a href="${file.webViewLink}" target="_blank">${file.name}</a>
                      <span class="file-date">${new Date(file.modifiedTime).toLocaleString()}</span>
                    </div>
                  `).join('')
                  : '<p>Няма налични материали.</p>'
              }
            </div>
          </div>
        </div>

        <script>
          const teacherSelect = document.getElementById('teacherSelect');
          const teacherCards = document.getElementById('teacherCards');
          const teacherFilesTitle = document.getElementById('teacherFilesTitle');

          teacherSelect.addEventListener('change', async () => {
            const email = teacherSelect.value;
            const name = teacherSelect.options[teacherSelect.selectedIndex].dataset.name;

            teacherFilesTitle.textContent = 'Файлове от учител: ' + name;
            teacherCards.innerHTML = '<p>Зареждане...</p>';

            try {
              const res = await fetch('/teacher-files?teacherEmail=' + encodeURIComponent(email));
              if (!res.ok) throw new Error('Грешка при зареждане на файловете');
              const files = await res.json();

              if (files.length === 0) {
                teacherCards.innerHTML = '<p>Няма налични материали.</p>';
                return;
              }

              teacherCards.innerHTML = files.map(function(file) {
                return (
                  '<div class="material-item">' +
                    '<img src="' + file.iconLink + '" class="file-icon" alt="File icon" />' +
                    '<a href="' + file.webViewLink + '" target="_blank">' + file.name + '</a>' +
                    '<span class="file-date">' + new Date(file.modifiedTime).toLocaleString() + '</span>' +
                  '</div>'
                );
              }).join('');

            } catch (err) {
              teacherCards.innerHTML = '<p>Грешка при зареждане на файловете.</p>';
              console.error(err);
            }
          });
        </script>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('Error rendering student page:', err);
    res.status(500).send('Грешка при зареждане на началната страница');
  }
});


// POST /upload
// Качване на файл в Google Drive
router.post('/upload', upload.single('file'), async (req, res) => {
  const teacherEmail = req.body.teacherEmail; // <-- fix от query към body
  if (!teacherEmail) {
    return res.status(400).send('Липсва учителски email');
  }

  if (!req.file) {
    return res.status(400).send('Моля, изберете файл за качване');
  }

  if (!studentAuth) {
    return res.status(503).send('Качването е временно недостъпно');
  }

  try {
    const docRef = db.collection('teachers').doc(teacherEmail);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).send('Учителят не е намерен');
    }

    const { folderID } = docSnap.data();

    const drive = google.drive({
      version: 'v3',
      auth: await studentAuth.getClient()
    });

    const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');

    const fileMetadata = {
      name: originalName,
      parents: [folderID]
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

    // ✅ Пренасочване обратно към началната страница
    res.redirect('/');

  } catch (error) {
    console.error('Грешка при качване:', error);
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).send('Грешка при качване на файла');
  }
});


// GET /teacher-files
router.get('/teacher-files', async (req, res) => {
  const email = req.query.teacherEmail;
  if (!email) return res.status(400).json({ error: 'Липсва email' });

  try {
    const snapshot = await db.collection('teachers')
      .where('email', '==', email)
      .limit(1)
      .get();

    if (snapshot.empty) return res.status(404).json({ error: 'Учителят не е намерен' });

    const { folderID } = snapshot.docs[0].data();
    const auth = await studentAuth.getClient();
    const drive = google.drive({ version: 'v3', auth });

    const response = await drive.files.list({
      q: `'${folderID}' in parents and trashed = false`,
      fields: 'files(id, name, webViewLink, iconLink, modifiedTime)',
      orderBy: 'modifiedTime desc',
      pageSize: 10
    });

    res.json(response.data.files);
  } catch (err) {
    console.error('Error fetching teacher files:', err);
    res.status(500).json({ error: 'Грешка при зареждане' });
  }
});

module.exports = router;
