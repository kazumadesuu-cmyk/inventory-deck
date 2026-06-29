// Stock Space Service Worker
const CACHE_NAME = 'stock-space-v1';

// Install event
self.addEventListener('install', (event) => {
  console.log('[SW] Service Worker installing...');
  self.skipWaiting();
});

// Activate event
self.addEventListener('activate', (event) => {
  console.log('[SW] Service Worker activated');
  event.waitUntil(self.clients.claim());
});

// Handle messages from the main page (for phone notifications)
self.addEventListener('message', (event) => {
  console.log('[SW] Message received:', event.data);
  if (event.data && event.data.type === 'STOCK_ALERT') {
    const data = event.data;
    const options = {
      body: data.body || 'Low stock warning!',
      icon: data.icon || './icon-512.png',
      badge: data.badge || './icon-512.png',
      tag: data.tag || 'stock-alert',
      requireInteraction: true,
      renotify: true,
      actions: [
        { action: 'view', title: 'View Dashboard' },
        { action: 'dismiss', title: 'Dismiss' }
      ]
    };
    console.log('[SW] Showing notification:', data.title);
    self.registration.showNotification(data.title || 'Stock Space Alert', options);
  }
});

// Handle push notifications for low stock (from server/FCM)
self.addEventListener('push', (event) => {
  console.log('[SW] Push event received');
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Stock Space Alert';
  const options = {
    body: data.body || 'Low stock warning!',
    icon: data.icon || './icon-512.png',
    badge: data.badge || './icon-512.png',
    tag: data.tag || 'stock-alert',
    requireInteraction: true,
    renotify: true,
    actions: [
      { action: 'view', title: 'View Dashboard' },
      { action: 'dismiss', title: 'Dismiss' }
    ]
  };
  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Handle notification actions
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event.action);
  event.notification.close();

  if (event.action === 'view' || !event.action) {
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        // Try to focus an existing window
        for (const client of clientList) {
          if (client.url.includes('dashboard') && 'focus' in client) {
            return client.focus();
          }
        }
        // If no existing window, open a new one
        if (clients.openWindow) {
          return clients.openWindow('./dashboard.html');
        }
      })
    );
  }
});