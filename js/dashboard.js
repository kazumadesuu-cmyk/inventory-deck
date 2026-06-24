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
            const confirmed = confirm('Are you sure you want to log out?');
            if (!confirmed) return;
            
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
        showToast('Product added successfully');
        
        // Optimistically add to activity log
        addOptimisticActivity(data.name, 'ADD', data.quantity || 0, 0);
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
        card.className = `product-card cat-${getCategoryClass(product.category)}`;
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
        
        // Show sold pop indicator
        showSoldIndicator(product.name, product.price);
        
        // Optimistically add to activity log
        addOptimisticActivity(product.name, 'SELL', 1, product.price || 0);
        
        showToast(`💰 Sold 1x ${product.name}`, 'success', 4000);
    } catch (error) {
        console.error('sellOne error:', error);
        showToast('Failed to record sale: ' + error.message, 'error');
    }
}

function showSoldIndicator(productName, price) {
    // Show a special green toast at bottom-right instead of center popup
    showToast(`💰 Sold! ₱${price ? price.toFixed(2) : '0.00'}`, 'success', 5000);
}

async function restockOne(productId) {
    try {
        const product = products.find(p => p.id === productId);
        if (!product) return;
        
        await updateStock(productId, product.quantity + 1, product.items_sold || 0, 'RESTOCK', 1);
        
        // Optimistically add to activity log
        addOptimisticActivity(product.name, 'RESTOCK', 1, 0);
        
        showToast(`📦 Restocked 1x ${product.name}`, 'success', 4000);
    } catch (error) {
        console.error('restockOne error:', error);
        showToast('Failed to record restock: ' + error.message, 'error');
    }
}

// Expose to window so inline onclick handlers work
window.sellOne = sellOne;
window.restockOne = restockOne;

let lowStockModalShownThisSession = false;

