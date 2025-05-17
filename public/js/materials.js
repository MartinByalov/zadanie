// public/js/materials.js

function loadMaterials({
  url = '/teacher-files',                     // бекенд endpoint
  teacherContainerId = 'materialsList',      // контейнер за учителските материали
  studentContainerId = null,                 // по избор, за ученическите материали
  autoRefreshInterval = 30000                // автоматично презареждане (ms)
} = {}) {
  async function fetchAndRender() {
    try {
      const res = await fetch(url);
      const data = await res.json();

      // Учителски файлове
      if (teacherContainerId && data.teacherFiles) {
        const teacherContainer = document.getElementById(teacherContainerId);
        teacherContainer.innerHTML = '';
        if (data.teacherFiles.length === 0) {
          teacherContainer.innerHTML = '<p>No teacher files available.</p>';
        } else {
          data.teacherFiles.forEach(file => {
            teacherContainer.appendChild(createFileCard(file));
          });
        }
      }

      // Ученически файлове
      if (studentContainerId && data.studentFiles) {
        const studentContainer = document.getElementById(studentContainerId);
        studentContainer.innerHTML = '';
        if (data.studentFiles.length === 0) {
          studentContainer.innerHTML = '<p>No student files available.</p>';
        } else {
          data.studentFiles.forEach(file => {
            studentContainer.appendChild(createFileCard(file));
          });
        }
      }

    } catch (err) {
      console.error('Error loading files:', err);
      if (teacherContainerId) {
        document.getElementById(teacherContainerId).innerHTML = '<p style="color:red;">Error loading teacher files.</p>';
      }
      if (studentContainerId) {
        document.getElementById(studentContainerId).innerHTML = '<p style="color:red;">Error loading student files.</p>';
      }
    }
  }

  function createFileCard(file) {
    const card = document.createElement('div');
    card.className = 'file-card';

    const icon = document.createElement('img');
    icon.src = file.iconLink;
    icon.alt = 'File icon';
    icon.className = 'file-icon';

    const name = document.createElement('a');
    name.href = file.webViewLink;
    name.target = '_blank';
    name.className = 'file-name';
    name.textContent = file.name;

    const date = document.createElement('div');
    date.className = 'file-date';
    date.textContent = new Date(file.modifiedTime).toLocaleString();

    card.appendChild(icon);
    card.appendChild(name);
    card.appendChild(date);

    return card;
  }

  // Стартиране веднага
  fetchAndRender();

  // Автоматично обновяване
  if (autoRefreshInterval > 0) {
    setInterval(fetchAndRender, autoRefreshInterval);
  }
}

// Вземи teacher email от URL параметър например
const urlParams = new URLSearchParams(window.location.search);
const teacherId = urlParams.get('teacher') || 'default@domain.com';

loadMaterials({
  url: `/teacher-files?teacher=${encodeURIComponent(teacherId)}`,
  teacherContainerId: 'teacherFilesContainer',
  studentContainerId: 'studentFilesContainer'
});
