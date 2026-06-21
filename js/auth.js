import { auth } from './firebase-config.js';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, updateProfile, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

export async function registerUser(email, password) {
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        return userCredential.user;
    } catch (error) {
        throw error.message;
    }
}

export async function updateUserProfile(data) {
    try {
        await updateProfile(auth.currentUser, { 
            displayName: data.displayName || data.businessType 
        });
    } catch (error) {
        throw error.message;
    }
}

export async function loginUser(email, password) {
    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        return userCredential.user;
    } catch (error) {
        throw error.message;
    }
}

export async function logoutUser() {
    await signOut(auth);
    window.location.href = 'index.html';
}

// Track auth readiness
window.authReady = false;

onAuthStateChanged(auth, (user) => {
    window.authReady = true;
    
    if (user) {
        window.currentUser = user;
        const userDisplay = document.getElementById('userDisplay');
        if (userDisplay) userDisplay.textContent = user.displayName || user.email || '(User)';
        
        // Dispatch event so dashboard.js knows auth is ready
        window.dispatchEvent(new CustomEvent('authReady', { detail: user }));
    } else {
        window.currentUser = null;
        // Only redirect if we're NOT already on login or register page
        const path = window.location.pathname;
        const isAuthPage = path.includes('index.html') || path.includes('register.html') || path === '/' || path.endsWith('/');
        if (!isAuthPage) {
            window.location.href = 'index.html';
        }
    }
});