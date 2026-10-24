// The hosted dashboard's service worker: shows the Web Push your own computer sends (encrypted end to end; the
// push service only relays it) and opens the dashboard when you tap one. Registered only on the hosted page.
self.addEventListener("push", (event) => {
  let msg = { title: "Overhand", body: "", url: "/" };
  try {
    msg = { ...msg, ...event.data.json() };
  } catch {
    // not JSON: show the text as is
    if (event.data) msg.body = event.data.text();
  }
  event.waitUntil(self.registration.showNotification(msg.title, { body: msg.body, icon: "icon-192.png", data: { url: msg.url }, tag: "overhand" }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin);
  // only this origin: a payload can't send a tap anywhere else
  const target = url.origin === self.location.origin ? url.href : self.location.origin;
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((list) => {
      for (const c of list) if (c.url.startsWith(self.location.origin)) return c.focus();
      return self.clients.openWindow(target);
    }),
  );
});
