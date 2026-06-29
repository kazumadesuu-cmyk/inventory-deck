import { subscribeToProducts, updateStock, addProduct, deleteProduct, subscribeToSales, subscribeToActivity, subscribeToStockAlerts, logStockAlert } from './db.js';
import { logoutUser } from './auth.js';
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from './firebase-config.js';

let products = [];
let unsubscribeProducts = null;
let unsubscribeSales = null;
let unsubscribeActivity = null;
let unsubscribeAlerts = null;
let currentFocusProduct = null;
let lowStockHistory = [];
let alertedProductIds = new Set();
let instantActivityLogs = [];
let currentActivityFilter = 'ALL';

let actionCooldown = false;
let cooldownTimer = null;

// PWA Install tracking
let deferredInstallPrompt = null;
let pwaInstallDismissed = localStorage.getItem('pwaInstallDismissed') === 'true';

function startActionCooldown() {
    actionCooldown = true;
    if (cooldownTimer) clearTimeout(cooldownTimer);
    cooldownTimer = setTimeout(() => {
        actionCooldown = false;
        cooldownTimer = null;
    }, 2000);
}

function isActionOnCooldown() {
    return actionCooldown;
}

document.addEventListener('DOMContentLoaded', () => {
    if (window.authReady && window.currentUser) {
        initializeDashboard();
    } else {
        window.addEventListener('authReady', () => {
            initializeDashboard();
        });
        const authCheckInterval = setInterval(() => {
            if (window.authReady && window.currentUser) {
                clearInterval(authCheckInterval);
                initializeDashboard();
            }
        }, 100);
        setTimeout(() => clearInterval(authCheckInterval), 10000);
    }
});

function initializeDashboard() {
    unsubscribeProducts = subscribeToProducts((newProducts) => {
        products = newProducts;
        renderProductCards(newProducts);
        checkLowStock(newProducts);
        updateSummary(newProducts);
        updateProductsPopup(newProducts);
    });

    unsubscribeSales = subscribeToSales((sales) => {
        updateRevenuePopup(sales);
        updateTotalRevenue(sales);
    });

    unsubscribeActivity = subscribeToActivity((logs) => {
        window.allActivityLogs = logs;
        updateActivityPopup(logs);
    });

    unsubscribeAlerts = subscribeToStockAlerts((alerts) => {
        updateAlertsPopup(alerts);
    });

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            openCuteModal('logoutConfirmModal');
        });
    }

    const modalForm = document.getElementById('modalForm');
    if (modalForm) {
        modalForm.addEventListener('submit', handleFormSubmit);
    }

    const warningIgnoreBtn = document.getElementById('warningIgnoreBtn');
    if (warningIgnoreBtn) {
        warningIgnoreBtn.addEventListener('click', () => {
            closePopupModal('warningModal');
        });
    }

    updateNetworkStatus();
    window.addEventListener('online', updateNetworkStatus);
    window.addEventListener('offline', updateNetworkStatus);

    // Setup PWA install prompt listener
    setupPWAInstallPrompt();

    // Delayed notification permission check
    setTimeout(() => {
        maybeRequestNotificationPermission();
    }, 3000);
}

// ==================== PWA INSTALL PROMPT ====================

function setupPWAInstallPrompt() {
    // Listen for the beforeinstallprompt event (Chrome/Android)
    window.addEventListener('beforeinstallprompt', (e) => {
        console.log('[PWA] beforeinstallprompt fired');
        e.preventDefault();
        deferredInstallPrompt = e;

        // Show install prompt after a short delay if not dismissed before
        if (!pwaInstallDismissed && !window.matchMedia('(display-mode: standalone)').matches) {
            setTimeout(() => {
                showPWAInstallModal();
            }, 5000);
        }
    });

    // Detect if app is already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
        console.log('[PWA] App is running in standalone mode');
    }
}

function showPWAInstallModal() {
    const modal = document.getElementById('pwaInstallModal');
    if (modal) {
        modal.style.display = 'flex';
    }
}

window.dismissPWAInstall = function() {
    localStorage.setItem('pwaInstallDismissed', 'true');
    pwaInstallDismissed = true;
    const modal = document.getElementById('pwaInstallModal');
    if (modal) modal.style.display = 'none';
};

window.installPWA = async function() {
    const modal = document.getElementById('pwaInstallModal');
    if (modal) modal.style.display = 'none';

    if (!deferredInstallPrompt) {
        showToast('Install prompt not available. Try "Add to Home Screen" from Chrome menu.', 'warning');
        return;
    }

    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    console.log('[PWA] Install prompt outcome:', outcome);

    if (outcome === 'accepted') {
        showToast('Stock Space is being installed!', 'success');
        localStorage.setItem('pwaInstallDismissed', 'true');
        pwaInstallDismissed = true;
    } else {
        showToast('Install cancelled', 'warning');
    }
    deferredInstallPrompt = null;
};

