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
    const userId = window.currentUser?.uid;
    if (!userId) throw new Error('User not authenticated');
    
    const docRef = await addDoc(collection(db, PRODUCTS_COLLECTION), {
        ...productData,
        user_id: userId,
        created_at: serverTimestamp()
    });
    
    // Log activity after successful product creation
    try {
        await logActivity(productData.name, 'ADD', productData.quantity || 0, 0);
        console.log('ADD activity logged for:', productData.name);
    } catch (err) {
        console.error('Failed to log ADD activity:', err);
    }
    
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
    }, (error) => {
        console.error('Products listener error:', error);
    });
}

// Update product (sell/restock)
export async function updateStock(productId, newQuantity, newItemsSold, action, deltaQty) {
    try {
        const userId = window.currentUser?.uid;
        if (!userId) {
            throw new Error('User not authenticated - cannot update stock');
        }
        
        const productRef = doc(db, PRODUCTS_COLLECTION, productId);
        const productSnap = await getDoc(productRef);
        
        if (!productSnap.exists()) {
            throw new Error('Product not found');
        }
        
        const product = productSnap.data();
        
        // Update the product first
        await updateDoc(productRef, {
            quantity: newQuantity,
            items_sold: newItemsSold
        });
        
        // Log the activity FIRST (most important)
        const revenue = action === 'SELL' ? (product.price || 0) * deltaQty : 0;
        try {
            await logActivity(product.name, action, deltaQty, revenue);
            console.log(`Activity logged: ${action} ${deltaQty}x ${product.name}`);
        } catch (activityErr) {
            console.error('CRITICAL: Failed to log activity:', activityErr);
            // Don't throw - product was updated, but log failed
        }
        
        // Log sale to sales_history if selling
        if (action === 'SELL') {
            const saleData = {
                user_id: userId,
                product_name: product.name,
                category: product.category,
                price_sold: product.price || 0,
                quantity_sold: deltaQty,
                revenue: revenue,
                sold_at: serverTimestamp()
            };
            console.log('Creating sales record:', saleData);
            try {
                await addDoc(collection(db, SALES_COLLECTION), saleData);
                console.log('Sale recorded successfully');
            } catch (err) {
                console.error('Failed to create sales record:', err);
            }
        }
    } catch (error) {
        console.error('updateStock error:', error);
        throw error;
    }
}

// Delete product
export async function deleteProduct(productId) {
    await deleteDoc(doc(db, PRODUCTS_COLLECTION, productId));
}

// Log activity
async function logActivity(productName, action, quantity, revenue = 0) {
    try {
        const userId = window.currentUser?.uid;
        if (!userId) {
            console.warn('Cannot log activity: no authenticated user');
            return;
        }
        
        const activityData = {
            user_id: userId,
            product_name: productName || 'Unknown Product',
            action_type: action,
            quantity: quantity || 0,
            revenue: revenue || 0,
            created_at: serverTimestamp()
        };
        console.log('Logging activity:', activityData);
        await addDoc(collection(db, ACTIVITY_COLLECTION), activityData);
        console.log('Activity logged successfully');
    } catch (error) {
        console.error('logActivity error:', error);
    }
}

// Log stock alert to persistent history
export async function logStockAlert(productId, productName, quantity, alertLimit) {
    try {
        await addDoc(collection(db, ALERTS_COLLECTION), {
            user_id: window.currentUser.uid,
            product_id: productId,
            product_name: productName,
            quantity: quantity,
            alert_limit: alertLimit,
            created_at: serverTimestamp()
        });
    } catch (error) {
        console.error('logStockAlert error:', error);
    }
}

// Get activity log
export function subscribeToActivity(callback) {
    try {
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
            console.log('Activity logs fetched:', logs.length);
            callback(logs);
        }, (error) => {
            console.error('Activity listener error:', error);
        });
    } catch (error) {
        console.error('subscribeToActivity error:', error);
        // Fallback without orderBy if query construction fails
        const fallbackQ = query(
            collection(db, ACTIVITY_COLLECTION),
            where("user_id", "==", window.currentUser.uid),
            limit(50)
        );
        return onSnapshot(fallbackQ, (snapshot) => {
            const logs = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            callback(logs);
        });
    }
}

// Get sales history
export function subscribeToSales(callback) {
    try {
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
            console.log('Sales fetched:', sales.length);
            callback(sales);
        }, (error) => {
            console.error('Sales listener error:', error);
            console.log('Error code:', error.code);
            if (error.code === 'failed-precondition') {
                console.error('COMPOSITE INDEX REQUIRED! Create index in Firebase Console:');
                console.error('Collection: sales_history');
                console.error('Fields: user_id (Ascending), sold_at (Descending)');
            }
        });
    } catch (error) {
        console.error('subscribeToSales error:', error);
        // Fallback without orderBy if query construction fails
        const fallbackQ = query(
            collection(db, SALES_COLLECTION),
            where("user_id", "==", window.currentUser.uid),
            limit(100)
        );
        return onSnapshot(fallbackQ, (snapshot) => {
            const sales = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            callback(sales);
        });
    }
}

// Get stock alert history
export function subscribeToStockAlerts(callback) {
    try {
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
        }, (error) => {
            console.error('Stock alerts listener error:', error);
            if (error.code === 'failed-precondition') {
                console.error('COMPOSITE INDEX REQUIRED! Create index in Firebase Console:');
                console.error('Collection: stock_alerts');
                console.error('Fields: user_id (Ascending), created_at (Descending)');
            }
        });
    } catch (error) {
        console.error('subscribeToStockAlerts error:', error);
        // Fallback without orderBy if query construction fails
        const fallbackQ = query(
            collection(db, ALERTS_COLLECTION),
            where("user_id", "==", window.currentUser.uid),
            limit(100)
        );
        return onSnapshot(fallbackQ, (snapshot) => {
            const alerts = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            callback(alerts);
        });
    }
}