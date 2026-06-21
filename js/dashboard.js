import { subscribeToProducts, updateStock, addProduct, deleteProduct, subscribeToSales, subscribeToActivity } from './db.js';
import { logoutUser } from './auth.js';
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { db } from './firebase-config.js';

let products = [];
let unsubscribeProducts = null;
let unsubscribeSales = null;
let unsubscribeActivity = null;
let currentFocusProduct = null;
let lowStockHistory = [];

// Initialize dashboard
document.addEventListener('DOMContentLoaded', () => {
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
    
    // Setup event listeners
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            try {
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
        modalForm.addEventListener('submit', async (e) => {
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
            
            if (id) {
                const productRef = doc(db, 'products', id);
                await updateDoc(productRef, {
                    name: data.name,
                    category: data.category,
                    price: data.price,
                    alert_limit: data.alert_limit
                });
                showToast('Product updated successfully');
            } else {
                await addProduct(data);
                showToast('Product added successfully');
            }
            closeModal();
        });
    }
    
    // Warning modal dismiss
    const warningIgnoreBtn = document.getElementById('warningIgnoreBtn');
    if (warningIgnoreBtn) {
        warningIgnoreBtn.addEventListener('click', () => {
            document.getElementById('warningModal').style.display = 'none';
        });
    }
    
    // Network status
    updateNetworkStatus();
    window.addEventListener('online', updateNetworkStatus);
    window.addEventListener('offline', updateNetworkStatus);
});

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
        grid.innerHTML = '<div class="empty-view">Your inventory deck is empty. Tap add to start!</div>';
        return;
    }
    
    productList.forEach(product => {
        const isLow = product.quantity <= product.alert_limit;
        const card = document.createElement('div');
        card.className = `product-card cat-${getCategoryClass(product.category)}`;
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
                    <button class="btn-action btn-sell" onclick="event.stopPropagation(); sellOne('${product.id}')">Sold (-1)</button>
                    <button class="btn-action btn-restock" onclick="event.stopPropagation(); restockOne('${product.id}')">Restock (+1)</button>
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
    const product = products.find(p => p.id === productId);
    if (!product || product.quantity < 1) {
        showToast('Not enough stock!', 'error');
        return;
    }
    
    await updateStock(productId, product.quantity - 1, (product.items_sold || 0) + 1, 'SELL');
    showToast(`Sold 1x ${product.name}`);
}

async function restockOne(productId) {
    const product = products.find(p => p.id === productId);
    if (!product) return;
    
    await updateStock(productId, product.quantity + 1, product.items_sold || 0, 'RESTOCK');
    showToast(`Restocked 1x ${product.name}`);
}

function checkLowStock(productList) {
    const lowItems = productList.filter(p => p.quantity <= p.alert_limit);
    
    // Record alerts with timestamp
    if (lowItems.length > 0) {
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
        renderFloatingAlert(lowItems);
        updateAlertsPanel();
        if (Notification.permission === 'granted') {
            new Notification('Stock Alert', {
                body: `${lowItems.length} items are low on stock`
            });
        }
    } else {
        removeFloatingAlert();
        updateAlertsPanel();
    }
}

function updateSummary(productList) {
    const totalCount = document.getElementById('totalProductsCount');
    if (totalCount) totalCount.textContent = productList.length;
}

function updateTotalRevenue(sales) {
    const display = document.getElementById('totalRevenueDisplayNode');
    if (!display) return;
    const total = sales.reduce((sum, s) => sum + (s.price_sold * s.quantity_sold), 0);
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
        const date = s.sold_at ? new Date(s.sold_at.toDate()).toLocaleString() : 'N/A';
        return `
        <tr>
            <td>${escapeHtml(s.product_name)}</td>
            <td><span class="badge badge-pink">${escapeHtml(s.category)}</span></td>
            <td>${s.quantity_sold}</td>
            <td style="color: #22c55e; font-weight: 700;">₱${(s.price_sold * s.quantity_sold).toFixed(2)}</td>
            <td style="font-size: 12px; color: #94a3b8;">${date}</td>
        </tr>
    `}).join('');
}