async function handleFormSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('form_product_id').value;
    const data = {
        name: document.getElementById('form_name').value,
        category: document.getElementById('form_category').value,
        price: parseFloat(document.getElementById('form_price').value),
        quantity: parseInt(document.getElementById('form_quantity').value) || 0,
        alert_limit: parseInt(document.getElementById('form_alert_limit').value),
        image_url: '',
        items_sold: 0
    };

    const imageInput = document.getElementById('form_image');
    if (imageInput && imageInput.files && imageInput.files[0]) {
        try {
            const base64Image = await readFileAsBase64(imageInput.files[0]);
            data.image_url = base64Image;
        } catch (err) {
            console.error('Image read failed:', err);
        }
    }

    if (id) {
        const productRef = doc(db, 'products', id);
        const updateData = {
            name: data.name,
            category: data.category,
            price: data.price,
            alert_limit: data.alert_limit
        };
        if (data.image_url) {
            updateData.image_url = data.image_url;
        }
        await updateDoc(productRef, updateData);
        showToast('Product updated successfully');
    } else {
        await addProduct(data);
        addInstantActivity(data.name, 'ADD', data.quantity || 0, 0);
        showToast('Product added successfully');
    }
    closeModal();
}

function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(e);
        reader.readAsDataURL(file);
    });
}

function updateNetworkStatus() {
    const badge = document.getElementById('networkStatusBadge');
    if (!badge) return;
    if (navigator.onLine) {
        badge.textContent = 'Online';
        badge.className = 'network-status-badge online';
    } else {
        badge.textContent = 'Offline';
        badge.className = 'network-status-badge offline';
    }
}

function getCategoryClass(category) {
    return category ? category.toLowerCase().replace(/[^a-z0-9]/g, '-') : 'uncategorized';
}

