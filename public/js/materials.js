
  document.addEventListener('DOMContentLoaded', () => {
    fetch('/teacher-files')
      .then(res => res.json())
      .then(files => {
        const list = document.getElementById('materialsList');
        list.innerHTML = ''; // Изчистваме "Loading..."

        if (files.length === 0) {
          list.innerHTML = '<p>No materials available yet.</p>';
          return;
        }

        files.forEach(file => {
          const item = document.createElement('div');
          item.className = 'material-item';
          item.innerHTML = `
            <img src="${file.iconLink}" class="file-icon" alt="File icon">
            <a href="${file.webViewLink}" target="_blank">${file.name}</a>
            <span class="file-date">${new Date(file.modifiedTime).toLocaleString()}</span>
          `;
          list.appendChild(item);
        });
      })
      .catch(err => {
        console.error('Error loading materials:', err);
        document.getElementById('materialsList').innerHTML = '<p>Error loading materials.</p>';
      });
  });