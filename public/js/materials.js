// public/js/materials.js

let displayFolderId = null;
let uploadTargetFolderId = null;
let currentTeacherEmail = null;
let defaultTeacherMaterialFolderId = null;

function updateHiddenUploadInputs() {
    const hiddenTeacherEmailInput = document.getElementById('hiddenTeacherEmail');
    const hiddenUploadFolderIdInput = document.getElementById('hiddenUploadFolderId');

    if (hiddenTeacherEmailInput) {
        hiddenTeacherEmailInput.value = currentTeacherEmail;
    }
    if (hiddenUploadFolderIdInput) {
        hiddenUploadFolderIdInput.value = uploadTargetFolderId;
    }
    console.log(`Hidden inputs updated: teacherEmail=${currentTeacherEmail}, uploadFolderId=${uploadTargetFolderId}`);
}

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
        // Add more mime types here as needed
    };

    const cleanMime = item.mimeType ? item.mimeType.split(';')[0].trim() : '';
    const iconClass = iconClasses[cleanMime] || 'fa-file';
    const iconHTML = type === 'folder' ? '<i class="fa fa-folder"></i>' : `<i class="fa ${iconClass}"></i>`;

    card.innerHTML = `
        <div class="file-icon">${iconHTML}</div>
        <div class="file-name">${item.name}</div>
        ${item.modifiedTime ? `<div class="file-modified">${new Date(item.modifiedTime).toLocaleString()}</div>` : ''}
    `;

    card.addEventListener('click', (e) => {
        e.preventDefault();
        const mimeType = card.dataset.mime;
        const id = card.dataset.id;
        const link = card.dataset.link;

        if (mimeType === 'application/vnd.google-apps.folder') {
            loadFolder(id);
        } else if (link) {
            window.open(link, '_blank');
        }
    });

    return card;
}

function updateFilesAndFolders(files, folders) {
    // Използваме 'teacherFilesContainer' според предоставения HTML
    const container = document.getElementById('teacherFilesContainer');
    if (!container) {
        console.error('teacherFilesContainer not found.');
        return;
    }
    container.innerHTML = ''; // Clear the loading indicator

    if (folders.length === 0 && files.length === 0) {
        const msg = document.createElement('div');
        msg.className = 'empty-folder-message';
        msg.innerHTML = `<i class="fa fa-folder-open"></i><p>Папката е празна.</p>`;
        container.appendChild(msg);
        return;
    }

    folders.forEach(folder => container.appendChild(createFileCard(folder, 'folder')));
    files.forEach(file => container.appendChild(createFileCard(file, 'file')));
}

function showErrorMessage(msg) {
    // Използваме 'teacherFilesContainer' според предоставения HTML
    const container = document.getElementById('teacherFilesContainer');
    if (!container) {
        console.error('teacherFilesContainer not found to display error.');
        return;
    }
    container.innerHTML = `
        <div class="error-message">
            <i class="fas fa-exclamation-triangle"></i>
            <p>${msg}</p>
            <button onclick="loadFolder(defaultTeacherMaterialFolderId, true)">Върни се в основна папка</button>
        </div>
    `;
}

function updateBreadcrumbs(path) {
    const container = document.getElementById('folderBreadcrumbs');
    if (!container) return;

    container.innerHTML = '';

    path.forEach((folder, index) => {
        if (index > 0) container.appendChild(document.createTextNode('/ '));

        const link = document.createElement('a');
        link.href = '#';
        link.textContent = (index === 0 && folder.id === defaultTeacherMaterialFolderId) ? 'Основна' : folder.name;
        link.addEventListener('click', e => {
            e.preventDefault();
            loadFolder(folder.id);
        });

        container.appendChild(link);
    });
}

