const express = require('express');
const { firestore, studentDrive } = require('../config/googleAuth'); // Уверете се, че studentDrive е правилно конфигуриран с необходимите права
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { Readable } = require('stream'); // Добавена за стриймване на файлове към Google Drive
const fsp = require('fs').promises; // Използваме promises-базираната версия на fs за по-чист код

const router = express.Router();

// Настройка на Multer за временно съхранение на качените файлове
const upload = multer({ dest: 'uploads/' });

// --- Помощни Функции ---

/**
 * Взема ID на основната папка на учителя от Firestore.
 * Тази функция може да е нужна за извличане на УЧЕБНИ МАТЕРИАЛИ, но не за папка за ЗАДАНИЯ.
 * Може да се използва, ако решите да показвате и материали на студентите.
 * @param {string} email - Имейлът на учителя.
 * @returns {Promise<string|null>} ID на папката или null, ако не е намерена.
 */
async function getTeacherFolderID(email) {
    try {
        const docRef = firestore.collection('teachers').doc(email);
        const doc = await docRef.get();
        if (!doc.exists) {
            console.warn(`Teacher with email ${email} not found in Firestore.`);
            return null;
        }
        return doc.data().folderID; // Това е папката за учебни материали на учителя
    } catch (err) {
        console.error('Error getting teacher folder ID in student-route:', err);
        throw err;
    }
}

/**
 * Извлича ID на папката за качване на задания за конкретен учител от колекция 'students'.
 * @param {string} teacherEmail - Имейлът на учителя.
 * @returns {Promise<string|null>} ID на папката за качване или null, ако не е намерена.
 */
async function getStudentUploadFolderID(teacherEmail) {
    try {
        const studentDocRef = firestore.collection('students').doc(teacherEmail);
        const studentDoc = await studentDocRef.get();
        if (studentDoc.exists && studentDoc.data() && studentDoc.data().folderID) {
            return studentDoc.data().folderID;
        }
        return null;
    } catch (err) {
        console.error(`Error getting student upload folder ID for ${teacherEmail}:`, err);
        throw err;
    }
}

/**
 * Извлича метаданни за дадена папка, използвайки studentDrive.
 * @param {string} folderId - ID на папката.
 * @returns {Promise<object|null>} Метаданни на папката или null, ако не е намерена/грешка.
 */
async function getFolderMetadata(folderId) {
    try {
        const res = await studentDrive.files.get({
            fileId: folderId,
            fields: 'id, name, parents, webViewLink, iconLink, modifiedTime, mimeType',
            supportsAllDrives: true, // Важно за споделени дискове
        });
        return res.data;
    } catch (err) {
        if (err.code === 404) {
            console.warn(`Folder metadata for ID ${folderId} not found.`);
            return null;
        }
        console.error(`Error fetching folder metadata for ID ${folderId} using studentDrive:`, err);
        throw err; // Хвърляме за други критични грешки
    }
}

/**
 * Изгражда масив от "трохи" (breadcrumbs) от корена до текущата папка.
 * @param {string} folderId - ID на текущата папка.
 * @param {string} defaultTeacherRootFolderId - ID на основната папка на учителя (тази за задания).
 * @returns {Promise<Array<object>>} Масив с обекти { id, name } за всяка "троха".
 */
async function buildBreadcrumbs(folderId, defaultTeacherRootFolderId) {
    const breadcrumbs = [];
    let currentId = folderId;
    const visitedIds = new Set(); // За да предотвратим безкрайни цикли

    while (currentId) {
        if (visitedIds.has(currentId)) {
            console.warn(`Circular reference or duplicate found in breadcrumbs for ID ${currentId}. Stopping.`);
            break;
        }
        visitedIds.add(currentId);

        let metadata;
        try {
            metadata = await getFolderMetadata(currentId);
        } catch (err) {
            console.warn(`Could not get metadata for breadcrumb ID ${currentId}. Stopping breadcrumb build.`, err.message);
            break; // Спираме, ако има грешка при взимане на метаданни
        }

        if (!metadata) break; // Спираме, ако метаданните не са намерени

        breadcrumbs.unshift({ id: metadata.id, name: metadata.name });

        // Ако текущата папка е основната папка на учителя за задания, спираме.
        if (currentId === defaultTeacherRootFolderId) {
            break;
        }

        // Преминаваме към родителската папка, ако съществува
        if (metadata.parents && metadata.parents.length > 0) {
            currentId = metadata.parents[0];
        } else {
            break; // Няма повече родители
        }
    }
    return breadcrumbs;
}

