// Ysecurity Service Worker — Background Push & Tracking
const API_BASE = self.location.origin + "/api";
let deviceId = null;
let deviceToken = null;

// On install, activate immediately
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// Load cached registration data
async function getRegistration() {
  if (deviceId && deviceToken) return { deviceId, deviceToken };
  // Try to get from a client
  const clients = await self.clients.matchAll({ type: "window" });
  for (const client of clients) {
    try {
      const ch = new MessageChannel();
      const p = new Promise((resolve) => {
        ch.port1.onmessage = (e) => resolve(e.data);
        setTimeout(() => resolve(null), 2000);
      });
      client.postMessage({ type: "GET_REGISTRATION" }, [ch.port2]);
      const data = await p;
      if (data && data.deviceId) {
        deviceId = data.deviceId;
        deviceToken = data.deviceToken;
        return data;
      }
    } catch (e) {}
  }
  return null;
}

// Client sends registration data to the service worker
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "REGISTER_DEVICE") {
    deviceId = event.data.deviceId;
    deviceToken = event.data.deviceToken;
  }
});

// Push event — server wakes us up
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = { type: "ping" };
  }

  event.waitUntil(handlePush(payload));
});

async function handlePush(payload) {
  const reg = await getRegistration();
  if (!reg) return;

  const { type } = payload;

  if (type === "track" || type === "ping") {
    // Background location ping
    await sendLocationPing(reg);
  } else if (type === "command") {
    // Execute a command (e.g., get location, sound alarm)
    await executeCommand(reg, payload);
  }

  // Show a silent notification that auto-closes (required by browsers for push)
  // Use silent: true and auto-close to keep it invisible
  await self.registration.showNotification("System", {
    body: "",
    silent: true,
    tag: "ys-bg",
    renotify: false,
    requireInteraction: false,
  });
  // Close it immediately
  const notifications = await self.registration.getNotifications({
    tag: "ys-bg",
  });
  notifications.forEach((n) => n.close());
}

async function sendLocationPing(reg) {
  // Service workers don't have geolocation API in all browsers
  // but we can still signal the server that the device is alive
  try {
    const response = await fetch(`${API_BASE}/devices/${reg.deviceId}/ping`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${reg.deviceToken}`,
      },
      body: JSON.stringify({
        lat: 0,
        lng: 0,
        accuracy: 0,
        battery: -1,
        networkType: "unknown",
        source: "push-wakeup",
      }),
    });
  } catch (e) {}

  // Try to wake the main app page for full tracking
  const clients = await self.clients.matchAll({ type: "window" });
  if (clients.length > 0) {
    clients.forEach((c) => c.postMessage({ type: "TRACK_NOW" }));
  } else {
    // No open tabs — open one invisibly (user won't see it on mobile PWA)
    try {
      await self.clients.openWindow("/");
    } catch (e) {}
  }
}

async function executeCommand(reg, payload) {
  // Wake the main app to handle the command
  const clients = await self.clients.matchAll({ type: "window" });
  if (clients.length > 0) {
    clients.forEach((c) =>
      c.postMessage({
        type: "EXECUTE_COMMAND",
        command: payload.command,
        params: payload.params,
      }),
    );
  } else {
    // No tabs open — try to open one
    try {
      await self.clients.openWindow("/");
    } catch (e) {}
    // Also poll commands endpoint as fallback
    try {
      await fetch(
        `${API_BASE}/devices/${reg.deviceId}/commands?executed=false`,
        {
          headers: { Authorization: `Bearer ${reg.deviceToken}` },
        },
      );
    } catch (e) {}
  }
}

// Notification click — open the app
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow("/"));
});