function updateActivityPopup(logs) {
    const tbody = document.getElementById('auditLogBookTableBody');
    if (!tbody) return;
    if (logs.length === 0) {
        tbody.innerHTML = '<tr id="activityEmptyRow"><td colspan="4" style="text-align:center; color:#64748b; padding: 24px;">No activity recorded yet.</td></tr>';
        return;
    }
    tbody.innerHTML = logs.map(log => {
        const date = log.created_at ? new Date(log.created_at.toDate()).toLocaleString() : 'N/A';
        const actionColor = log.action_type === 'SELL' ? '#ef4444' : log.action_type === 'RESTOCK' ? '#22c55e' : '#0284c7';
        return `
        <tr>
            <td style="font-size: 12px; color: #94a3b8;">${date}</td>
            <td>${escapeHtml(log.product_name)}</td>
            <td><span style="color: ${actionColor}; font-weight: 700;">${log.action_type}</span></td>
            <td>Qty: ${log.quantity}</td>
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

function updateAlertsPanel() {
    const content = document.getElementById('alertsPanelContent');
    if (!content) return;
    
    if (lowStockHistory.length === 0) {
        content.innerHTML = '<div class="alerts-empty">No low stock alerts</div>';
        return;
    }
    
    content.innerHTML = lowStockHistory.map(alert => `
        <div class="alert-history-item">
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
    if (modal) modal.style.display = 'none';
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
    if (modal) modal.style.display = 'none';
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
        await updateStock(product.id, product.quantity - qty, (product.items_sold || 0) + qty, 'SELL');
        showToast(`Sold ${qty}x ${product.name}`);
    } else {
        await updateStock(product.id, product.quantity + qty, product.items_sold || 0, 'RESTOCK');
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
window.showToast = function(message, type = 'success') {
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
        <button class="toast-close" onclick="this.parentElement.remove()">×</button>
    `;
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
};

window.renderFloatingAlert = function(items) {
    const container = document.getElementById('ignoredAlertsContainer');
    if (!container) return;
    container.innerHTML = items.map(item => 
        `<div class="alert-chip">⚠️ ${escapeHtml(item.name)}: ${item.quantity} left</div>`
    ).join('');
    container.style.display = 'flex';
};

window.removeFloatingAlert = function() {
    const container = document.getElementById('ignoredAlertsContainer');
    if (!container) return;
    container.innerHTML = '';
    container.style.display = 'none';
};

// ==================== CATEGORY MODE ====================
window.openCategoryModeModal = function() {
    const grouped = products.reduce((acc, p) => {
        const cat = p.category || 'Uncategorized';
        acc[cat] = acc[cat] || [];
        acc[cat].push(p);
        return acc;
    }, {});
    
    const html = Object.entries(grouped).map(([cat, items]) => `
        <div style="margin-bottom: 24px;">
            <h4 style="color: #0284c7; margin-bottom: 12px; font-size: 16px; text-transform: uppercase; letter-spacing: 0.5px;">${escapeHtml(cat)}</h4>
            ${items.map(p => `
                <div style="padding: 12px 16px; border-bottom: 1px solid #f1f5f9; display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-weight: 600; color: #1e293b;">${escapeHtml(p.name)}</span>
                    <span style="color: ${p.quantity <= p.alert_limit ? '#ef4444' : '#22c55e'}; font-weight: 700;">${p.quantity} in stock</span>
                </div>
            `).join('')}
        </div>
    `).join('');
    
    document.getElementById('categoryModeContainer').innerHTML = html || '<div style="text-align:center; color:#94a3b8; padding: 40px;">No products to categorize.</div>';
    openPopupModal('categoryModePopup');
};

// ==================== STOCK SCAN ====================
window.executeImmediateStockScan = function(showModal = true) {
    const lowItems = products.filter(p => p.quantity <= p.alert_limit);
    if (lowItems.length > 0 && showModal) {
        const list = document.getElementById('lowStockItemsListContainer');
        list.innerHTML = lowItems.map(p => `
            <div style="padding: 14px; background: #fff1f2; border-radius: 12px; margin-bottom: 10px; border-left: 4px solid #ef4444;">
                <strong style="color: #991b1b;">${escapeHtml(p.name)}</strong>
                <span style="color: #64748b; margin-left: 8px;">— ${p.quantity} remaining (limit: ${p.alert_limit})</span>
            </div>
        `).join('');
        document.getElementById('warningModal').style.display = 'flex';
    } else if (lowItems.length === 0 && showModal) {
        showToast('All stock levels are healthy!', 'success');
    }
};