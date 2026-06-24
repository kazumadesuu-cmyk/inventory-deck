// Handle push notifications for low stock
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Stock Space Alert';
  const options = {
    body: data.body || 'Low stock warning!',
    icon: 'https://cdn-icons-png.flaticon.com/512/564/564619.png',
    badge: 'https://cdn-icons-png.flaticon.com/512/564/564619.png',
    tag: data.tag || 'stock-alert',
    requireInteraction: true,
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
  event.notification.close();
  if (event.action === 'view') {
    event.waitUntil(
      clients.matchAll({ type: 'window' }).then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) return client.focus();
        }
        if (clients.openWindow) return clients.openWindow('./dashboard.html');
      })
    );
  }
});