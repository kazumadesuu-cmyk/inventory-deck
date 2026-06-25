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

// Prevent double-recording with cooldown
let actionCooldown = false;
let cooldownTimer = null;

function startActionCooldown() {
    actionCooldown = true;
    if (cooldownTimer) clearTimeout(cooldownTimer);
    cooldownTimer = setTimeout(() => {
        actionCooldown = false;
        cooldownTimer = null;
    }, 2000); // 2 seconds cooldown
}

function isActionOnCooldown() {
    return actionCooldown;
}

 // Local cache for instant UI updates

// Initialize dashboard - wait for auth to be ready
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
    // Real-time product listener
    unsubscribeProducts = subscribeToProducts((newProducts) => {
        products = newProducts;
        renderProductCards(newProducts);
        checkLowStock(newProducts);
        updateSummary(newProducts);
        updateProductsPopup(newProducts);
    });

    // Sales listener
    unsubscribeSales = subscribeToSales((sales) => {
        updateRevenuePopup(sales);
        updateTotalRevenue(sales);
    });

    // Activity listener
    unsubscribeActivity = subscribeToActivity((logs) => {
        window.allActivityLogs = logs;
        updateActivityPopup(logs);
    });

    // Stock alerts listener
    unsubscribeAlerts = subscribeToStockAlerts((alerts) => {
        updateAlertsPopup(alerts);
    });

    // Logout button with confirmation
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            openCuteModal('logoutConfirmModal');
            return;

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
        });
    }

    // Modal form handler
    const modalForm = document.getElementById('modalForm');
    if (modalForm) {
        modalForm.addEventListener('submit', handleFormSubmit);
    }

    // Warning modal dismiss
    const warningIgnoreBtn = document.getElementById('warningIgnoreBtn');
    if (warningIgnoreBtn) {
        warningIgnoreBtn.addEventListener('click', () => {
            closePopupModal('warningModal');
        });
    }

    // Network status
    updateNetworkStatus();
    window.addEventListener('online', updateNetworkStatus);
    window.addEventListener('offline', updateNetworkStatus);

    // Request notification permission on first load (after a delay so page is ready)
    setTimeout(() => {
        maybeRequestNotificationPermission();
    }, 3000);
}

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
                <div class="stat-block"><span class="lbl">Price</span><span class="val">₱${product.price ? product.price.toFixed(2) : '0.00'}</span></div>
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

        console.log('Selling 1x', product.name, 'at price', product.price);
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

// Expose to window so inline onclick handlers work
window.sellOne = sellOne;
window.restockOne = restockOne;

// ==================== LOW STOCK CHECKING (FIXED) ====================

function checkLowStock(productList) {
    const lowItems = productList.filter(p => p.quantity <= p.alert_limit);

    // FIX 1: Clean up items that are no longer low stock
    const lowItemIds = new Set(lowItems.map(p => p.id));

    // Remove from alertedProductIds items that are no longer low
    for (const id of Array.from(alertedProductIds)) {
        if (!lowItemIds.has(id)) {
            alertedProductIds.delete(id);
        }
    }

    // Remove from lowStockHistory items that are no longer low
    lowStockHistory = lowStockHistory.filter(h => lowItemIds.has(h.id));

    // Update quantities for items still low
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

    // FIX 2: Update banner visibility based on current low items
    updateLowStockBanner(lowItems);
    updateAlertsPanel();

    // FIX 3: Show warning modal only for newly alerted items
    if (lowItems.length > 0) {
        // Find items that just became low (not previously in alertedProductIds before this check)
        const newlyAlerted = lowItems.filter(item => !alertedProductIds.has(item.id));

        if (newlyAlerted.length > 0) {
            // Add newly alerted to the set
            newlyAlerted.forEach(item => alertedProductIds.add(item.id));

            // Log to Firestore
            newlyAlerted.forEach(item => {
                logStockAlert(item.id, item.name, item.quantity, item.alert_limit);
            });

            // Show warning modal
            showLowStockModal(lowItems);

            // Send Chrome desktop notification
            sendChromeNotification(newlyAlerted);
        }
    }
}

function updateLowStockBanner(lowItems) {
    const banner = document.getElementById('lowStockBanner');
    const bannerCount = document.getElementById('lowStockBannerCount');

    if (!banner || !bannerCount) return;

    if (lowItems.length === 0) {
        // Hide banner with animation
        banner.classList.add('closing');
        setTimeout(() => {
            banner.style.display = 'none';
            banner.classList.remove('closing');
        }, 400);
    } else {
        // Show/update banner
        banner.classList.remove('closing');
        banner.style.display = 'block';
        bannerCount.textContent = `${lowItems.length} item${lowItems.length !== 1 ? 's' : ''}`;
    }
}

// ==================== CHROME NOTIFICATIONS (FIXED) ====================

function maybeRequestNotificationPermission() {
    // Only ask if not already decided and not dismissed before
    if (!('Notification' in window)) return;

    if (Notification.permission === 'default' && !localStorage.getItem('notifPromptDismissed')) {
        // Show the custom permission modal
        const modal = document.getElementById('notifPermissionModal');
        if (modal) modal.style.display = 'flex';
    }
}

