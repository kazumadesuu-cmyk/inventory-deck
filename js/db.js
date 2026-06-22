import { db } from './firebase-config.js';
import { 
    collection, doc, addDoc, getDoc, getDocs, updateDoc, deleteDoc, 
    query, where, orderBy, limit, onSnapshot, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const PRODUCTS_COLLECTION = 'products';
const SALES_COLLECTION = 'sales_history';
const ACTIVITY_COLLECTION = 'activity_log';
const ALERTS_COLLECTION = 'stock_alerts';

// Add product
export async function addProduct(productData) {
    const docRef = await addDoc(collection(db, PRODUCTS_COLLECTION), {
        ...productData,
        user_id: window.currentUser.uid,
        created_at: serverTimestamp()
    });
    await logActivity(productData.name, 'ADD', productData.quantity, 0);
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
export async function updateStock(productId, newQuantity, newItemsSold, action, deltaQty) {
    const productRef = doc(db, PRODUCTS_COLLECTION, productId);
    const productSnap = await getDoc(productRef);
    const product = productSnap.data();
    
    await updateDoc(productRef, {
        quantity: newQuantity,
        items_sold: newItemsSold
    });
    
    // Log sale to sales_history if selling
    if (action === 'SELL') {
        const revenue = (product.price || 0) * deltaQty;
        await addDoc(collection(db, SALES_COLLECTION), {
            user_id: window.currentUser.uid,
            product_name: product.name,
            category: product.category,
            price_sold: product.price || 0,
            quantity_sold: deltaQty,
            revenue: revenue,
            sold_at: serverTimestamp()
        });
        await logActivity(product.name, action, deltaQty, revenue);
    } else {
        await logActivity(product.name, action, deltaQty, 0);
    }
}

// Delete product
export async function deleteProduct(productId) {
    await deleteDoc(doc(db, PRODUCTS_COLLECTION, productId));
}

// Log activity
async function logActivity(productName, action, quantity, revenue = 0) {
    await addDoc(collection(db, ACTIVITY_COLLECTION), {
        user_id: window.currentUser.uid,
        product_name: productName,
        action_type: action,
        quantity: quantity,
        revenue: revenue,
        created_at: serverTimestamp()
    });
}

// Log stock alert to persistent history
export async function logStockAlert(productId, productName, quantity, alertLimit) {
    await addDoc(collection(db, ALERTS_COLLECTION), {
        user_id: window.currentUser.uid,
        product_id: productId,
        product_name: productName,
        quantity: quantity,
        alert_limit: alertLimit,
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

// Get stock alert history
export function subscribeToStockAlerts(callback) {
    const q = query(
        collection(db, ALERTS_COLLECTION),
        where("user_id", "==", window.currentUser.uid),
        orderBy("created_at", "desc"),
        limit(100)
    );
    
    return onSnapshot(q, (snapshot) => {
        const alerts = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        callback(alerts);
    });
}