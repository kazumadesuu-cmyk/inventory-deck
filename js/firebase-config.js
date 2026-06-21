import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAJH28fTrkuBHZK7LeR1QLo1FJhbvIjjCc",
  authDomain: "inventory-deck-bb224.firebaseapp.com",
  projectId: "inventory-deck-bb224",
  storageBucket: "inventory-deck-bb224.firebasestorage.app",
  messagingSenderId: "517151828436",
  appId: "1:517151828436:web:7b13f00bb75d7f38b08e41",
  measurementId: "G-XS5MCLXN5Y"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);