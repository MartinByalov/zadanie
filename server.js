const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 3000;

// Създаване на "uploads" ако не съществува
if (!fs.existsSync('./uploads')) {
  fs.mkdirSync('./uploads');
}

// Конфигурация на multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads'); // скрита папка
  },
  filename: function (req, file, cb) {
    const uniqueName = Date.now() + '-' + Math.random().toString(36).substring(7) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const upload = multer({ storage });

// Показва HTML формата за качване
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// Обработка на качванията
app.post('/upload', upload.single('file'), (req, res) => {
  res.send('Файлът беше качен успешно!');
});

// Статични файлове за учениците (само "public" папката)
app.use('/files', express.static('public'));

app.listen(port, () => {
  console.log(`Сървърът работи на http://localhost:${port}`);
});
