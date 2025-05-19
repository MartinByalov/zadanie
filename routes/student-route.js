const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { google } = require('googleapis');

// Импорт на конфигурациите от googleAuth
const { firestore, studentDrive } = require('../config/googleAuth');
const router = express.Router();

// Конфигурационни константи
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'student');

// Настройка на multer за качване на файлове
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
      const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      const ext = path.extname(originalName);
      const baseName = path.basename(originalName, ext);
      cb(null, `${baseName}-${uniqueSuffix}${ext}`);
    }
  }),
  limits: { fileSize: MAX_FILE_SIZE }
});

// GET начална страница - рендерира с EJS
router.get('/', async (req, res) => {
  try {
    // Взимаме активните учители
    const teachersSnapshot = await firestore.collection('teachers')
      .where('active', '==', true)
      .get();

    if (teachersSnapshot.empty) {
      return res.send('<p>Няма добавени учители в системата.</p>');
    }

    const teachers = teachersSnapshot.docs.map(doc => ({
      email: doc.id,
      ...doc.data()
    }));

    // Показваме файловете на първия учител по подразбиране
    const firstTeacher = teachers[0];
    let teacherFiles = [];

    if (studentDrive) {
      const response = await studentDrive.files.list({
        q: `'${firstTeacher.folderID}' in parents and trashed = false`,
        fields: 'files(id, name, webViewLink, iconLink, modifiedTime)',
        orderBy: 'modifiedTime desc',
        pageSize: 10
      });
      teacherFiles = response.data.files;
    }

    res.render('student', { teachers, selectedTeacher: firstTeacher, teacherFiles });

  } catch (error) {
    console.error('Грешка при зареждане на началната страница:', error);
    res.status(500).send('Възникна грешка при зареждането на началната страница');
  }
});

// POST за качване на файл
router.post('/upload', upload.single('file'), async (req, res) => {
  const { teacherEmail } = req.body;

  if (!teacherEmail) {
    return res.status(400).send('Липсва учителски email');
  }

  if (!req.file) {
    return res.status(400).send('Моля, изберете файл за качване');
  }

  if (!studentDrive) {
    return res.status(503).send('Качването е временно недостъпно');
  }

  try {
    const docRef = firestore.collection('students').doc(teacherEmail);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).send('Папка за заданията не е намерена за този учител');
    }

    const { folderID } = docSnap.data();
    const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');

    await studentDrive.files.create({
      resource: {
        name: originalName,
        parents: [folderID]
      },
      media: {
        mimeType: req.file.mimetype,
        body: fs.createReadStream(req.file.path)
      },
      fields: 'id,name,webViewLink',
      supportsAllDrives: true
    });

    // Изтриваме локалния файл след успешен ъплоуд
    fs.unlinkSync(req.file.path);

    // Пренасочваме обратно към началната страница
    res.redirect('/');
  } catch (error) {
    console.error('Грешка при качване:', error);

    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).send('Грешка при качване на файла');
  }
});

// AJAX за файловете на избран учител
router.get('/teacher-files', async (req, res) => {
  const { teacherEmail } = req.query;

  if (!teacherEmail) {
    return res.status(400).json({ error: 'Липсва email' });
  }

  try {
    const docRef = firestore.collection('teachers').doc(teacherEmail);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({ error: 'Учителят не е намерен' });
    }

    const { folderID } = docSnap.data();
    const response = await studentDrive.files.list({
      q: `'${folderID}' in parents and trashed = false`,
      fields: 'files(id, name, webViewLink, iconLink, modifiedTime)',
      orderBy: 'modifiedTime desc',
      pageSize: 10
    });

    res.json(response.data.files);
  } catch (error) {
    console.error('Грешка при зареждане на файловете:', error);
    res.status(500).json({ error: 'Грешка при зареждане на файловете' });
  }
});

module.exports = router;
