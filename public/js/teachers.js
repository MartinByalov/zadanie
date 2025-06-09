// public/js/teachers.js

// ГЛОБАЛНИ ПРОМЕНЛИВИ
let defaultFolderId = null; // Основната папка за учебни материали на учителя
let currentFolderId = null; // Текущата папка за учебни материали, която се визуализира
let rightClickedItem = null;
let teacherEmail = null; // Имейлът на влезлия учител

// НОВИ ГЛОБАЛНИ ПРОМЕНЛИВИ ЗА СТУДЕНТСКИ ФАЙЛОВЕ
let studentUploadFolderId = null; // ID на папката за задания
let studentFiles = [];            // Масив с файлове, качени от ученици

function createFileCard(item, type = 'file') {
    const card = document.createElement('div');
    card.className = 'file-card';
    card.dataset.id = item.id;
    card.dataset.mime = item.mimeType;
    card.dataset.link = item.webViewLink || '';
    card.dataset.name = item.name;

    const iconClasses = {
        'application/pdf': 'fa-file-pdf',
        'application/msword': 'fa-file-word',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'fa-file-word',
        'application/vnd.ms-excel': 'fa-file-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'fa-file-excel',
        'application/vnd.ms-powerpoint': 'fa-file-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'fa-file-powerpoint',
        'image/jpeg': 'fa-file-image',
        'image/png': 'fa-file-image',
        'video/mp4': 'fa-file-video',
        'audio/mpeg': 'fa-file-audio',
        'application/zip': 'fa-file-archive',
        // добави още mime типове ако искаш
    };

    const cleanMimeType = item.mimeType ? item.mimeType.split(';')[0].trim() : '';
    const iconClass = iconClasses[cleanMimeType] || 'fa-file';

    const iconHTML = type === 'folder' ?
        '<i class="fa fa-folder"></i>' :
        `<i class="fa ${iconClass}"></i>`;

    const modifiedTime = item.modifiedTime ?
        `<div class="file-modified">${new Date(item.modifiedTime).toLocaleString()}</div>` :
        '';

    card.innerHTML = `
        <div class="file-icon">${iconHTML}</div>
        <div class="file-name">${item.name}</div>
        ${modifiedTime}`;

    card.addEventListener('click', (e) => {
        e.preventDefault();
        const mimeType = card.dataset.mime;
        const id = card.dataset.id;
        const link = card.dataset.link;

        if (mimeType === 'application/vnd.google-apps.folder') {
            loadFolder(id); // Зареждане на подпапка за учебни материали
        } else if (link) {
            window.open(link, '_blank');
        }
    });

    return card;
}

// Loads folder content from the API and updates the UI. (ЗА УЧЕБНИ МАТЕРИАЛИ)
async function loadFolder(folderId, replaceHistory = false) {
    const container = document.getElementById('teacherFilesContainer');
    if (!container) {
        console.error('teacherFilesContainer not found.');
        return;
    }
    container.innerHTML = `
        <div class="loading-indicator" style="text-align: center; padding: 20px;">
            <i class="fas fa-spinner fa-spin fa-2x"></i>
            <p>Зареждане на учебни материали...</p>
        </div>
    `;

    try {
        currentFolderId = folderId;

        const res = await fetch(`/teacher/api/folder/${folderId}`);
        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            if (errorData.redirectToRoot && defaultFolderId) {
                await loadFolder(defaultFolderId, true);
                return;
            }
            throw new Error(errorData.error || `Error ${res.status}`);
        }

        const data = await res.json();
        const allItems = Array.isArray(data.files) ? data.files : [];
        const folders = allItems.filter(item => item.mimeType === 'application/vnd.google-apps.folder');
        const files = allItems.filter(item => item.mimeType !== 'application/vnd.google-apps.folder');

        const breadcrumbs = Array.isArray(data.breadcrumbs) ? data.breadcrumbs : [];

        updateFilesAndFolders(files, folders);
        updateBreadcrumbs(breadcrumbs);

        if (!replaceHistory && window.history.state?.folderId !== folderId) {
            const newUrl = `/teacher/dashboard?folderId=${folderId}`; // Променете URL
            window.history.pushState({ folderId: folderId }, '', newUrl);
        } else if (replaceHistory) {
            const newUrl = `/teacher/dashboard?folderId=${folderId}`; // Променете URL
            window.history.replaceState({ folderId: folderId }, '', newUrl);
        }

    } catch (err) {
        console.error('Error loading teacher material folder:', err);
        showErrorMessage(err.message);
    }
}

