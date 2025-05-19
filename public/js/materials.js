// public/js/materials.js

// Функция за зареждане на файлове и рендиране в HTML
function loadMaterials({
  url = '/teacher-files',                     // бекенд endpoint
  teacherContainerId = 'teacherCards',       // контейнер за учителските материали (съвпада с index.html)
  teacherFilesTitleId = 'teacherFilesTitle', // заглавие с името на учителя
  teacherSelectId = 'teacherSelect',         // селектор за учители
  autoRefreshInterval = 30000                 // автоматично презареждане (ms)
} = {}) {

  const teacherContainer = document.getElementById(teacherContainerId);
  const teacherFilesTitle = document.getElementById(teacherFilesTitleId);
  const teacherSelect = document.getElementById(teacherSelectId);

  // Зареждане и рендиране на файловете за даден учител (email)
  async function fetchAndRender(teacherEmail, teacherName) {
    if (!teacherEmail) return;

    teacherFilesTitle.textContent = 'Файлове от учител: ' + teacherName;
    teacherContainer.innerHTML = '<p>Зареждане...</p>';

    try {
      const res = await fetch(`/teacher-files?teacherEmail=${encodeURIComponent(teacherEmail)}`);
      if (!res.ok) throw new Error('Грешка при зареждане на файловете');

      const files = await res.json();

      if (files.length === 0) {
        teacherContainer.innerHTML = '<p>Няма налични материали.</p>';
      } else {
        teacherContainer.innerHTML = '';
        files.forEach(file => {
          teacherContainer.appendChild(createFileCard(file));
        });
      }
    } catch (err) {
      teacherContainer.innerHTML = '<p style="color:red;">Грешка при зареждане на файловете.</p>';
      console.error(err);
    }
  }

  // Създава карта за един файл с икона според типа
  function createFileCard(file) {
    const card = document.createElement('div');
    card.className = 'material-item';

    const icon = document.createElement('img');
    icon.className = 'file-icon';
    icon.src = file.iconLink || '/images/default-file-icon.png';
    icon.alt = 'icon';

    const link = document.createElement('a');
    link.href = file.webViewLink;
    link.target = '_blank';
    link.textContent = file.name;

    const date = document.createElement('time');
    date.className = 'file-date';
    date.textContent = new Date(file.modifiedTime).toLocaleString();

    card.appendChild(icon);
    card.appendChild(link);
    card.appendChild(date);

    return card;
  }

  // При смяна на избора на учител
  if (teacherSelect) {
    teacherSelect.addEventListener('change', () => {
      const selectedOption = teacherSelect.options[teacherSelect.selectedIndex];
      const email = teacherSelect.value;
      const name = selectedOption.dataset.name || email;
      fetchAndRender(email, name);
    });

    // Зареждаме файловете за първия по подразбиране при стартиране
    const firstOption = teacherSelect.options[teacherSelect.selectedIndex];
    if (firstOption) {
      fetchAndRender(firstOption.value, firstOption.dataset.name || firstOption.value);
    }
  }

  // Автоматично обновяване, ако е зададено
  if (autoRefreshInterval > 0) {
    setInterval(() => {
      if (teacherSelect) {
        const selectedOption = teacherSelect.options[teacherSelect.selectedIndex];
        fetchAndRender(selectedOption.value, selectedOption.dataset.name || selectedOption.value);
      }
    }, autoRefreshInterval);
  }
}

// Инициализация на функционалността за качване с drag & drop и form
function initFileUpload({
  dropZoneId = 'dropZone',
  fileInputId = 'fileInput',
  uploadFormId = 'uploadForm',
  uploadStatusId = 'uploadStatus'
} = {}) {

  const dropZone = document.getElementById(dropZoneId);
  const fileInput = document.getElementById(fileInputId);
  const uploadForm = document.getElementById(uploadFormId);
  const uploadStatus = document.getElementById(uploadStatusId);

  if (!dropZone || !fileInput || !uploadForm || !uploadStatus) return;

  dropZone.addEventListener('click', () => fileInput.click());

  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
  });

  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');

    if (e.dataTransfer.files.length > 0) {
      fileInput.files = e.dataTransfer.files;
      uploadFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      uploadFile(fileInput.files[0]);
    }
  });

  async function uploadFile(file) {
    uploadStatus.textContent = 'Качване...';

    const formData = new FormData(uploadForm);
    formData.set('file', file);

    try {
      const response = await fetch(uploadForm.action, {
        method: 'POST',
        body: formData
      });

      if (response.ok) {
        uploadStatus.textContent = `Файл "${file.name}" беше качен успешно!`;
        fileInput.value = '';  // изчистваме избора
      } else {
        const errorText = await response.text();
        uploadStatus.textContent = `Грешка при качване: ${errorText}`;
      }
    } catch (err) {
      uploadStatus.textContent = `Грешка при качване: ${err.message}`;
    }
  }
}

// Изпълнение след зареждане на DOM
document.addEventListener('DOMContentLoaded', () => {
  loadMaterials({
    teacherContainerId: 'teacherCards',
    teacherFilesTitleId: 'teacherFilesTitle',
    teacherSelectId: 'teacherSelect',
    autoRefreshInterval: 30000
  });

  initFileUpload({
    dropZoneId: 'dropZone',
    fileInputId: 'fileInput',
    uploadFormId: 'uploadForm',
    uploadStatusId: 'uploadStatus'
  });
});

const fileInput = document.getElementById('fileInput');
const fileNameDiv = document.getElementById('fileName');

fileInput.addEventListener('change', () => {
  if (fileInput.files.length > 0) {
    fileNameDiv.textContent = fileInput.files[0].name;
  } else {
    fileNameDiv.textContent = '';
  }
});

export { loadMaterials, initFileUpload };
