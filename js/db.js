import { db } from './firebase-config.js';
import { 
    collection, doc, addDoc, getDoc, getDocs, updateDoc, deleteDoc, 
    query, where, orderBy, limit, onSnapshot, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const PRODUCTS_COLLECTION = 'products';
const SALES_COLLECTION = 'sales_history';
const ACTIVITY_COLLECTION = 'activity_log';

// Add product
export async function addProduct(productData) {
    const docRef = await addDoc(collection(db, PRODUCTS_COLLECTION), {
        ...productData,
        user_id: window.currentUser.uid,
        created_at: serverTimestamp()
    });
    await logActivity(productData.name, 'ADD', productData.quantity);
    return docRef.id;
}

// Get all products for current user (real-time)
export function subscribeToProducts(callback) {
    const q = query(
        collection(db, PRODUCTS_COLLECTION),
        where("user_id", "==", window.currentUser.uid)
    );
    
    return onSnapshot(q, (snapshot) => {
        const products = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        callback(products);
    });
}

// Update product (sell/restock)
export async function updateStock(productId, newQuantity, itemsSoldDelta, action) {
    const productRef = doc(db, PRODUCTS_COLLECTION, productId);
    await updateDoc(productRef, {
        quantity: newQuantity,
        items_sold: itemsSoldDelta
    });
    
    // Log sale if selling
    if (action === 'SELL') {
        const productSnap = await getDoc(productRef);
        const product = productSnap.data();
        await addDoc(collection(db, SALES_COLLECTION), {
            user_id: window.currentUser.uid,
            product_name: product.name,
            category: product.category,
            price_sold: product.price,
            quantity_sold: Math.abs(itemsSoldDelta),
            sold_at: serverTimestamp()
        });
    }
    
    await logActivity(product.name, action, Math.abs(itemsSoldDelta));
}

// Delete product
export async function deleteProduct(productId) {
    await deleteDoc(doc(db, PRODUCTS_COLLECTION, productId));
}

// Log activity
async function logActivity(productName, action, quantity) {
    await addDoc(collection(db, ACTIVITY_COLLECTION), {
        user_id: window.currentUser.uid,
        product_name: productName,
        action_type: action,
        quantity: quantity,
        created_at: serverTimestamp()
    });
}

// Get activity log
export function subscribeToActivity(callback) {
    const q = query(
        collection(db, ACTIVITY_COLLECTION),
        where("user_id", "==", window.currentUser.uid),
        orderBy("created_at", "desc"),
        limit(50)
    );
    
    return onSnapshot(q, (snapshot) => {
        const logs = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        callback(logs);
    });
}

// Get sales history
export function subscribeToSales(callback) {
    const q = query(
        collection(db, SALES_COLLECTION),
        where("user_id", "==", window.currentUser.uid),
        orderBy("sold_at", "desc"),
        limit(100)
    );
    
    return onSnapshot(q, (snapshot) => {
        const sales = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        callback(sales);
    });
}