/**
 * Взема съдържанието (файлове и подпапки) на дадена папка, използвайки studentDrive.
 * @param {string} folderId - ID на папката.
 * @returns {Promise<Array<object>>} Масив от файлове и папки.
 */
async function getFolderContentById(folderId) {
    try {
        const res = await studentDrive.files.list({
            q: `'${folderId}' in parents and trashed = false`, // Заявка за съдържанието на папката
            fields: 'files(id,name,webViewLink,iconLink,modifiedTime,mimeType)', // Полета за извличане
            orderBy: 'modifiedTime desc', // Сортиране по последна промяна
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
        });
        return res.data.files || [];
    } catch (err) {
        console.error(`Error fetching folder content for ID ${folderId} using studentDrive:`, err);
        throw err;
    }
}


// --- Маршрути ---

// Рут маршрут за студентския интерфейс
router.get('/', async (req, res) => {
    const teacherEmailParam = req.query.teacherEmail;
    const folderIdParam = req.query.folderId; // Това е ID-то, което може да идва от URL след навигация или пренасочване

    try {
        const teachersSnapshot = await firestore.collection('teachers').get();
        const teachers = teachersSnapshot.docs.map(doc => doc.data());

        let selectedTeacher = teachers[0];
        if (teacherEmailParam) {
            const foundTeacher = teachers.find(t => t.email === teacherEmailParam);
            if (foundTeacher) {
                selectedTeacher = foundTeacher;
            }
        }

        let initialDisplayFolderId = null; // За визуализация (материали)
        let initialUploadFolderId = null;  // За качване (задания)

        if (selectedTeacher) {
            // Взимаме ID на папката за УЧЕБНИ МАТЕРИАЛИ от колекция 'teachers'
            const teacherMaterialFolder = await getTeacherFolderID(selectedTeacher.email);
            if (teacherMaterialFolder) {
                initialDisplayFolderId = teacherMaterialFolder; // По подразбиране папката за материали
                console.log(`Initial teacher material folder ID for ${selectedTeacher.email}: ${initialDisplayFolderId}`);
            } else {
                console.warn(`No material folder ID found for teacher ${selectedTeacher.email} in 'teachers' collection.`);
                return res.status(500).send('Няма налична папка с учебни материали за избрания учител. Моля, свържете се с администратор.');
            }

            // Взимаме ID на папката за ЗАДАНИЯ от колекция 'students'
            const studentUploadFolder = await getStudentUploadFolderID(selectedTeacher.email);
            if (studentUploadFolder) {
                initialUploadFolderId = studentUploadFolder;
                console.log(`Initial student upload folder ID for ${selectedTeacher.email}: ${initialUploadFolderId}`);
            } else {
                console.warn(`No dedicated student upload folder ID found for teacher ${selectedTeacher.email} in 'students' collection.`);
                // Тук може да решиш дали да деактивираш качването или да покажеш съобщение
            }
        } else {
            console.error('No selected teacher.');
            return res.status(500).send('Няма избран учител.');
        }

        if (folderIdParam && folderIdParam !== initialUploadFolderId) {

            initialDisplayFolderId = folderIdParam;
        }

        res.render('student', {
            teachers: teachers,
            selectedTeacher: selectedTeacher,
            initialDisplayFolderId: initialDisplayFolderId,
            initialUploadFolderId: initialUploadFolderId
        });

    } catch (error) {
        console.error('Error loading student page:', error);
        res.status(500).send('Грешка при зареждане на страницата.');
    }
});

router.get('/api/folder/:folderId', async (req, res) => {
    const folderId = req.params.folderId;
    const teacherEmail = req.query.teacherEmail;

    if (!teacherEmail) {
        return res.status(400).json({ error: 'Липсва имейл на учителя.' });
    }

    try {
        const files = await getFolderContentById(folderId); // Извлича съдържанието на подадения folderId

        // Тук rootFolderId за breadcrumbs трябва да е папката за УЧЕБНИ МАТЕРИАЛИ
        const rootMaterialFolderId = await getTeacherFolderID(teacherEmail);
        if (!rootMaterialFolderId) {
            return res.status(404).json({ error: 'Няма основна папка с материали за този учител.' });
        }

        // buildBreadcrumbs сега ще изгражда пътя до папката с материали
        const breadcrumbs = await buildBreadcrumbs(folderId, rootMaterialFolderId);

        res.json({ files: files, breadcrumbs: breadcrumbs });
    } catch (error) {
        console.error(`Error fetching folder ${folderId} content for student:`, error);
        res.status(500).json({ error: 'Грешка при извличане на съдържанието на папка.' });
    }
});