function renderProductCards(productList) {
    const grid = document.getElementById('cardsGrid');
    if (!grid) return;
    grid.innerHTML = '';

    if (productList.length === 0) {
        grid.innerHTML = '<div class="empty-view animate-fade-in">Your inventory deck is empty. Tap add to start!</div>';
        return;
    }

    productList.forEach((product, index) => {
        const isLow = product.quantity <= product.alert_limit;
        const card = document.createElement('div');
        card.className = `product-card cat-${getCategoryClass(product.category)} ${isLow ? 'low-stock-highlight' : ''}`;
        card.style.animationDelay = `${index * 0.1}s`;
        card.id = `card-product-${product.id}`;
        card.innerHTML = `
            <div class="status-dot ${isLow ? 'dot-low' : 'dot-ok'}"></div>
            <h4 class="card-title-text">${escapeHtml(product.name)}</h4>
            <span class="card-tag">${escapeHtml(product.category)}</span>
            <div class="card-img-holder">
                <img src="${product.image_url || 'https://cdn-icons-png.flaticon.com/512/679/679720.png'}" alt="Item Image" onerror="this.src='https://cdn-icons-png.flaticon.com/512/679/679720.png'">
            </div>
            <div class="stats-infobar">
                <div class="stat-block"><span class="lbl">Price</span><span class="val">${product.price ? '₱' + Number(product.price).toFixed(2) : '₱0.00'}</span></div>
                <div class="stat-block"><span class="lbl">Stock</span><span class="val stock-display-value ${isLow ? 'text-danger' : ''}">${product.quantity}</span></div>
                <div class="stat-block"><span class="lbl">Sold</span><span class="val sold-display-value">${product.items_sold || 0}</span></div>
            </div>
            <div class="button-drawer">
                <div class="action-row-pair">
                    <button class="btn-action btn-sell" onclick="event.stopPropagation(); window.sellOne('${product.id}')">Sold (-1)</button>
                    <button class="btn-action btn-restock" onclick="event.stopPropagation(); window.restockOne('${product.id}')">Restock (+1)</button>
                </div>
                <div class="utility-row">
                    <button class="btn-action btn-edit" onclick="event.stopPropagation(); editProduct('${product.id}')">Edit</button>
                    <button class="btn-action btn-delete" onclick="event.stopPropagation(); deleteProductItem('${product.id}')">Delete</button>
                </div>
            </div>
        `;
        card.addEventListener('click', () => openFocusModal(product));
        grid.appendChild(card);
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function sellOne(productId) {
    try {
        const product = products.find(p => p.id === productId);
        if (!product || product.quantity < 1) {
            showToast('Not enough stock!', 'error');
            return;
        }
        await updateStock(productId, product.quantity - 1, (product.items_sold || 0) + 1, 'SELL', 1);
        showActionToast(`Sold x1 ${product.name}`, 'sell');
    } catch (error) {
        console.error('sellOne error:', error);
        showToast('Failed to record sale: ' + error.message, 'error');
    }
}

async function restockOne(productId) {
    try {
        const product = products.find(p => p.id === productId);
        if (!product) return;
        await updateStock(productId, product.quantity + 1, product.items_sold || 0, 'RESTOCK', 1);
        showActionToast(`Restocked x1 ${product.name}`, 'restock');
    } catch (error) {
        console.error('restockOne error:', error);
        showToast('Failed to record restock: ' + error.message, 'error');
    }
}

window.sellOne = sellOne;
window.restockOne = restockOne;

// ==================== LOW STOCK CHECKING (COMPLETELY FIXED) ====================

function checkLowStock(productList) {
    const lowItems = productList.filter(p => p.quantity <= p.alert_limit);
    const lowItemIds = new Set(lowItems.map(p => p.id));

    // IMPORTANT: Remove items that are NO LONGER low from alertedProductIds
    // This resets them so they can trigger again if they go low in the future
    for (const id of Array.from(alertedProductIds)) {
        if (!lowItemIds.has(id)) {
            alertedProductIds.delete(id);
            console.log('Reset alert for product', id, '- stock recovered');
        }
    }

    // Update lowStockHistory to only contain currently low items
    lowStockHistory = lowStockHistory.filter(h => lowItemIds.has(h.id));

    // Update history for currently low items
    lowItems.forEach(item => {
        const existing = lowStockHistory.find(h => h.id === item.id);
        if (!existing) {
            lowStockHistory.unshift({
                id: item.id,
                name: item.name,
                quantity: item.quantity,
                alert_limit: item.alert_limit,
                timestamp: new Date().toLocaleString()
            });
        } else {
            existing.quantity = item.quantity;
            existing.timestamp = new Date().toLocaleString();
        }
    });

    // Update UI based on whether there are low items
    updateLowStockBanner(lowItems);
    updateAlertsPanel();

    if (lowItems.length > 0) {
        // CRITICAL FIX: Find newly alerted BEFORE adding to alertedProductIds
        const newlyAlerted = lowItems.filter(item => !alertedProductIds.has(item.id));

        if (newlyAlerted.length > 0) {
            // Now add them to the set
            newlyAlerted.forEach(item => alertedProductIds.add(item.id));

            // Log to Firestore
            newlyAlerted.forEach(item => {
                logStockAlert(item.id, item.name, item.quantity, item.alert_limit);
            });

            // Show warning modal
            showLowStockModal(lowItems);

            // Send Chrome/desktop notification
            sendChromeNotification(newlyAlerted);
        }
    }
}

function updateLowStockBanner(lowItems) {
    // HIDE the top banner completely - user only wants floating alert at bottom
    const banner = document.getElementById('lowStockBanner');
    if (banner) {
        banner.style.display = 'none';
    }

    // Only show/hide the floating alert at bottom right
    if (lowItems.length === 0) {
        removeFloatingAlert();
    } else {
        renderFloatingAlert(lowItems);
    }
}

// ==================== CHROME NOTIFICATIONS (FULLY FIXED FOR ANDROID PWA) ====================

function maybeRequestNotificationPermission() {
    if (!('Notification' in window)) {
        console.log('Notifications not supported in this browser');
        return;
    }
    console.log('Notification permission status:', Notification.permission);
    if (Notification.permission === 'default' && !localStorage.getItem('notifPromptDismissed')) {
        const modal = document.getElementById('notifPermissionModal');
        if (modal) {
            modal.style.display = 'flex';
            console.log('Showing notification permission modal');
        }
    } else if (Notification.permission === 'granted') {
        console.log('Notifications already granted');
    } else if (Notification.permission === 'denied') {
        console.log('Notifications denied by user');
    }
}

/**
 * FIXED: Sends notifications using Service Worker registration.showNotification()
 * This is the ONLY method that works reliably on Android PWA.
 * new Notification() is BLOCKED on mobile Chrome when running as PWA.
 */
async function sendChromeNotification(newlyAlertedItems) {
    if (!('Notification' in window)) {
        console.log('[NOTIF] Notifications not supported');
        return;
    }
    if (Notification.permission !== 'granted') {
        console.log('[NOTIF] Permission not granted, skipping notification');
        return;
    }

    const totalCount = newlyAlertedItems.length;
    const productNames = newlyAlertedItems.map(item => item.name).join(', ');

    const title = totalCount === 1 
        ? '⚠️ Low Stock Alert' 
        : `⚠️ ${totalCount} Items Low on Stock`;

    const body = totalCount === 1 
        ? `${productNames} is running low! Only ${newlyAlertedItems[0].quantity} left (limit: ${newlyAlertedItems[0].alert_limit})`
        : `${productNames} are running low on stock.`;

    // Use relative path for icon (works in both dev and production)
    const iconUrl = './icon-512.png';

    console.log('[NOTIF] Preparing notification:', title);

    // Vibrate on mobile (Android supports this)
    if (navigator.vibrate) {
        navigator.vibrate([200, 100, 200]);
    }

    // METHOD 1: Service Worker registration.showNotification() - REQUIRED for mobile PWA
    if ('serviceWorker' in navigator) {
        try {
            const reg = await navigator.serviceWorker.ready;
            console.log('[NOTIF] SW ready, registration state:', reg.active ? 'active' : 'not active');

            if (reg.active) {
                await reg.showNotification(title, {
                    body: body,
                    icon: iconUrl,
                    badge: iconUrl,
                    tag: 'stock-alert-' + Date.now(),
                    requireInteraction: true,
                    renotify: true,
                    // Android-specific: actions for notification
                    actions: [
                        { action: 'view', title: 'View Dashboard' },
                        { action: 'dismiss', title: 'Dismiss' }
                    ],
                    // Additional data for the service worker
                    data: {
                        url: './dashboard.html',
                        productIds: newlyAlertedItems.map(i => i.id)
                    }
                });
                console.log('[NOTIF] ✅ SW notification sent successfully');
                return;
            } else {
                console.warn('[NOTIF] SW not active yet, waiting...');
            }
        } catch (err) {
            console.error('[NOTIF] SW notification failed:', err);
        }
    }

    // METHOD 2: Fallback using postMessage to SW (if registration.ready didn't work)
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        try {
            navigator.serviceWorker.controller.postMessage({
                type: 'STOCK_ALERT',
                title: title,
                body: body,
                icon: iconUrl,
                badge: iconUrl,
                tag: 'stock-alert-' + Date.now()
            });
            console.log('[NOTIF] ✅ Notification sent via postMessage');
            return;
        } catch (err) {
            console.error('[NOTIF] postMessage failed:', err);
        }
    }

    // METHOD 3: Desktop-only fallback (new Notification)
    // This will NOT work on Android PWA, only desktop browsers
    try {
        new Notification(title, { 
            body: body, 
            icon: iconUrl,
            requireInteraction: true
        });
        console.log('[NOTIF] ✅ Fallback desktop notification sent');
    } catch (e) {
        console.error('[NOTIF] All notification methods failed:', e);
    }
}

window.requestNotifPermission = async function() {
    if (!('Notification' in window)) {
        showToast('Notifications not supported in this browser', 'error');
        return;
    }

    try {
        const permission = await Notification.requestPermission();
        console.log('Notification permission result:', permission);

        if (permission === 'granted') {
            showToast('Notifications enabled!', 'success');

            // Send test notification using SW (required for mobile)
            if ('serviceWorker' in navigator) {
                try {
                    const reg = await navigator.serviceWorker.ready;
                    await reg.showNotification('Stock Space 📦', {
                        body: 'You will now receive alerts when items run low!',
                        icon: './icon-512.png',
                        badge: './icon-512.png',
                        tag: 'test-' + Date.now(),
                        requireInteraction: true,
                        actions: [
                            { action: 'view', title: 'View Dashboard' },
                            { action: 'dismiss', title: 'Dismiss' }
                        ]
                    });
                    console.log('[NOTIF] Test notification sent via SW');
                } catch (err) {
                    console.error('[NOTIF] Test notification failed:', err);
                    // Desktop fallback
                    try {
                        new Notification('Stock Space', {
                            body: 'You will now receive alerts when items run low!',
                            icon: './icon-512.png'
                        });
                    } catch(e) {}
                }
            } else {
                // Desktop fallback
                try {
                    new Notification('Stock Space', {
                        body: 'You will now receive alerts when items run low!',
                        icon: './icon-512.png'
                    });
                } catch(e) {}
            }
        } else {
            localStorage.setItem('notifPromptDismissed', 'true');
            showToast('Notifications disabled', 'warning');
        }
    } catch (err) {
        console.error('Permission request error:', err);
    }

    const modal = document.getElementById('notifPermissionModal');
    if (modal) modal.style.display = 'none';
};

function showLowStockModal(lowItems) {
    const list = document.getElementById('lowStockItemsListContainer');
    if (!list) return;

    list.innerHTML = lowItems.map(p => `
        <div class="low-stock-item animate-slide-in">
            <div class="low-stock-icon">⚠️</div>
            <div class="low-stock-info">
                <strong>${escapeHtml(p.name)}</strong>
                <span>${p.quantity} remaining (limit: ${p.alert_limit})</span>
            </div>
        </div>
    `).join('');

    document.getElementById('warningModal').style.display = 'flex';
}

function updateSummary(productList) {
    const totalCount = document.getElementById('totalProductsCount');
    if (totalCount) totalCount.textContent = productList.length;
}

// ==================== REVENUE (COMPLETELY FIXED) ====================

function updateTotalRevenue(sales) {
    const display = document.getElementById('totalRevenueDisplayNode');
    if (!display) return;

    // BULLETPROOF: Force sum to stay a number, never a string
    let total = 0;
    for (const s of sales) {
        let revenue = 0;

        // Try revenue field first
        if (s.revenue !== undefined && s.revenue !== null) {
            revenue = Number(s.revenue);
        } 
        // Fallback: price_sold * quantity_sold
        else if (s.price_sold !== undefined && s.quantity_sold !== undefined) {
            revenue = Number(s.price_sold) * Number(s.quantity_sold);
        }

        // Guard against NaN
        if (isNaN(revenue)) revenue = 0;

        total = total + revenue;  // explicit: number + number
    }

    // Final guard
    if (isNaN(total)) total = 0;

    console.log('[REVENUE] Total calculated:', total, 'from', sales.length, 'sales');
    display.textContent = '₱' + total.toFixed(2);
    display.setAttribute('data-raw-revenue', total);
}

function updateProductsPopup(productList) {
    const tbody = document.getElementById('productsPopupBody');
    if (!tbody) return;
    if (productList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#64748b; padding: 24px;">No items registered.</td></tr>';
        return;
    }
    tbody.innerHTML = productList.map(p => `
        <tr>
            <td>${escapeHtml(p.name)}</td>
            <td><span class="badge badge-blue">${escapeHtml(p.category)}</span></td>
            <td>₱${p.price ? Number(p.price).toFixed(2) : '0.00'}</td>
            <td>${p.quantity}</td>
        </tr>
    `).join('');
}

function updateRevenuePopup(sales) {
    const tbody = document.getElementById('revenueModalTableBody');
    if (!tbody) return;
    if (sales.length === 0) {
        tbody.innerHTML = '<tr id="revenueEmptyStatePlaceholderRow"><td colspan="5" style="text-align:center; color:#64748b; padding: 24px;">No items sold on this profile yet.</td></tr>';
        return;
    }
    tbody.innerHTML = sales.map(s => {
        const date = s.sold_at ? (typeof s.sold_at.toDate === 'function' ? new Date(s.sold_at.toDate()) : new Date(s.sold_at)).toLocaleString() : 'N/A';

        let revenue = 0;
        if (s.revenue !== undefined && s.revenue !== null) {
            revenue = Number(s.revenue);
        } else if (s.price_sold !== undefined && s.quantity_sold !== undefined) {
            revenue = Number(s.price_sold) * Number(s.quantity_sold);
        }
        if (isNaN(revenue)) revenue = 0;

        return `
        <tr class="animate-fade-in">
            <td>${escapeHtml(s.product_name)}</td>
            <td><span class="badge badge-pink">${escapeHtml(s.category)}</span></td>
            <td>${s.quantity_sold || 0}</td>
            <td style="color: #22c55e; font-weight: 700;">₱${revenue.toFixed(2)}</td>
            <td style="font-size: 12px; color: #94a3b8;">${date}</td>
        </tr>
    `}).join('');
}

function updateActivityPopup(logs) {
    const tbody = document.getElementById('auditLogBookTableBody');
    if (!tbody) return;

    const allLogs = [...instantActivityLogs, ...logs];
    const seen = new Set();
    const uniqueLogs = allLogs.filter(log => {
        const key = `${log.product_name}-${log.action_type}-${log.quantity}-${log.created_at}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    if (uniqueLogs.length === 0) {
        tbody.innerHTML = '<tr id="activityEmptyRow"><td colspan="5" style="text-align:center; color:#64748b; padding: 24px;">No activity recorded yet.</td></tr>';
        return;
    }

    tbody.innerHTML = uniqueLogs.map((log, index) => {
        const date = log.created_at ? (typeof log.created_at.toDate === 'function' ? new Date(log.created_at.toDate()) : new Date(log.created_at)).toLocaleString() : 'N/A';
        const actionColor = log.action_type === 'SELL' ? '#ef4444' : log.action_type === 'RESTOCK' ? '#22c55e' : '#0284c7';
        const revenueVal = Number(log.revenue) || 0;
        const revenueText = revenueVal > 0 ? `<span style="color: #22c55e; font-weight: 700;">₱${revenueVal.toFixed(2)}</span>` : '<span style="color: #94a3b8;">—</span>';
        return `
        <tr class="animate-fade-in" style="animation-delay: ${index * 0.05}s">
            <td style="font-size: 12px; color: #94a3b8;">${date}</td>
            <td>${escapeHtml(log.product_name)}</td>
            <td><span style="color: ${actionColor}; font-weight: 700;">${log.action_type}</span></td>
            <td>${log.quantity || 0}</td>
            <td>${revenueText}</td>
        </tr>
    `}).join('');
}

function addInstantActivity(productName, action, quantity, revenue) {
    const log = {
        product_name: productName,
        action_type: action,
        quantity: quantity,
        revenue: revenue,
        created_at: new Date()
    };
    instantActivityLogs.unshift(log);
    if (instantActivityLogs.length > 10) instantActivityLogs.pop();

    const tbody = document.getElementById('auditLogBookTableBody');
    if (tbody) {
        updateActivityPopup([]);
    }
}

function updateAlertsPopup(alerts) {
    const tbody = document.getElementById('alertsHistoryTableBody');
    if (!tbody) return;
    if (alerts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#64748b; padding: 24px;">No stock alerts recorded yet.</td></tr>';
        return;
    }
    tbody.innerHTML = alerts.map((alert, index) => {
        const date = alert.created_at ? (typeof alert.created_at.toDate === 'function' ? new Date(alert.created_at.toDate()) : new Date(alert.created_at)).toLocaleString() : 'N/A';
        return `
        <tr class="animate-fade-in" style="animation-delay: ${index * 0.05}s">
            <td style="font-size: 12px; color: #94a3b8;">${date}</td>
            <td>${escapeHtml(alert.product_name)}</td>
            <td><span style="color: #ef4444; font-weight: 700;">${alert.quantity}</span></td>
            <td>${alert.alert_limit}</td>
        </tr>
    `}).join('');
}

// ==================== ALERTS PANEL ====================
window.openAlertsPanel = function() {
    const panel = document.getElementById('alertsPanel');
    if (panel) panel.classList.add('alerts-panel-open');
};

window.closeAlertsPanel = function() {
    const panel = document.getElementById('alertsPanel');
    if (panel) panel.classList.remove('alerts-panel-open');
};

document.addEventListener('click', function(e) {
    const panel = document.getElementById('alertsPanel');
    if (!panel) return;
    if (!panel.classList.contains('alerts-panel-open')) return;
    const sidebar = document.querySelector('.sidebar-nav');
    const isInsidePanel = panel.contains(e.target);
    const isOnSidebar = sidebar && sidebar.contains(e.target);
    if (!isInsidePanel && !isOnSidebar) {
        closeAlertsPanel();
    }
});

function updateAlertsPanel() {
    const content = document.getElementById('alertsPanelContent');
    if (!content) return;

    if (lowStockHistory.length === 0) {
        content.innerHTML = '<div class="alerts-empty">No low stock alerts</div>';
        return;
    }

    content.innerHTML = lowStockHistory.map(alert => `
        <div class="alert-history-item animate-slide-in">
            <div class="alert-history-name">${escapeHtml(alert.name)}</div>
            <div class="alert-history-details">
                <span class="alert-history-qty">${alert.quantity} left</span>
                <span class="alert-history-time">${alert.timestamp}</span>
            </div>
        </div>
    `).join('');
}

// ==================== MODAL FUNCTIONS ====================
window.openPopupModal = function(id) {
    const modal = document.getElementById(id);
    if (modal) modal.style.display = 'flex';
};

window.closePopupModal = function(id) {
    const modal = document.getElementById(id);
    if (!modal || modal.style.display === 'none') return;
    const modalBox = modal.querySelector('.modal-box');
    modal.classList.add('closing');
    if (modalBox) modalBox.classList.add('closing');
    setTimeout(() => {
        modal.style.display = 'none';
        modal.classList.remove('closing');
        if (modalBox) modalBox.classList.remove('closing');
    }, 300);
};

window.closePopupModalOnBackground = function(e, id) {
    if (e.target === document.getElementById(id)) {
        closePopupModal(id);
    }
};

window.openAddModal = function() {
    const modal = document.getElementById('productModal');
    const title = document.getElementById('modalTitle');
    const form = document.getElementById('modalForm');
    if (modal) modal.style.display = 'flex';
    if (title) title.textContent = 'Add Product';
    if (form) form.reset();
    const idField = document.getElementById('form_product_id');
    if (idField) idField.value = '';
    const qtyWrapper = document.getElementById('qty_input_wrapper');
    if (qtyWrapper) qtyWrapper.style.display = 'block';
};

window.closeModal = function() {
    const modal = document.getElementById('productModal');
    if (!modal || modal.style.display === 'none') return;
    const modalBox = modal.querySelector('.modal-box');
    modal.classList.add('closing');
    if (modalBox) modalBox.classList.add('closing');
    setTimeout(() => {
        modal.style.display = 'none';
        modal.classList.remove('closing');
        if (modalBox) modalBox.classList.remove('closing');
    }, 300);
};

window.openFocusModal = function(product) {
    currentFocusProduct = product;
    document.getElementById('focusTitle').textContent = product.name;
    document.getElementById('focusCategory').textContent = product.category;
    document.getElementById('focusImage').src = product.image_url || 'https://cdn-icons-png.flaticon.com/512/679/679720.png';
    document.getElementById('focusPrice').textContent = '₱' + (product.price ? Number(product.price).toFixed(2) : '0.00');
    document.getElementById('focusStock').textContent = product.quantity;

    switchFocusFormConsoleMode('SELL');
    document.getElementById('focus_quantity_input').value = 1;
    updateLivePrice();

    document.getElementById('focusModal').style.display = 'flex';
};

window.switchFocusFormConsoleMode = function(mode) {
    document.getElementById('tabSellModeBtn').classList.toggle('active-tab', mode === 'SELL');
    document.getElementById('tabRestockModeBtn').classList.toggle('active-tab', mode === 'RESTOCK');
    document.getElementById('inputFormBoxDynamicLabel').textContent = 
        mode === 'SELL' ? 'How many items are you distributing?' : 'How many items are you restocking?';
    document.getElementById('valuationDynamicTitle').textContent = 
        mode === 'SELL' ? 'Gross Projected Income' : 'Total Restock Cost';
    document.getElementById('mainConsoleActionButton').textContent = 
        mode === 'SELL' ? 'Confirm Sale Bundle' : 'Confirm Restock Bundle';
    document.getElementById('mainConsoleActionButton').style.background = 
        mode === 'SELL' ? '#ef4444' : '#22c55e';
    document.getElementById('mainConsoleActionButton').style.boxShadow = 
        mode === 'SELL' ? '0 6px 16px rgba(239, 68, 68, 0.25)' : '0 6px 16px rgba(34, 197, 94, 0.25)';

    updateLivePrice();
};

window.updateLivePrice = function() {
    const qty = parseInt(document.getElementById('focus_quantity_input').value) || 0;
    const priceText = document.getElementById('focusPrice').textContent.replace('₱', '').replace(',', '');
    const price = parseFloat(priceText) || 0;
    const total = qty * price;
    const isSell = document.getElementById('tabSellModeBtn').classList.contains('active-tab');
    document.getElementById('bulkTotalDisplay').textContent = '₱' + total.toFixed(2);
    document.getElementById('bulkTotalDisplay').style.color = isSell ? '#22c55e' : '#0284c7';
};

window.handleBundleAction = async function() {
    const qty = parseInt(document.getElementById('focus_quantity_input').value) || 1;
    if (!currentFocusProduct) return;

    const isSell = document.getElementById('tabSellModeBtn').classList.contains('active-tab');
    const product = currentFocusProduct;

    if (isSell) {
        if (product.quantity < qty) {
            showToast('Not enough stock!', 'error');
            return;
        }
        await updateStock(product.id, product.quantity - qty, (product.items_sold || 0) + qty, 'SELL', qty);
        addInstantActivity(product.name, 'SELL', qty, (Number(product.price) || 0) * qty);
        showActionToast(`Sold x${qty} ${product.name}`, 'sell');
    } else {
        await updateStock(product.id, product.quantity + qty, product.items_sold || 0, 'RESTOCK', qty);
        addInstantActivity(product.name, 'RESTOCK', qty, 0);
        showActionToast(`Restocked x${qty} ${product.name}`, 'restock');
    }
    closePopupModal('focusModal');
};

window.handleFocusQuickSell = async function(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!currentFocusProduct) return;
    await sellOne(currentFocusProduct.id);
};

window.handleFocusQuickRestock = async function(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!currentFocusProduct) return;
    await restockOne(currentFocusProduct.id);
};

window.editProduct = function(id) {
    const product = products.find(p => p.id === id);
    if (!product) return;

    document.getElementById('modalTitle').textContent = 'Edit Product';
    document.getElementById('form_product_id').value = product.id;
    document.getElementById('form_name').value = product.name;
    document.getElementById('form_category').value = product.category;
    document.getElementById('form_price').value = product.price;
    document.getElementById('form_alert_limit').value = product.alert_limit;

    const qtyWrapper = document.getElementById('qty_input_wrapper');
    if (qtyWrapper) qtyWrapper.style.display = 'none';

    document.getElementById('productModal').style.display = 'flex';
};

window.deleteProductItem = async function(id) {
    const product = products.find(p => p.id === id);
    if (!product) return;

    window.productToDelete = product;
    openCuteModal('deleteConfirmModal');
};

window.confirmDeleteProduct = async function() {
    const product = window.productToDelete;
    if (!product) return;

    closeCuteModal('deleteConfirmModal');
    try {
        await deleteProduct(product.id);
        showToast(`Deleted ${product.name}`);
        window.productToDelete = null;
    } catch (err) {
        showToast('Failed to delete product', 'error');
    }
};

// ==================== CATEGORY MODAL ====================
window.openCategoryModeModal = function() {
    const container = document.getElementById('categoryModeContainer');
    if (!container) return;

    if (products.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📂</div><div class="empty-state-title">No Products Yet</div><p class="empty-state-desc">Add some products to see them organized by category.</p></div>';
    } else {
        const grouped = products.reduce((acc, p) => {
            const cat = p.category || 'Uncategorized';
            if (!acc[cat]) acc[cat] = [];
            acc[cat].push(p);
            return acc;
        }, {});

        container.innerHTML = Object.entries(grouped).map(([cat, items]) => `
            <div class="category-group" style="margin-bottom: 20px;">
                <div style="font-size: 16px; font-weight: 700; color: #0284c7; margin-bottom: 10px; padding: 8px 16px; background: #e0f2fe; border-radius: 12px;">${escapeHtml(cat)} (${items.length})</div>
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px;">
                    ${items.map(item => `
                        <div style="background: #f8fafc; padding: 12px; border-radius: 12px; border: 1px solid #e2e8f0;">
                            <div style="font-weight: 700; color: #1e293b; font-size: 14px;">${escapeHtml(item.name)}</div>
                            <div style="font-size: 12px; color: #64748b; margin-top: 4px;">Stock: ${item.quantity} | ₱${item.price ? Number(item.price).toFixed(2) : '0.00'}</div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `).join('');
    }

    openPopupModal('categoryModePopup');
};

// ==================== TOAST & ALERTS ====================
window.showActionToast = function(message, type = 'sell') {
    let container = document.getElementById('actionToastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'actionToastContainer';
        container.style.cssText = `
            position: fixed;
            top: 24px;
            right: 24px;
            z-index: 999999;
            display: flex;
            flex-direction: column;
            gap: 10px;
            pointer-events: none;
        `;
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    const bgColor = type === 'sell' ? '#22c55e' : '#0284c7';
    const icon = type === 'sell' ? '💰' : '📦';

    toast.style.cssText = `
        background: ${bgColor};
        color: white;
        padding: 14px 22px;
        border-radius: 14px;
        font-weight: 700;
        font-size: 14px;
        box-shadow: 0 8px 30px rgba(0,0,0,0.2);
        opacity: 0;
        transform: translateX(50px);
        transition: opacity 2s ease, transform 2s ease;
        pointer-events: auto;
        min-width: 220px;
        text-align: center;
    `;
    toast.innerHTML = `${icon} ${message}`;

    container.appendChild(toast);
    toast.offsetHeight;

    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(0)';
    });

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(50px)';
        setTimeout(() => {
            if (toast.parentNode) toast.remove();
        }, 2000);
    }, 5000);
};

window.confirmLogout = async function() {
    closePopupModal('logoutConfirmModal');
    try {
        if (unsubscribeProducts) unsubscribeProducts();
        if (unsubscribeSales) unsubscribeSales();
        if (unsubscribeActivity) unsubscribeActivity();
        if (unsubscribeAlerts) unsubscribeAlerts();
        await logoutUser();
    } catch (err) {
        console.error('Logout error:', err);
        window.location.href = 'index.html';
    }
};

window.filterActivityLog = function(filter, clickedBtn) {
    currentActivityFilter = filter;
    document.querySelectorAll('.activity-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    if (clickedBtn) clickedBtn.classList.add('active');
    if (window.allActivityLogs) {
        renderActivityTable(window.allActivityLogs, filter);
    }
};

window.showToast = function(message, type = 'success') {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type} animate-slide-in`;
    toast.innerHTML = `
        <span class="toast-message">${escapeHtml(message)}</span>
        <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
    `;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('animate-fade-out');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
};

// ==================== FLOATING ALERT (FIXED) ====================
let floatingAlertTimer = null;

function renderFloatingAlert(lowItems) {
    let alert = document.getElementById('floatingStockAlert');
    if (!alert) {
        alert = document.createElement('div');
        alert.id = 'floatingStockAlert';
        alert.className = 'floating-alert';
        alert.onclick = function(e) {
            e.stopPropagation();
            window.openAlertsPanel();
        };
        document.body.appendChild(alert);
    }

    if (floatingAlertTimer) {
        clearTimeout(floatingAlertTimer);
        floatingAlertTimer = null;
    }

    alert.classList.remove('floating-alert-closing');
    alert.style.display = 'flex';
    alert.style.opacity = '1';
    alert.style.transform = 'translateY(0)';

    alert.innerHTML = `
        <span class="floating-alert-icon">⚠️</span>
        <span class="floating-alert-text">${lowItems.length} item(s) low on stock</span>
        <span class="floating-alert-hint">Click to view →</span>
    `;
}

function removeFloatingAlert() {
    const alert = document.getElementById('floatingStockAlert');
    if (!alert || alert.style.display === 'none') return;

    if (floatingAlertTimer) {
        clearTimeout(floatingAlertTimer);
        floatingAlertTimer = null;
    }

    alert.classList.add('floating-alert-closing');
    setTimeout(() => {
        alert.style.display = 'none';
        alert.classList.remove('floating-alert-closing');
    }, 500);
}

// ==================== NOTIFICATION PERMISSION HANDLERS ====================

window.dismissNotifPermission = function() {
    localStorage.setItem('notifPromptDismissed', 'true');
    const modal = document.getElementById('notifPermissionModal');
    if (modal) modal.style.display = 'none';
};

window.enableNotifPermission = async function() {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
        showToast('Notifications enabled!', 'success');
        // Use SW for mobile PWA - new Notification() blocked on phones
        if ('serviceWorker' in navigator) {
            try {
                const reg = await navigator.serviceWorker.ready;
                await reg.showNotification('Stock Space 📦', {
                    body: 'You will now get alerts when items run low!',
                    icon: './icon-512.png',
                    badge: './icon-512.png',
                    tag: 'welcome-notif',
                    requireInteraction: true
                });
            } catch (err) {
                console.error('[NOTIF] Welcome notification failed:', err);
            }
        }
    } else {
        localStorage.setItem('notifPromptDismissed', 'true');
    }
    const modal = document.getElementById('notifPermissionModal');
    if (modal) modal.style.display = 'none';
};

window.renderActivityTable = function(logs, filter = 'ALL') {
    const tbody = document.getElementById('auditLogBookTableBody');
    if (!tbody) return;

    let filtered = logs;
    if (filter !== 'ALL') {
        filtered = logs.filter(l => l.action_type === filter);
    }

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr id="activityEmptyRow"><td colspan="5" style="text-align:center; color:#64748b; padding: 24px;">No activity recorded yet.</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map((log, index) => {
        const date = log.created_at ? (typeof log.created_at.toDate === 'function' ? new Date(log.created_at.toDate()) : new Date(log.created_at)).toLocaleString() : 'N/A';
        const actionColor = log.action_type === 'SELL' ? '#ef4444' : log.action_type === 'RESTOCK' ? '#22c55e' : '#0284c7';
        const revenueVal = Number(log.revenue) || 0;
        const revenueText = revenueVal > 0 ? `<span style="color: #22c55e; font-weight: 700;">₱${revenueVal.toFixed(2)}</span>` : '<span style="color: #94a3b8;">—</span>';
        return `
        <tr class="animate-fade-in" style="animation-delay: ${index * 0.05}s">
            <td style="font-size: 12px; color: #94a3b8;">${date}</td>
            <td>${escapeHtml(log.product_name)}</td>
            <td><span style="color: ${actionColor}; font-weight: 700;">${log.action_type}</span></td>
            <td>${log.quantity || 0}</td>
            <td>${revenueText}</td>
        </tr>`;
    }).join('');
};

// ==================== CUTE MODAL HELPERS ====================

window.openCuteModal = function(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.add('active');
};

window.closeCuteModal = function(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.remove('active');
};

// ==================== SIDEBAR TOGGLE ====================
window.toggleSidebar = function() {
    const sidebar = document.querySelector('.sidebar-nav');
    const hamburger = document.querySelector('.hamburger-indicator');
    if (sidebar) {
        sidebar.classList.toggle('open');
    }
    if (hamburger) {
        hamburger.classList.toggle('active');
    }
};

// Close sidebar when clicking outside
document.addEventListener('click', function(e) {
    const sidebar = document.querySelector('.sidebar-nav');
    const hamburger = document.querySelector('.hamburger-indicator');
    if (!sidebar || !hamburger) return;

    // If sidebar is open and click is outside sidebar and not on hamburger
    if (sidebar.classList.contains('open')) {
        const isClickInsideSidebar = sidebar.contains(e.target);
        const isClickOnHamburger = hamburger.contains(e.target);
        if (!isClickInsideSidebar && !isClickOnHamburger) {
            sidebar.classList.remove('open');
            hamburger.classList.remove('active');
        }
    }
});