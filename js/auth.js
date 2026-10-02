```javascript
import { auth } from './firebase-config.js';

import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    updateProfile,
    onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';


// ================================
// REGISTER A NEW USER
// ================================
export async function registerUser(email, password) {
    try {
        const userCredential = await createUserWithEmailAndPassword(
            auth,
            email,
            password
        );

        return userCredential.user;

    } catch (error) {
        console.error('Registration error:', error);
        throw error;
    }
}


// ================================
// UPDATE USER PROFILE
// ================================
export async function updateUserProfile(data) {
    try {
        const user = auth.currentUser;

        if (!user) {
            throw new Error('No authenticated user was found.');
        }

        await updateProfile(user, {
            displayName: data.displayName || data.businessType || ''
        });

        return user;

    } catch (error) {
        console.error('Profile update error:', error);
        throw error;
    }
}


// ================================
// LOG IN AN EXISTING USER
// ================================
export async function loginUser(email, password) {
    try {
        const userCredential = await signInWithEmailAndPassword(
            auth,
            email,
            password
        );

        return userCredential.user;

    } catch (error) {
        console.error('Login error:', error);
        throw error;
    }
}


// ================================
// LOG OUT
// ================================
export async function logoutUser() {
    try {
        await signOut(auth);
        window.location.replace('index.html');

    } catch (error) {
        console.error('Logout error:', error);
        throw error;
    }
}


// ================================
// AUTHENTICATION STATE
// ================================
window.authReady = false;
window.currentUser = null;

onAuthStateChanged(auth, (user) => {
    window.authReady = true;
    window.currentUser = user || null;

    if (user) {
        const userDisplay = document.getElementById('userDisplay');

        if (userDisplay) {
            userDisplay.textContent =
                user.displayName || user.email || '(User)';
        }
    } else {
        // Keep visitors on the login or registration pages.
        const path = window.location.pathname;

        const isAuthPage =
            path.endsWith('/index.html') ||
            path.endsWith('/register.html') ||
            path === '/' ||
            path.endsWith('/');

        // Redirect only protected pages, not login or registration.
        if (!isAuthPage) {
            window.location.replace('index.html');
        }
    }

    // Notify other scripts that Firebase has finished checking the user.
    window.dispatchEvent(
        new CustomEvent('authReady', {
            detail: user || null
        })
    );
});
```
