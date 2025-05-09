const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Създаване на "uploads" ако не съществува
if (!fs.existsSync('./uploads')) {
  fs.mkdirSync('./uploads');
}

// Конфигурация на multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads'); // Задаване на директория за качване
  },
  filename: function (req, file, cb) {
    const uniqueName = Date.now() + '-' + Math.random().toString(36).substring(7) + path.extname(file.originalname);
    cb(null, uniqueName); // Генериране на уникално име за файла
  }
});

const upload = multer({ storage });
 


// Статични файлове от "public"
app.use(express.static(path.join(__dirname, 'public')));

// Начална страница
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Обработка на качен файл
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.redirect('/?success=0');
  }

  // Използваме meta refresh, който работи стабилно на Render и други платформи
  res.send(`
    <html>
      <head>
        <meta http-equiv="refresh" content="2; URL='/?success=1'" />
      </head>
      <body>
        <p>Файлът беше качен успешно. Пренасочване...</p>
      </body>
    </html>
  `);
});

// Стартиране
app.listen(port, () => {
  console.log(`Сървърът работи на http://localhost:${port}`);
});