async function loadFolder(folderIdToDisplay, replaceHistory = false) {
    // Използваме 'teacherFilesContainer' според предоставения HTML
    const container = document.getElementById('teacherFilesContainer');
    if (!container) {
        console.error('teacherFilesContainer not found for loading.');
        return;
    }
    container.innerHTML = `
        <div class="loading-indicator" style="text-align: center; padding: 20px;">
            <i class="fas fa-spinner fa-spin fa-2x"></i>
            <p>Зареждане на материали...</p>
        </div>
    `;

    try {
        displayFolderId = folderIdToDisplay;
        // updateHiddenUploadInputs() се вика при инициализация и смяна на учител,
        // така че тук не е необходимо.

        console.log('Attempting to load folder for display:', folderIdToDisplay, 'for teacher:', currentTeacherEmail);

        const res = await fetch(`/api/folder/${folderIdToDisplay}?teacherEmail=${encodeURIComponent(currentTeacherEmail)}`);
        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`Failed to load folder: ${res.status} ${res.statusText} - ${errorText}`);
        }

        const data = await res.json();
        const allItems = Array.isArray(data.files) ? data.files : [];
        const folders = allItems.filter(i => i.mimeType === 'application/vnd.google-apps.folder');
        const files = allItems.filter(i => i.mimeType !== 'application/vnd.google-apps.folder');
        const breadcrumbs = Array.isArray(data.breadcrumbs) ? data.breadcrumbs : [];

        updateFilesAndFolders(files, folders);
        updateBreadcrumbs(breadcrumbs);

        const newUrl = `/?teacherEmail=${encodeURIComponent(currentTeacherEmail)}&folderId=${folderIdToDisplay}`;
        if (replaceHistory) {
            window.history.replaceState({ teacherEmail: currentTeacherEmail, folderId: folderIdToDisplay }, '', newUrl);
        } else if (window.history.state?.folderId !== folderIdToDisplay || window.history.state?.teacherEmail !== currentTeacherEmail) {
            window.history.pushState({ teacherEmail: currentTeacherEmail, folderId: folderIdToDisplay }, '', newUrl);
        }
    } catch (err) {
        console.error('Error loading folder:', err);
        showErrorMessage(`Грешка при зареждане на материали: ${err.message}`);
    }
}

// Handles getting file name for upload form and submitting the form
function handleFileInputChange() {
    const fileInput = document.getElementById('entry_value');
    const fileNameDisplay = document.getElementById('fileName');
    const uploadForm = document.getElementById('uploadForm');

    if (fileInput && fileNameDisplay && uploadForm) {
        if (fileInput.files.length > 0) {
            fileNameDisplay.textContent = fileInput.files[0].name;

            updateHiddenUploadInputs();
            uploadForm.submit(); // Изпращаме формата
            console.log('File selected and form submitted.');

            const uploadSection = document.querySelector('.upload-section');
            if (uploadSection) {
                // Визуален индикатор за качване
                uploadSection.innerHTML = `
                    <div class="loading-indicator" style="text-align: center; padding: 20px;">
                        <i class="fas fa-spinner fa-spin fa-2x"></i>
                        <p>Качване на заданието...</p>
                        <p>Моля, изчакайте, страницата ще се презареди автоматично.</p>
                    </div>
                `;
            }

        } else {
            fileNameDisplay.textContent = 'Няма избран файл.';
        }
    } else {
        console.error('Missing elements for file input change handling (fileInput, fileNameDisplay, or uploadForm).');
    }
}

// --- Функции за Drag and Drop ---
function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
    console.log(`Event: ${e.type} prevented at target ${e.currentTarget.id || e.currentTarget.tagName}`);
}

function highlightDropArea(e) {
    // ПРОМЯНА: Манипулирайте директно елемента, върху който е станало събитието (e.currentTarget)
    // или се уверете, че е uploadForm
    const dropArea = document.getElementById('uploadForm'); // Или e.currentTarget ако винаги ще е това
    if (dropArea) {
        dropArea.classList.add('highlight-drop-area');
        console.log('Highlighting drop area.');
    }
}

function unhighlightDropArea(e) {
    // ПРОМЯНА: Манипулирайте директно елемента, върху който е станало събитието (e.currentTarget)
    // или се уверете, че е uploadForm
    const dropArea = document.getElementById('uploadForm'); // Или e.currentTarget ако винаги ще е това
    if (dropArea) {
        dropArea.classList.remove('highlight-drop-area');
        console.log('Unhighlighting drop area.');
    }
}

