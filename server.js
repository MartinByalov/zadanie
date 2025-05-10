require('dotenv').config();

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const OAuth2 = google.auth.OAuth2;

const app = express();
const port = process.env.PORT || 3000;

// Създаване на "uploads" ако не съществува
if (!fs.existsSync('./uploads')) {
  fs.mkdirSync('./uploads');
}

// Конфигурация на multer за качване на файлове
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads');
  },
  filename: function (req, file, cb) {
    const uniqueName = Date.now() + '-' + Math.random().toString(36).substring(7) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const upload = multer({ storage });

// Google OAuth2 клиент
const oauth2Client = new OAuth2(
  process.env.GOOGLE_CLIENT_ID,    // Четене от .env файла
  process.env.GOOGLE_CLIENT_SECRET, // Четене от .env файла
  process.env.GOOGLE_REDIRECT_URI  // Задължително за получаване на refresh_token
);

// Google Drive API
const SCOPES = ['https://www.googleapis.com/auth/drive.file']; // Достъп до файловете в Google Drive
const DRIVE = google.drive({ version: 'v3', auth: oauth2Client });

// Получаване на URL за аутентикация
app.get('/auth', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });
  res.redirect(url);
});

// Обработка на аутентикационния код и записване на refresh токен
app.get('/oauth2callback', async (req, res) => {
  const { code } = req.query;

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Записване на refresh_token, ако го има
    if (tokens.refresh_token) {
      console.log('Refresh Token:', tokens.refresh_token);
      
      // Проверяваме дали файлът refresh_token.txt съществува
      const filePath = path.join(__dirname, 'refresh_token.txt');
      if (!fs.existsSync(filePath)) {
        // Ако не съществува, създаваме го
        fs.writeFileSync(filePath, tokens.refresh_token);
        console.log('Записахме refresh token в refresh_token.txt');
      }
    }

    res.send('Аутентикацията беше успешна! Можете да качвате файлове.');
  } catch (err) {
    console.error('Error while trying to retrieve access token', err);
    res.status(500).send('Неуспешна аутентикация');
  }
});

// Статични файлове от "public"
app.use(express.static(path.join(__dirname, 'public')));

// Начална страница
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Обработка на качване на файл в Google Drive
app.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.redirect('/?success=0');
  }

  const filePath = path.join(__dirname, 'uploads', req.file.filename);
  const fileMetadata = {
    name: req.file.originalname,
    mimeType: req.file.mimetype
  };
  const media = {
    mimeType: req.file.mimetype,
    body: fs.createReadStream(filePath)
  };

  try {
    // Проверка и обновяване на access token, ако е необходимо
    await refreshAccessToken();

    const file = await DRIVE.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id',
    });

    console.log('File uploaded to Google Drive with ID:', file.data.id);

    // Изтриване на файла след успешното качване
    fs.unlinkSync(filePath);

    // Пренасочване след успешното качване
    res.redirect('/?success=1');
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).send('Неуспешно качване на файл в Google Drive: ' + error.message);
  }
});

// Обработка на refresh token (при рестартиране на сървъра или при изтичане на токен)
async function refreshAccessToken() {
  const filePath = path.join(__dirname, 'refresh_token.txt');

  if (fs.existsSync(filePath)) {
    const refreshToken = fs.readFileSync(filePath, 'utf-8');

    if (refreshToken) {
      oauth2Client.setCredentials({
        refresh_token: refreshToken
      });

      try {
        const newTokens = await oauth2Client.getAccessToken();
        oauth2Client.setCredentials({
          access_token: newTokens.token
        });
        console.log('New Access Token:', newTokens.token);
      } catch (error) {
        console.error('Error refreshing access token:', error);
      }
    }
  } else {
    console.error('No refresh token found!');
  }
}

// Периодично обновяване на токен (ако има записан refresh token)
setInterval(refreshAccessToken, 3600 * 1000); // Обновяване на токена на всеки 1 час

// Стартиране на сървъра
app.listen(port, () => {
  console.log(`Сървърът работи на http://localhost:${port}`);
});
 