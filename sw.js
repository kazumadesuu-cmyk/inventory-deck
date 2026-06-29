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

// FETCH HANDLER - Required for PWA install prompt
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});

// Handle messages from the main page
self.addEventListener('message', (event) => {
  console.log('[SW] Message received:', event.data);
  if (event.data && event.data.type === 'STOCK_ALERT') {
    const data = event.data;
    const options = {
      body: data.body || 'Low stock warning!',
      icon: data.icon || './icon-512.png',
      tag: data.tag || 'stock-alert',
      renotify: true,
      // Android-specific: vibration pattern
      vibrate: [200, 100, 200],
      // Android-specific: ensure it shows as heads-up notification
      requireInteraction: false,
      // Android-specific: silent false ensures sound plays
      silent: false
    };
    console.log('[SW] Showing notification:', data.title);
    self.registration.showNotification(data.title || 'Stock Space Alert', options);
  }
});

// Handle push notifications
self.addEventListener('push', (event) => {
  console.log('[SW] Push event received');
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Stock Space Alert';
  const options = {
    body: data.body || 'Low stock warning!',
    icon: data.icon || './icon-512.png',
    tag: 'stock-alert-' + Date.now(),
    renotify: true,
    vibrate: [300, 100, 300, 100, 300],
    requireInteraction: false,
    silent: false,
    priority: 'high'
  };
  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event.action);
  event.notification.close();
  
  if (event.action === 'view' || !event.action) {
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes('dashboard') && 'focus' in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow('./dashboard.html');
        }
      })
    );
  }
});

// Background sync - keeps SW alive
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync:', event.tag);
});

// Periodic background sync (if supported)
self.addEventListener('periodicsync', (event) => {
  console.log('[SW] Periodic sync:', event.tag);
});