async function handleDrop(e) {
    console.log('--- handleDrop fired! ---');
    preventDefaults(e); // Уверете се, че се извиква ТУК!
    unhighlightDropArea(e); // Винаги премахвайте хайлайта при пускане

    const dt = e.dataTransfer;
    console.log('DataTransfer object:', dt);

    if (!dt || !dt.files || dt.files.length === 0) {
        console.warn("No files found in dataTransfer.files.");
        return;
    }

    const files = dt.files;
    console.log('Files dropped:', files);
    console.log('First file dropped:', files[0]);

    const fileInput = document.getElementById('entry_value');
    if (fileInput) {
        try {
            fileInput.files = files; // Опитваме директно присвояване
            console.log('Files successfully assigned directly to file input.');
        } catch (error) {
            console.error("Direct assignment to fileInput.files failed:", error);
            console.log("Attempting assignment via DataTransfer API.");
            const dataTransfer = new DataTransfer();
            for (let i = 0; i < files.length; i++) {
                dataTransfer.items.add(files[i]);
            }
            fileInput.files = dataTransfer.files;
            console.log('Files assigned via DataTransfer API.');
        }

        const changeEvent = new Event('change', { bubbles: true });
        console.log('Dispatching change event on file input...');
        fileInput.dispatchEvent(changeEvent);

    } else {
        console.error('File input element (entry_value) not found for drag-and-drop. Cannot assign file.');
        alert('Не може да се качи файл чрез влачене и пускане. Липсва елемент за качване.');
    }
    console.log('--- handleDrop finished. ---');
}

