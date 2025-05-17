// public/js/teachers.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import { getFirestore, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

// 1. Firebase конфигурация (взета от window.env, инжектирана от сървъра)
const firebaseConfig = {
    apiKey: window.env.FIREBASE_API_KEY,
    authDomain: window.env.FIREBASE_AUTH_DOMAIN,
    projectId: window.env.FIREBASE_PROJECT_ID
};

// 2. Инициализация на Firebase и Firestore
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// 3. Зареждане и визуализация на учителските карти
async function loadTeachers() {
    const container = document.getElementById('teacherCards');
    container.innerHTML = '<p>Loading...</p>';

    try {
        const snapshot = await getDocs(collection(db, 'teachers_upload'));

        if (snapshot.empty) {
            container.innerHTML = '<p>No teachers available at the moment.</p>';
            return;
        }

        container.innerHTML = ''; // Изчистване преди зареждане

        snapshot.forEach(doc => {
            const data = doc.data();
            const isActive = data.active;

            const card = document.createElement('div');
            card.className = `teacher-card ${isActive ? 'active' : 'inactive'}`;
            card.innerHTML = `
  <h3>${data.name}</h3>
  <p>${data.subject}</p>
`;

            if (isActive) {
                card.addEventListener('click', () => {
                    window.location.href = `/upload?teacher=${encodeURIComponent(doc.id)}`;
                });
            }

            container.appendChild(card);
        });

    } catch (error) {
        console.error('Грешка при зареждане на учителите:', error);
        container.innerHTML = '<p style="color:red;">Грешка при зареждане на учителите.</p>';
    }
}

// 4. Стартиране при зареждане на страницата
document.addEventListener('DOMContentLoaded', loadTeachers);