// Displays an error message in the file container.
function showErrorMessage(msg) {
    const container = document.getElementById('teacherFilesContainer');
    if (!container) return; // Добавена проверка
    container.innerHTML = `
        <div class="error-message">
            <i class="fas fa-exclamation-triangle"></i>
            <p>${msg}</p>
            ${defaultFolderId ?
            `<button onclick="loadFolder(defaultFolderId)">Return to main folder</button>` :
            `<button onclick="location.reload()">Refresh page</button>`}
        </div>
    `;
}

// Updates the display with files and folders.
function updateFilesAndFolders(files, folders) {
    const container = document.getElementById('teacherFilesContainer');
    if (!container) return; // Добавена проверка
    container.innerHTML = '';

    if (folders.length === 0 && files.length === 0) {
        const emptyMessage = document.createElement('div');
        emptyMessage.className = 'empty-folder-message';
        emptyMessage.innerHTML = `
            <i class="fa fa-folder-open"></i>
            <p>Папката е празна.</p>
        `;
        container.appendChild(emptyMessage);
        return;
    }

    folders.forEach(folder => {
        const card = createFileCard(folder, 'folder');
        container.appendChild(card);
    });

    files.forEach(file => {
        const card = createFileCard(file, 'file');
        container.appendChild(card);
    });
}

// НОВА ФУНКЦИЯ: Зарежда и визуализира файловете, качени от ученици
function displayStudentFiles(files) {
    const container = document.getElementById('studentFilesContainer');
    if (!container) {
        console.error('studentFilesContainer not found.');
        return;
    }
    container.innerHTML = ''; // Изчистване на съдържанието

    if (!files || files.length === 0) {
        const emptyMessage = document.createElement('p');
        emptyMessage.textContent = 'Няма качени файлове от ученици.';
        container.appendChild(emptyMessage);
        return;
    }

    files.forEach(file => {
      
        const card = createFileCard(file, 'file');
        
        const existingClickListener = card.querySelector('.file-icon, .file-name'); // Или самия card
        if (existingClickListener) {
            existingClickListener.removeEventListener('click', card.clickListener); // Премахваме стария, ако има
        }
        card.addEventListener('click', (e) => {
            e.preventDefault();
            const link = card.dataset.link;
            if (link) {
                window.open(link, '_blank');
            }
        });
        
        container.appendChild(card);
    });
}

function initContextMenu() {
    const contextMenu = document.getElementById('contextMenu');
    const createFolderOption = document.getElementById('createFolderOption');
    const uploadFileOption = document.getElementById('uploadFileOption');
    const deleteOption = document.getElementById('deleteOption');
    const fileInput = document.getElementById('fileInput');
    const teacherFilesContainer = document.getElementById('teacherFilesContainer');

    teacherFilesContainer.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (e.target === teacherFilesContainer || e.target.closest('.file-card.back-button')) {
            deleteOption.classList.add('hidden');
            rightClickedItem = null;
        } else {
            deleteOption.classList.remove('hidden');
            rightClickedItem = e.target.closest('.file-card');
        }
        contextMenu.style.left = `${e.pageX}px`;
        contextMenu.style.top = `${e.pageY}px`;
        contextMenu.classList.remove('hidden');
    });

    document.addEventListener('click', () => {
        contextMenu.classList.add('hidden');
    });

    createFolderOption.addEventListener('click', async () => {
        const folderName = prompt('Въведете име на папката:');
        if (!folderName) return;

        try {
            const res = await fetch('/teacher/create-folder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    folderName,
                    folderId: currentFolderId || defaultFolderId
                })
            });

            if (res.ok) {
                await loadFolder(currentFolderId || defaultFolderId);
            } else {
                alert('Грешка при създаване на папка');
            }
        } catch (err) {
            console.error(err);
            alert('Грешка при създаване на папка');
        }
    });

    uploadFileOption.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async (e) => {
        if (!e.target.files.length) return;

        const formData = new FormData();
        formData.append('file', e.target.files[0]);
        formData.append('folderId', currentFolderId || defaultFolderId);

        try {
            const response = await fetch('/teacher/upload', {
                method: 'POST',
                body: formData
            });

            if (response.ok) {
                await loadFolder(currentFolderId || defaultFolderId);
            } else {
                alert('Грешка при качване на файл');
            }
        } catch (err) {
            console.error(err);
            alert('Грешка при качване на файл');
        } finally {
            fileInput.value = '';
        }
    });

    deleteOption.addEventListener('click', async () => {
        if (rightClickedItem) {
            const itemId = rightClickedItem.dataset.id;
            const itemName = rightClickedItem.dataset.name;
            const itemMimeType = rightClickedItem.dataset.mime;
            const itemType = itemMimeType === 'application/vnd.google-apps.folder' ? 'папката' : 'файла';

            if (confirm(`Сигурни ли сте, че искате да изтриете ${itemType} "${itemName}"?`)) {
                await deleteItem(itemId);
            }
        }
    });
}