function checkLowStock(productList) {
    const lowItems = productList.filter(p => p.quantity <= p.alert_limit);
    const banner = document.getElementById('lowStockBanner');
    const bannerCount = document.getElementById('lowStockBannerCount');
    
    if (lowItems.length > 0) {
        let newAlerts = false;
        
        lowItems.forEach(item => {
            if (!alertedProductIds.has(item.id)) {
                alertedProductIds.add(item.id);
                logStockAlert(item.id, item.name, item.quantity, item.alert_limit);
                newAlerts = true;
            }
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
        
        // Update and show the homepage banner
        if (banner && bannerCount) {
            bannerCount.textContent = `${lowItems.length} item${lowItems.length > 1 ? 's' : ''}`;
            
            // Only animate if it was hidden
            if (banner.style.display === 'none') {
                banner.classList.remove('closing');
                banner.style.display = 'block';
            }
        }
        
        renderFloatingAlert(lowItems);
        updateAlertsPanel();
        
        // Only show warning modal once per session, or when NEW items go low
        if (!lowStockModalShownThisSession || newAlerts) {
            showLowStockModal(lowItems);
            lowStockModalShownThisSession = true;
        }
        
        // Only show browser notification for new alerts
        if (newAlerts && Notification.permission === 'granted') {
            new Notification('Stock Alert', {
                body: `${lowItems.length} item(s) are low on stock`
            });
        }
    } else {
        lowStockHistory = [];
        alertedProductIds.clear();
        lowStockModalShownThisSession = false;
        
        // Hide banner smoothly
        if (banner && banner.style.display !== 'none') {
            banner.classList.add('closing');
            setTimeout(() => {
                banner.style.display = 'none';
                banner.classList.remove('closing');
            }, 400);
        }
        
        removeFloatingAlert();
        updateAlertsPanel();
    }
}

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

function updateTotalRevenue(sales) {
    const display = document.getElementById('totalRevenueDisplayNode');
    if (!display) return;
    
    const total = sales.reduce((sum, s) => {
        if (s.revenue !== undefined) {
            return sum + s.revenue;
        }
        return sum + ((s.price_sold || 0) * (s.quantity_sold || 0));
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
        const revenue = s.revenue !== undefined ? s.revenue : ((s.price_sold || 0) * (s.quantity_sold || 0));
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

// Store for optimistic updates
let pendingActivityLogs = [];

function updateActivityPopup(logs) {
    const tbody = document.getElementById('auditLogBookTableBody');
    if (!tbody) return;
    
    // Combine pending (optimistic) logs with Firestore logs
    const allLogs = [...pendingActivityLogs, ...logs];
    
    if (allLogs.length === 0) {
        tbody.innerHTML = '<tr id="activityEmptyRow"><td colspan="5" style="text-align:center; color:#64748b; padding: 24px;">No activity recorded yet.</td></tr>';
        return;
    }
    
    tbody.innerHTML = allLogs.map((log, index) => {
        const date = log.created_at ? (typeof log.created_at.toDate === 'function' ? new Date(log.created_at.toDate()) : new Date(log.created_at)).toLocaleString() : 'Just now';
        const actionColor = log.action_type === 'SELL' ? '#ef4444' : log.action_type === 'RESTOCK' ? '#22c55e' : '#0284c7';
        const revenueText = log.revenue > 0 ? `<span style="color: #22c55e; font-weight: 700;">₱${log.revenue.toFixed(2)}</span>` : '<span style="color: #94a3b8;">—</span>';
        const isPending = log._pending ? 'style="opacity: 0.7;"' : '';
        return `
        <tr class="animate-fade-in" style="animation-delay: ${index * 0.05}s" ${isPending}>
            <td style="font-size: 12px; color: #94a3b8;">${date}</td>
            <td>${escapeHtml(log.product_name)}</td>
            <td><span style="color: ${actionColor}; font-weight: 700;">${log.action_type}</span></td>
            <td>${log.quantity || 0}</td>
            <td>${revenueText}</td>
        </tr>
    `}).join('');
}

// Optimistically add activity to UI immediately
function addOptimisticActivity(productName, actionType, quantity, revenue) {
    const optimisticLog = {
        product_name: productName,
        action_type: actionType,
        quantity: quantity,
        revenue: revenue,
        created_at: new Date(),
        _pending: true
    };
    
    pendingActivityLogs.unshift(optimisticLog);
    updateActivityPopup([]); // Trigger re-render with pending logs
    
    // Remove from pending after 3 seconds (Firestore should have caught up)
    setTimeout(() => {
        pendingActivityLogs = pendingActivityLogs.filter(l => l !== optimisticLog);
    }, 3000);
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

// ==================== ALERTS PANEL ====================
window.openAlertsPanel = function() {
    const panel = document.getElementById('alertsPanel');
    if (panel) panel.classList.add('alerts-panel-open');
};

window.closeAlertsPanel = function() {
    const panel = document.getElementById('alertsPanel');
    if (panel) panel.classList.remove('alerts-panel-open');
};

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
        showSoldIndicator(product.name, product.price * qty);
        
        // Optimistically add to activity log
        addOptimisticActivity(product.name, 'SELL', qty, (product.price || 0) * qty);
        
        showToast(`Sold ${qty}x ${product.name}`);
    } else {
        await updateStock(product.id, product.quantity + qty, product.items_sold || 0, 'RESTOCK', qty);
        
        // Optimistically add to activity log
        addOptimisticActivity(product.name, 'RESTOCK', qty, 0);
        
        showToast(`Restocked ${qty}x ${product.name}`);
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
    
    if (!confirm(`Are you sure you want to delete "${product.name}"?`)) return;
    
    try {
        await deleteProduct(id);
        showToast(`Deleted ${product.name}`);
    } catch (err) {
        showToast('Failed to delete product', 'error');
    }
};

// ==================== TOAST & ALERTS ====================
window.showToast = function(message, type = 'success', stayDuration = 5000) {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <span class="toast-message">${escapeHtml(message)}</span>
        <button class="toast-close" onclick="window.dismissToast(this.parentElement)">&times;</button>
    `;
    container.appendChild(toast);
    
    // Start entrance animation: 2s fade in
    toast.style.animation = 'toastFadeIn 2s cubic-bezier(0.22, 1, 0.36, 1) forwards';
    
    // After fade in (2s) + stay (5s) = 7s, start fade out (2s)
    const dismissTimer = setTimeout(() => {
        toast.style.animation = 'toastFadeOut 2s cubic-bezier(0.4, 0, 0.2, 1) forwards';
        setTimeout(() => {
            if (toast.parentElement) toast.remove();
        }, 2000);
    }, 2000 + stayDuration);
    
    // Store timer on element so manual close can clear it
    toast._dismissTimer = dismissTimer;
};

window.dismissToast = function(toast) {
    if (!toast || toast._isDismissing) return;
    toast._isDismissing = true;
    
    // Clear auto-dismiss timer if exists
    if (toast._dismissTimer) {
        clearTimeout(toast._dismissTimer);
    }
    
    // Start fade out immediately (2s)
    toast.style.animation = 'toastFadeOut 2s cubic-bezier(0.4, 0, 0.2, 1) forwards';
    setTimeout(() => {
        if (toast.parentElement) toast.remove();
    }, 2000);
};

// ==================== FLOATING ALERT ====================
let floatingAlertTimer = null;

function renderFloatingAlert(lowItems) {
    let alert = document.getElementById('floatingStockAlert');
    if (!alert) {
        alert = document.createElement('div');
        alert.id = 'floatingStockAlert';
        alert.className = 'floating-alert';
        document.body.appendChild(alert);
    }
    
    // Clear any existing timer
    if (floatingAlertTimer) {
        clearTimeout(floatingAlertTimer);
        floatingAlertTimer = null;
    }
    
    // Remove closing class if it was fading out
    alert.classList.remove('floating-alert-closing');
    alert.style.display = 'block';
    alert.style.opacity = '1';
    alert.style.transform = 'translateY(0)';
    
    alert.innerHTML = `
        <div class="floating-alert-content" onclick="window.openAlertsPanel()" style="cursor: pointer;">
            <span class="floating-alert-icon">⚠️</span>
            <span class="floating-alert-text">${lowItems.length} item(s) low on stock</span>
        </div>
        <button class="floating-alert-close" onclick="event.stopPropagation(); window.dismissFloatingAlert()">&times;</button>
    `;
    
    // NO auto-dismiss — stays until stock is restored or user clicks X
}

window.dismissFloatingAlert = function() {
    const alert = document.getElementById('floatingStockAlert');
    if (!alert || alert.style.display === 'none') return;
    
    // Clear any timer
    if (floatingAlertTimer) {
        clearTimeout(floatingAlertTimer);
        floatingAlertTimer = null;
    }
    
    // Add smooth exit animation
    alert.classList.add('floating-alert-closing');
    
    setTimeout(() => {
        alert.style.display = 'none';
        alert.classList.remove('floating-alert-closing');
    }, 500);
};

function removeFloatingAlert() {
    window.dismissFloatingAlert();
}