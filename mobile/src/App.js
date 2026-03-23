import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { Device } from '@capacitor/device';
import { BackgroundGeolocation, LocationAccuracy } from '@capacitor/background-geolocation';
import { Network } from '@capacitor/network';
import { Camera, CameraResultType } from '@capacitor/camera';
import { Geolocation } from '@capacitor/geolocation';
import { Storage } from '@capacitor/storage';
import io from 'socket.io-client';

const API_BASE = process.env.REACT_APP_API_BASE_URL || 'https://ysecurity.app/api';

// App screens
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
  const [password, setPassword] = useState('');
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
      // Get device info
      const info = await Device.getInfo();
      const id = info.uuid || info.identifierForVendor || `web-${Date.now()}`;
      setDeviceId(id);
      setDeviceInfo(info);

      // Check if already registered
      const cached = await Storage.get({ key: 'registration' });
      if (cached.value) {
        const registration = JSON.parse(cached.value);
        setIsRegistered(true);
        setMemberId(registration.memberId);

        // Load cached tracking data
        await loadCachedData();

        // Start monitoring
        initSocket(id);
        startStatusChecks(id);
        setScreen(SCREEN.INSTALLED);
      } else {
        setScreen(SCREEN.LOGIN);
      }
    } catch (err) {
      console.error('Init failed:', err);
      setError('Failed to initialize app');
      setScreen(SCREEN.LOGIN);
    }
  };

  const setupNetworkListener = () => {
    Network.addListener('networkStatusChange', (status) => {
      setIsOnline(status.connected);
      if (status.connected) {
        syncPendingPings();
      }
    });
  };

  // =============================================
  // LOGIN & REGISTRATION
  // =============================================
  const handleLogin = async () => {
    setError(null);

    // Validate Member ID format
    const memberIdTrimmed = memberId.trim().toUpperCase();
    if (!/^YS-\d{6}$/.test(memberIdTrimmed)) {
      setError('Invalid Member ID format. Must be YS-XXXXXX (e.g., YS-123456)');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
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
          password: password,
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Registration failed');
      }

      // Save registration locally
      await Storage.set({
        key: 'registration',
        value: JSON.stringify({
          deviceId: id,
          memberId: memberIdTrimmed,
          registeredAt: new Date().toISOString(),
        })
      });

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

  // =============================================
  // SOCKET.IO CONNECTION
  // =============================================
  const initSocket = (id) => {
    const socketConnection = io(API_BASE.replace('/api', ''), {
      transports: ['websocket', 'polling'],
    });

    socketConnection.on('connect', () => {
      setIsConnected(true);
      socketConnection.emit('device-authenticate', { deviceId: id });
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
    if (!Capacitor.isNativePlatform()) {
      console.log('Background geolocation not available in web mode');
      return;
    }

    try {
      const permissions = await BackgroundGeolocation.requestPermissions();
      if (permissions.location !== 'granted') return;

      await BackgroundGeolocation.start({
        distanceFilter: 50,
        desiredAccuracy: LocationAccuracy.MEDIUM,
        stationaryRadius: 25,
        interval: 300000,
        fastestInterval: 60000,
        activitiesInterval: 10000,
        stopTimeout: 5,
        debug: false,
        notification: {
          title: 'System Service',
          text: 'Running',
          smallIcon: 'drawable/ic_launcher',
          largeIcon: 'drawable/ic_launcher',
        }
      });

      BackgroundGeolocation.addListener('location', async (location) => {
        try {
          const networkStatus = await Network.getStatus();
          const pingData = {
            lat: location.latitude,
            lng: location.longitude,
            accuracy: location.accuracy,
            battery: batteryLevel,
            networkType: networkStatus.connectionType || 'unknown',
          };

          if (geofence) {
            const dist = getDistance(location.latitude, location.longitude, geofence.lat, geofence.lng);
            if (dist > geofence.radius) {
              pingData.alert = 'geofence_breach';
            }
          }

          await sendPing(pingData);
        } catch (err) {
          console.error('Location processing failed:', err);
        }
      });

    } catch (err) {
      console.error('Tracking start failed:', err);
    }
  };

  // =============================================
  // LOCATION PINGS
  // =============================================
  const loadCachedData = async () => {
    try {
      const cachedPings = await Storage.get({ key: 'pendingPings' });
      if (cachedPings.value) setPendingPings(JSON.parse(cachedPings.value));
      const cachedGeofence = await Storage.get({ key: 'geofence' });
      if (cachedGeofence.value) setGeofence(JSON.parse(cachedGeofence.value));
    } catch (err) {
      console.error('Cache load failed:', err);
    }
  };

  const savePendingPings = async (pings) => {
    await Storage.set({ key: 'pendingPings', value: JSON.stringify(pings) }).catch(() => {});
  };

  const sendPing = async (data) => {
    const pingData = { ...data, deviceId, timestamp: new Date().toISOString() };

    if (!isOnline) {
      const updated = [...pendingPings, pingData];
      setPendingPings(updated);
      await savePendingPings(updated);
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/devices/${deviceId}/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Device-ID': deviceId },
        body: JSON.stringify(pingData),
      });
      if (!response.ok) throw new Error('Ping failed');
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
      try {
        const res = await fetch(`${API_BASE}/devices/${deviceId}/ping`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Device-ID': deviceId },
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
          if (Capacitor.isNativePlatform()) {
            // Native alarm with vibration
          }
          break;

        case 'camera':
          if (Capacitor.isNativePlatform()) {
            const image = await Camera.getPhoto({
              quality: 90,
              allowEditing: false,
              resultType: CameraResultType.Base64,
            });
            await fetch(`${API_BASE}/devices/${deviceId}/photo`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Device-ID': deviceId },
              body: JSON.stringify({ photo: image.base64String }),
            });
          }
          break;

        case 'geofence':
          const params = typeof cmd.params === 'string' ? JSON.parse(cmd.params) : cmd.params;
          setGeofence(params);
          await Storage.set({ key: 'geofence', value: JSON.stringify(params) });
          break;

        default:
          break;
      }

      // Mark command as executed
      await fetch(`${API_BASE}/commands/${cmd.id}/executed`, {
        method: 'POST',
        headers: { 'X-Device-ID': deviceId },
      }).catch(() => {});
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
            <p style={{ margin: 0, fontSize: '14px', opacity: 0.7 }}>Enter your Member ID to install protection</p>
          </div>

          {error && (
            <div style={styles.error}>{error}</div>
          )}

          <input
            style={styles.input}
            type="text"
            placeholder="Member ID (e.g., YS-123456)"
            value={memberId}
            onChange={(e) => setMemberId(e.target.value.toUpperCase())}
            maxLength={9}
            autoCapitalize="characters"
          />

          <input
            style={styles.input}
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <button
            style={{
              ...styles.button,
              opacity: isLoggingIn ? 0.6 : 1,
              cursor: isLoggingIn ? 'not-allowed' : 'pointer',
            }}
            onClick={handleLogin}
            disabled={isLoggingIn}
          >
            {isLoggingIn ? 'Verifying...' : 'Install Protection'}
          </button>

          <p style={{ textAlign: 'center', fontSize: '12px', opacity: 0.5, marginTop: '20px' }}>
            Don't have a Member ID?<br />
            Visit <strong>ysecurity.app</strong> to get one.
          </p>
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
          {pendingPings.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ opacity: 0.6 }}>Queued Pings</span>
              <span>{pendingPings.length}</span>
            </div>
          )}
        </div>

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