async function deleteItem(itemId) {
    try {
        const res = await fetch('/teacher/delete-item', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ itemId })
        });

        if (res.ok) {
            await loadFolder(currentFolderId || defaultFolderId); // Рефрешваме учебните материали
           
        } else {
            alert('Грешка при изтриване на елемент.');
        }
    } catch (err) {
        console.error(err);
        alert('Грешка при изтриване на елемент.');
    }
}

function updateBreadcrumbs(path) {
    const container = document.getElementById('folderBreadcrumbs');
    if (!container) return;

    container.innerHTML = '';

    path.forEach((folder, index) => {
        if (index > 0) {
            container.appendChild(document.createTextNode(' / '));
        }

        const link = document.createElement('a');
        link.href = '#';
        link.textContent = (index === 0 && folder.id === defaultFolderId) ? 'Основна' : folder.name;
        link.addEventListener('click', (e) => {
            e.preventDefault();
            loadFolder(folder.id);
        });
        container.appendChild(link);
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    // Взимаме данните, предадени от сървъра
    const initialTeacherData = window.initialTeacherData;
    console.log('Initial Teacher Data (raw):', initialTeacherData); // Добавен log за суровите данни

    if (!initialTeacherData || !initialTeacherData.teacherEmail || !initialTeacherData.teacherMaterialFolderId) {
        console.error('Initial teacher data missing from server.');
        document.getElementById('teacherFilesContainer').innerHTML =
            '<p class="error">Няма налични данни за учителя. Моля, презаредете страницата или се свържете с администратор.</p>';
        return;
    }

    teacherEmail = initialTeacherData.teacherEmail;
    defaultFolderId = initialTeacherData.teacherMaterialFolderId;
    studentUploadFolderId = initialTeacherData.studentUploadFolderId; // Инициализираме ID на папката за задания

    const teacherMaterialsParsed = initialTeacherData.teacherMaterials ? JSON.parse(initialTeacherData.teacherMaterials) : [];
    const studentFilesParsed = initialTeacherData.studentFiles ? JSON.parse(initialTeacherData.studentFiles) : [];
    const breadcrumbsParsed = initialTeacherData.breadcrumbs ? JSON.parse(initialTeacherData.breadcrumbs) : [];

    studentFiles = studentFilesParsed;

    // Инициализираме context menu
    initContextMenu();

    // Обновяваме breadcrumbs за учебните материали с ПАРСНАТИТЕ данни
    updateBreadcrumbs(breadcrumbsParsed);

    // Установяваме текущата папка за визуализация (учебни материали)
    currentFolderId = initialTeacherData.currentDisplayFolderId || defaultFolderId;

    await loadFolder(currentFolderId, true);

    // НОВО: Визуализираме файловете от ученици с ПАРСНАТИТЕ данни
    displayStudentFiles(studentFilesParsed); // Използваме парснатата версия

    window.addEventListener('popstate', (event) => {
        if (event.state && event.state.folderId) {
            loadFolder(event.state.folderId, true);
        } else {
            loadFolder(defaultFolderId, true);
        }
    });
});