self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url;
  if (!url) return;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const matchingClient = clients.find((client) => client.url === url);
      if (matchingClient) {
        return matchingClient.focus();
      }

      return self.clients.openWindow(url);
    })
  );
});