document.addEventListener('DOMContentLoaded', async () => {
    const teacherSelect = document.getElementById('teacherSelect');
    const teacherFilesTitle = document.getElementById('teacherFilesTitle');

    const fileInput = document.getElementById('entry_value');
    // ПРОМЯНА: Вече НЕ използваме 'teacherFilesContainer' за дроп зона.
    // Вместо това, реферираме директно към формата за качване.
    const uploadForm = document.getElementById('uploadForm'); // <-- Това е правилният елемент

    console.log('DOMContentLoaded fired in materials.js');
    console.log('window.initialTeacherData:', window.initialTeacherData);

    const initialTeacherData = window.initialTeacherData;

    // Проверка за първоначални данни
    if (!initialTeacherData || !initialTeacherData.selectedTeacher || !initialTeacherData.initialDisplayFolderId || !initialTeacherData.initialUploadFolderId) {
        console.error('Initial configuration missing: selectedTeacher, initialDisplayFolderId, or initialUploadFolderId is null/undefined.');
        showErrorMessage('Няма налични учители или начална конфигурация. Моля, свържете се с администратор.');
        return;
    }

    // Инициализиране на глобалните променливи
    currentTeacherEmail = initialTeacherData.selectedTeacher.email;
    defaultTeacherMaterialFolderId = initialTeacherData.initialDisplayFolderId;
    displayFolderId = initialTeacherData.initialDisplayFolderId;
    uploadTargetFolderId = initialTeacherData.initialUploadFolderId; // ID на папката за качване на задания

    console.log('currentTeacherEmail (from window.initialTeacherData):', currentTeacherEmail);
    console.log('displayFolderId (materials):', displayFolderId);
    console.log('uploadTargetFolderId (assignments):', uploadTargetFolderId);

    // Актуализираме скритите инпути веднага след инициализация
    updateHiddenUploadInputs();


    if (teacherSelect) {
        // Актуализиране на заглавието с името на избрания учител
        const initialTeacherName = teacherSelect.options[teacherSelect.selectedIndex]?.dataset.name;
        if (initialTeacherName && teacherFilesTitle) {
            teacherFilesTitle.textContent = `Учебни материали`;
        }

        // Event listener за смяна на учител
        teacherSelect.addEventListener('change', async () => {
            const selectedEmail = teacherSelect.value;
            const selectedName = teacherSelect.options[teacherSelect.selectedIndex]?.dataset.name;

            currentTeacherEmail = selectedEmail;
            if (teacherFilesTitle) {
                teacherFilesTitle.textContent = `Учебни материали на ${selectedName}`;
            }

            try {
                // Извличане на новите ID-та на папките за избрания учител
                const res = await fetch(`/api/root-folder?email=${encodeURIComponent(selectedEmail)}`);
                if (!res.ok) {
                    const errorText = await res.text();
                    throw new Error(`Failed to load root folder: ${res.status} ${res.statusText} - ${errorText}`);
                }
                const data = await res.json();

                defaultTeacherMaterialFolderId = data.displayFolderID;
                displayFolderId = data.displayFolderID;
                uploadTargetFolderId = data.uploadFolderID;

                updateHiddenUploadInputs(); // Актуализираме скритите инпути след смяна на учител

                await loadFolder(displayFolderId, true); // Зареждаме материалите за новия учител
            } catch (err) {
                console.error(err);
                showErrorMessage('Грешка при зареждане на материали за избрания учител.');
            }
        });
    }


    // Първоначално зареждане на файловете на учителя
    await loadFolder(displayFolderId, true);

    // Event listener за бутоните назад/напред на браузъра
    window.addEventListener('popstate', async (event) => {
        if (event.state && event.state.folderId && event.state.teacherEmail) {
            currentTeacherEmail = event.state.teacherEmail;
            if (teacherSelect) {
                teacherSelect.value = event.state.teacherEmail;
                const poppedTeacherName = teacherSelect.options[teacherSelect.selectedIndex]?.dataset.name;
                if (poppedTeacherName && teacherFilesTitle) {
                    teacherFilesTitle.textContent = `Учебни материали на ${poppedTeacherName}`;
                }
            }

            try {
                // Презареждаме root фолдер ID-тата, ако учителят се е сменил през popstate
                const rootRes = await fetch(`/api/root-folder?email=${encodeURIComponent(currentTeacherEmail)}`);
                if (!rootRes.ok) {
                    const errorText = await rootRes.text();
                    throw new Error(`Failed to load root folder on popstate: ${rootRes.status} ${rootRes.statusText} - ${errorText}`);
                }
                const rootData = await rootRes.json();
                defaultTeacherMaterialFolderId = rootData.displayFolderID;
                uploadTargetFolderId = rootData.uploadFolderID;

                updateHiddenUploadInputs(); // Актуализираме скритите инпути при popstate

                await loadFolder(event.state.folderId, true);
            } catch (err) {
                console.error('Error handling popstate root fetch:', err);
                showErrorMessage('Грешка при връщане назад в историята.');
            }

        } else if (defaultTeacherMaterialFolderId && currentTeacherEmail) {
            await loadFolder(defaultTeacherMaterialFolderId, true);
        } else {
            showErrorMessage('Не може да се върне назад. Липсва информация за папка.');
        }
    });

    // --- Drag and Drop Logic ---
    // ПРОМЯНА: Закачаме събитията за Drag & Drop към `uploadForm`
    if (uploadForm) {
        console.log('Attaching drag and drop listeners to #uploadForm.');
        // Предотвратяване на стандартното поведение на браузъра за всички drag събития
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            uploadForm.addEventListener(eventName, preventDefaults, false);
        });

        // Визуален индикатор при влачене над дроп зоната
        ['dragenter', 'dragover'].forEach(eventName => {
            uploadForm.addEventListener(eventName, highlightDropArea, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            uploadForm.addEventListener(eventName, unhighlightDropArea, false);
        });

        // Обработка на пуснатия файл
        uploadForm.addEventListener('drop', handleDrop, false);
    } else {
        // ПРОМЯНА: По-точно съобщение за грешка
        console.warn("Upload form (uploadForm) not found. Drag-and-drop for students will not be enabled.");
    }

    if (fileInput) {
        fileInput.addEventListener('change', handleFileInputChange);
    } else {
        console.error('File input element (entry_value) not found. File upload via button will not work.');
    }
});