// API endpoint за извличане на root folder ID за конкретен учител (при смяна на учител в dropdown)
router.get('/api/root-folder', async (req, res) => {
    const teacherEmail = req.query.email;

    if (!teacherEmail) {
        return res.status(400).json({ error: 'Имейлът на учителя е задължителен.' });
    }

    try {
        // Взимаме ID на папката за УЧЕБНИ МАТЕРИАЛИ от колекция 'teachers'
        const teacherMaterialFolder = await getTeacherFolderID(teacherEmail);
        if (!teacherMaterialFolder) {
            console.warn(`API: No material folder ID found for teacher ${teacherEmail} in 'teachers' collection.`);
            return res.status(404).json({ error: 'Няма налична папка с учебни материали за този учител.' });
        }

        // Взимаме ID на папката за ЗАДАНИЯ от колекция 'students'
        const studentUploadFolder = await getStudentUploadFolderID(teacherEmail);
        // Може да е null, ако учителят няма папка за задания, което е ок за визуализация.

        // Взимане на breadcrumbs за папката с учебни материали
        const breadcrumbs = await buildBreadcrumbs(teacherMaterialFolder, teacherMaterialFolder);

        res.json({
            displayFolderID: teacherMaterialFolder, // Папката, която студентът ще вижда
            uploadFolderID: studentUploadFolder,   // Папката, в която студентът ще качва
            breadcrumbs: breadcrumbs
        });

    } catch (error) {
        console.error('Error fetching root folder for API (student route):', error);
        res.status(500).json({ error: 'Грешка при извличане на основна папка.' });
    }
});

router.post('/upload', upload.single('file'), async (req, res) => {
    const file = req.file;
    const uploadFolderId = req.body.uploadFolderId; // ID на текущата папка, в която се качва (папката за задания)
    const teacherEmail = req.body.teacherEmail; // Имейлът на избрания учител

    if (!file) {
        return res.status(400).send('Няма прикачен файл.');
    }
    if (!uploadFolderId) {
        return res.status(400).send('Липсва ID на папката за качване.');
    }
    if (!teacherEmail) {
        return res.status(400).send('Липсва имейл на учителя.');
    }

    try {
        const filePath = file.path;
        const fileName = Buffer.from(file.originalname, 'latin1').toString('utf8');
        const mimeType = file.mimetype;

        const expectedRootUploadFolderId = await getStudentUploadFolderID(teacherEmail);
        if (!expectedRootUploadFolderId) {
            await fsp.unlink(filePath);
            return res.status(403).send('Няма разрешена папка за качване за този учител.');
        }

        const fileContent = await fsp.readFile(filePath);

        const response = await studentDrive.files.create({
            resource: {
                name: fileName,
                parents: [uploadFolderId] // Качва се в папката за задания
            },
            media: {
                mimeType: mimeType,
                body: Readable.from(fileContent)
            },
            fields: 'id, name, webViewLink'
        });

        console.log('File uploaded:', response.data.name, response.data.id, 'to folder:', uploadFolderId);

        await fsp.unlink(filePath);

        const teacherMaterialFolder = await getTeacherFolderID(teacherEmail);
        if (teacherMaterialFolder) {
            res.redirect(`/?teacherEmail=${encodeURIComponent(teacherEmail)}&folderId=${encodeURIComponent(teacherMaterialFolder)}`);
        } else {
            // Fallback, ако по някаква причина не можем да намерим папката за материали
            res.redirect(`/?teacherEmail=${encodeURIComponent(teacherEmail)}`);
        }


    } catch (error) {
        console.error('Error uploading file:', error);
        if (file && file.path) {
            try {
                await fsp.unlink(file.path);
            } catch (unlinkError) {
                console.error('Error deleting temporary file:', unlinkError);
            }
        }
        res.status(500).send('Грешка при качване на файл.');
    }
}); 

module.exports = router;