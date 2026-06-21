import { auth } from './firebase-config.js';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, updateProfile, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// Register
export async function registerUser(email, password) {
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        return userCredential.user;
    } catch (error) {
        throw error.message;
    }
}

// Update user profile
export async function updateUserProfile(data) {
    try {
        await updateProfile(auth.currentUser, { 
            displayName: data.displayName || data.businessType 
        });
    } catch (error) {
        throw error.message;
    }
}

// Login
export async function loginUser(email, password) {
    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        return userCredential.user;
    } catch (error) {
        throw error.message;
    }
}

// Logout
export async function logoutUser() {
    await signOut(auth);
    window.location.href = 'index.html';
}

// Auth state listener
onAuthStateChanged(auth, (user) => {
    if (!user && !window.location.pathname.includes('index.html') && !window.location.pathname.includes('register.html')) {
        window.location.href = 'index.html';
    }
    if (user) {
        window.currentUser = user;
        const userDisplay = document.getElementById('userDisplay');
        if (userDisplay) userDisplay.textContent = user.displayName || user.email || '(User)';
    }
});