function sendChromeNotification(newlyAlertedItems) {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    const totalCount = newlyAlertedItems.length;
    const productNames = newlyAlertedItems.map(item => item.name).join(', ');

    const title = totalCount === 1 
        ? '⚠️ Low Stock Alert' 
        : `⚠️ ${totalCount} Items Low on Stock`;

    const body = totalCount === 1 
        ? `${productNames} is running low! Only ${newlyAlertedItems[0].quantity} left (limit: ${newlyAlertedItems[0].alert_limit})`
        : `${productNames} are running low on stock.`;

    try {
        const notification = new Notification(title, {
            body: body,
            icon: 'https://cdn-icons-png.flaticon.com/512/564/564619.png',
            badge: 'https://cdn-icons-png.flaticon.com/512/564/564619.png',
            tag: 'stock-alert-' + Date.now(),
            requireInteraction: true,
            renotify: true
        });

        notification.onclick = () => {
            window.focus();
            openAlertsPanel();
            notification.close();
        };
    } catch (err) {
        console.error('Notification error:', err);
    }
}

window.requestNotifPermission = async function() {
    if (!('Notification' in window)) {
        showToast('Notifications not supported in this browser', 'error');
        return;
    }

    try {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            showToast('🔔 Notifications enabled!', 'success');
            // Send a test notification
            new Notification('Stock Space', {
                body: 'You will now receive alerts when items run low!',
                icon: 'https://cdn-icons-png.flaticon.com/512/564/564619.png'
            });
        } else {
            localStorage.setItem('notifPromptDismissed', 'true');
            showToast('Notifications disabled', 'warning');
        }
    } catch (err) {
        console.error('Permission request error:', err);
    }

    // Close any open permission modal
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

// ==================== REVENUE FIX ====================

function updateTotalRevenue(sales) {
    const display = document.getElementById('totalRevenueDisplayNode');
    if (!display) return;

    // FIX: Explicitly convert to numbers and handle Firestore Timestamp objects
    const total = sales.reduce((sum, s) => {
        // Try revenue field first (stored in sales_history)
        if (s.revenue !== undefined && s.revenue !== null) {
            const rev = Number(s.revenue);
            if (!isNaN(rev)) return sum + rev;
        }
        // Fallback: calculate from price_sold * quantity_sold
        const price = Number(s.price_sold) || 0;
        const qty = Number(s.quantity_sold) || 0;
        return sum + (price * qty);
    }, 0);

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
            <td>₱${p.price ? p.price.toFixed(2) : '0.00'}</td>
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
        // FIX: Calculate revenue properly with explicit number conversion
        let revenue = 0;
        if (s.revenue !== undefined && s.revenue !== null) {
            revenue = Number(s.revenue);
        } else {
            revenue = (Number(s.price_sold) || 0) * (Number(s.quantity_sold) || 0);
        }
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

    // Merge instant logs with Firestore logs, remove duplicates
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
        const revenueText = log.revenue > 0 ? `<span style="color: #22c55e; font-weight: 700;">₱${Number(log.revenue).toFixed(2)}</span>` : '<span style="color: #94a3b8;">—</span>';
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
    // Keep only last 10 instant logs to avoid buildup
    if (instantActivityLogs.length > 10) instantActivityLogs.pop();

    // Refresh the popup if it's open
    const tbody = document.getElementById('auditLogBookTableBody');
    if (tbody) {
        updateActivityPopup([]); // Will merge with instant logs
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

// Close alerts panel when clicking outside
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

    // Add closing animation classes
    modal.classList.add('closing');
    if (modalBox) modalBox.classList.add('closing');

    // Wait for animation then hide
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
    document.getElementById('focusPrice').textContent = '₱' + (product.price ? product.price.toFixed(2) : '0.00');
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
        addInstantActivity(product.name, 'SELL', qty, (product.price || 0) * qty);
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
    return;

    try {
        await deleteProduct(id);
        showToast(`Deleted ${product.name}`);
    } catch (err) {
        showToast('Failed to delete product', 'error');
    }
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
                            <div style="font-size: 12px; color: #64748b; margin-top: 4px;">Stock: ${item.quantity} | ₱${item.price ? item.price.toFixed(2) : '0.00'}</div>
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

    // Update tab styles - remove active from all, add to clicked
    document.querySelectorAll('.activity-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    if (clickedBtn) clickedBtn.classList.add('active');

    // Re-render with filter
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
        // Send a test notification
        new Notification('Stock Space', {
            body: 'You will now receive alerts when items run low!',
            icon: 'https://cdn-icons-png.flaticon.com/512/564/564619.png'
        });
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
        const revenueText = log.revenue > 0 ? `<span style="color: #22c55e; font-weight: 700;">₱${Number(log.revenue).toFixed(2)}</span>` : '<span style="color: #94a3b8;">—</span>';
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