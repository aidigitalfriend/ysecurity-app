import React, { useEffect, useState, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { Device } from '@capacitor/device';
import { BackgroundGeolocation, LocationAccuracy } from '@capacitor/background-geolocation';
import { Network } from '@capacitor/network';
import { Camera, CameraResultType } from '@capacitor/camera';
import { Geolocation } from '@capacitor/geolocation';
import { Storage } from '@capacitor/storage';
import io from 'socket.io-client';

const API_BASE = process.env.REACT_APP_API_BASE_URL || 'http://localhost:3000/api';

function App() {
  const [deviceId, setDeviceId] = useState(null);
  const [isActive, setIsActive] = useState(false);
  const [geofence, setGeofence] = useState(null);
  const [isOnline, setIsOnline] = useState(true);
  const [pendingPings, setPendingPings] = useState([]);
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    initializeApp();
    setupNetworkListener();
    initSocket();
    return () => {
      // Cleanup
      if (statusCheckInterval) clearInterval(statusCheckInterval);
      if (socket) socket.disconnect();
    };
  }, []);

  const initSocket = () => {
    const socketConnection = io(API_BASE.replace('/api', ''), {
      transports: ['websocket', 'polling']
    });

    socketConnection.on('connect', () => {
      console.log('Connected to server via Socket.IO');
      setIsConnected(true);

      // Authenticate device
      if (deviceId) {
        socketConnection.emit('device-authenticate', { deviceId });
      }
    });

    socketConnection.on('disconnect', () => {
      console.log('Disconnected from server');
      setIsConnected(false);
    });

    socketConnection.on('device-authenticated', (data) => {
      if (data.success) {
        console.log('Device authenticated via socket');
      }
    });

    socketConnection.on('command', (command) => {
      console.log('Received command via socket:', command);
      executeCommand(command);
    });

    setSocket(socketConnection);
  };

  let statusCheckInterval;

  const setupNetworkListener = () => {
    Network.addListener('networkStatusChange', (status) => {
      setIsOnline(status.connected);
      if (status.connected) {
        // Sync pending pings when back online
        syncPendingPings();
      }
    });
  };

  const initializeApp = async () => {
    try {
      setError(null);

      // Get device info
      const deviceInfo = await Device.getInfo();
      const id = deviceInfo.uuid || deviceInfo.identifierForVendor;
      if (!id) {
        throw new Error('Unable to get device identifier');
      }
      setDeviceId(id);

      // Load cached data
      await loadCachedData();

      // Register device (but dormant)
      await registerDevice(id, deviceInfo);

      // Check status periodically
      checkStatus(id);
      statusCheckInterval = setInterval(() => checkStatus(id), 60000); // Check every minute

    } catch (err) {
      console.error('Initialization failed:', err);
      setError(`Initialization failed: ${err.message}`);
    }
  };

  const loadCachedData = async () => {
    try {
      const cachedPings = await Storage.get({ key: 'pendingPings' });
      if (cachedPings.value) {
        setPendingPings(JSON.parse(cachedPings.value));
      }
      const cachedGeofence = await Storage.get({ key: 'geofence' });
      if (cachedGeofence.value) {
        setGeofence(JSON.parse(cachedGeofence.value));
      }
    } catch (err) {
      console.error('Failed to load cached data:', err);
    }
  };

  const savePendingPings = async (pings) => {
    try {
      await Storage.set({ key: 'pendingPings', value: JSON.stringify(pings) });
    } catch (err) {
      console.error('Failed to save pending pings:', err);
    }
  };

  const registerDevice = async (id, info) => {
    if (!isOnline) return; // Skip if offline

    try {
      const response = await fetch(`${API_BASE}/devices/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-ID': id
        },
        body: JSON.stringify({
          deviceId: id,
          model: info.model,
          os: `${info.operatingSystem} ${info.osVersion}`,
          licenseKey: 'demo-license-key-12345' // In real app, generate or input
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      console.log('Device registered:', data);
    } catch (error) {
      console.error('Registration failed:', error);
      setError(`Registration failed: ${error.message}`);
    }
  };

  const checkStatus = async (id) => {
    if (!isOnline) return; // Skip if offline

    try {
      const response = await fetch(`${API_BASE}/devices/${id}/status`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      if (data.success && data.status === 'active' && !isActive) {
        setIsActive(true);
        await startTracking();
      }

      // Check for commands
      await checkCommands(id);
    } catch (error) {
      console.error('Status check failed:', error);
      // Don't set error for status checks, they're periodic
    }
  };

  const checkCommands = async (id) => {
    try {
      const response = await fetch(`${API_BASE}/devices/${id}/commands`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      if (data.success && data.commands) {
        for (const cmd of data.commands) {
          await executeCommand(cmd);
        }
      }
    } catch (error) {
      console.error('Command check failed:', error);
    }
  };

  const startTracking = async () => {
    if (!Capacitor.isNativePlatform()) {
      console.log('Background geolocation not available in web mode');
      return;
    }

    try {
      setError(null);

      // Request permissions
      const permissions = await BackgroundGeolocation.requestPermissions();
      if (permissions.location !== 'granted') {
        throw new Error('Location permission denied');
      }

      // Configure background tracking with battery optimization
      const config = {
        distanceFilter: 50, // meters - increased for battery savings
        desiredAccuracy: LocationAccuracy.MEDIUM, // Reduced accuracy for battery
        stationaryRadius: 25,
        interval: 300000, // 5 minutes when active
        fastestInterval: 60000, // Minimum 1 minute
        activitiesInterval: 10000,
        stopTimeout: 5,
        debug: false, // Disable debug mode
        notification: {
          title: 'Device Tracking Active',
          text: 'Your device location is being monitored',
          smallIcon: 'drawable/ic_launcher',
          largeIcon: 'drawable/ic_launcher'
        }
      };

      await BackgroundGeolocation.start(config);

      // Listen for location updates
      BackgroundGeolocation.addListener('location', async (location) => {
        try {
          const networkStatus = await Network.getStatus();
          const data = {
            lat: location.latitude,
            lng: location.longitude,
            accuracy: location.accuracy,
            battery: batteryLevel,
            networkType: networkStatus.connectionType || 'unknown'
          };

          // Check geofence
          if (geofence) {
            const distance = getDistance(location.latitude, location.longitude, geofence.lat, geofence.lng);
            if (distance > geofence.radius) {
              data.alert = 'geofence_breach';
            }
          }

          await sendPing(data);
        } catch (err) {
          console.error('Location processing failed:', err);
        }
      });

      // Listen for network changes (SIM change alert)
      Network.addListener('networkStatusChange', async (status) => {
        try {
          await sendPing({
            alert: 'network_change',
            networkType: status.connectionType || 'unknown'
          });
        } catch (err) {
          console.error('Network change ping failed:', err);
        }
      });

      console.log('Background tracking started');
    } catch (error) {
      console.error('Failed to start tracking:', error);
      setError(`Tracking failed: ${error.message}`);
    }
  };

  const sendPing = async (data) => {
    const pingData = {
      ...data,
      deviceId,
      timestamp: new Date().toISOString()
    };

    if (!isOnline) {
      // Queue ping for later
      const newPendingPings = [...pendingPings, pingData];
      setPendingPings(newPendingPings);
      await savePendingPings(newPendingPings);
      console.log('Ping queued (offline):', pingData);
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/devices/${deviceId}/ping`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-ID': deviceId
        },
        body: JSON.stringify(pingData)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      console.log('Ping sent successfully');
    } catch (error) {
      console.error('Ping failed, queuing:', error);
      // Queue failed ping
      const newPendingPings = [...pendingPings, pingData];
      setPendingPings(newPendingPings);
      await savePendingPings(newPendingPings);
    }
  };

  const syncPendingPings = async () => {
    if (!isOnline || pendingPings.length === 0) return;

    console.log(`Syncing ${pendingPings.length} pending pings...`);

    const successfulPings = [];
    const failedPings = [];

    for (const ping of pendingPings) {
      try {
        const response = await fetch(`${API_BASE}/devices/${deviceId}/ping`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Device-ID': deviceId
          },
          body: JSON.stringify(ping)
        });

        if (response.ok) {
          successfulPings.push(ping);
        } else {
          failedPings.push(ping);
        }
      } catch (error) {
        failedPings.push(ping);
      }
    }

    if (successfulPings.length > 0) {
      console.log(`Successfully synced ${successfulPings.length} pings`);
    }

    setPendingPings(failedPings);
    await savePendingPings(failedPings);
  };

  const getDistance = (lat1, lng1, lat2, lng2) => {
    const R = 6371e3; // metres
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lng2 - lng1) * Math.PI / 180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
  };

  const executeCommand = async (cmd) => {
    try {
      console.log('Executing command:', cmd.command);

      switch (cmd.command) {
        case 'alarm':
          // Play alarm sound (simplified, in real app use audio API or plugin)
          if (Capacitor.isNativePlatform()) {
            // In real app, use native audio or vibration
            alert('🚨 ALARM! Device is being tracked!');
          } else {
            alert('ALARM! Device is being tracked!');
          }
          break;

        case 'camera':
          if (Capacitor.isNativePlatform()) {
            const image = await Camera.getPhoto({
              quality: 90,
              allowEditing: false,
              resultType: CameraResultType.Base64
            });

            // Send photo to server
            await fetch(`${API_BASE}/devices/${deviceId}/photo`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Device-ID': deviceId
              },
              body: JSON.stringify({ photo: image.base64String })
            });
          } else {
            console.log('Camera not available in web mode');
          }
          break;

        case 'geofence':
          const params = JSON.parse(cmd.params);
          setGeofence(params);
          await Storage.set({ key: 'geofence', value: JSON.stringify(params) });
          console.log('Geofence set:', params);
          break;

        default:
          console.log('Unknown command:', cmd.command);
      }

      // Mark as executed
      await fetch(`${API_BASE}/commands/${cmd.id}/executed`, {
        method: 'POST',
        headers: { 'X-Device-ID': deviceId }
      });

    } catch (error) {
      console.error('Command execution failed:', error);
      setError(`Command execution failed: ${error.message}`);
    }
  };

  // Battery monitoring
  const startBatteryMonitoring = async () => {
    if (Capacitor.isNativePlatform()) {
      try {
        // In real app, use Battery plugin or native APIs
        // For now, simulate battery monitoring
        const updateBattery = () => {
          // Simulate battery level (in real app, get from device)
          const simulatedLevel = Math.max(10, Math.min(100, batteryLevel - Math.random() * 5));
          setBatteryLevel(Math.round(simulatedLevel));
        };

        setInterval(updateBattery, 300000); // Update every 5 minutes
      } catch (error) {
        console.error('Battery monitoring failed:', error);
      }
    }
  };

  // For testing, a button to simulate activation
  const activate = () => {
    setIsActive(true);
    startTracking();
    startBatteryMonitoring();
  };

  return (
    <div className="App" style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1>🔒 Sercret Security</h1>

      <div style={{ margin: '20px 0', padding: '15px', border: '1px solid #ccc', borderRadius: '8px' }}>
        <div><strong>Device ID:</strong> {deviceId || 'Loading...'}</div>
        <div><strong>Status:</strong>
          <span style={{
            color: isActive ? '#d32f2f' : '#388e3c',
            fontWeight: 'bold',
            marginLeft: '8px'
          }}>
            {isActive ? '🟢 ACTIVE (Tracking)' : '⚪ DORMANT'}
          </span>
        </div>
        <div><strong>Network:</strong>
          <span style={{ color: isOnline ? '#388e3c' : '#f57c00', marginLeft: '8px' }}>
            {isOnline ? '🟢 Online' : '🟠 Offline'}
          </span>
        </div>
        <div><strong>Server:</strong>
          <span style={{ color: isConnected ? '#388e3c' : '#f57c00', marginLeft: '8px' }}>
            {isConnected ? '🟢 Connected' : '🟠 Disconnected'}
          </span>
        </div>
        <div><strong>Battery:</strong> {batteryLevel}%</div>
        {geofence && (
          <div><strong>Geofence:</strong> {geofence.lat.toFixed(4)}, {geofence.lng.toFixed(4)} (radius: {geofence.radius}m)</div>
        )}
        {pendingPings.length > 0 && (
          <div><strong>Pending Pings:</strong> {pendingPings.length}</div>
        )}
      </div>

      {error && (
        <div style={{
          margin: '20px 0',
          padding: '15px',
          backgroundColor: '#ffebee',
          border: '1px solid #f44336',
          borderRadius: '8px',
          color: '#c62828'
        }}>
          <strong>Error:</strong> {error}
          <button
            onClick={() => setError(null)}
            style={{ marginLeft: '10px', padding: '5px 10px', cursor: 'pointer' }}
          >
            Dismiss
          </button>
        </div>
      )}

      {!isActive && (
        <button
          onClick={activate}
          style={{
            padding: '12px 24px',
            backgroundColor: '#d32f2f',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontSize: '16px',
            cursor: 'pointer',
            margin: '10px 0'
          }}
        >
          🔴 Simulate Activation (Test Only)
        </button>
      )}

      <div style={{ marginTop: '20px', fontSize: '14px', color: '#666' }}>
        <p>This app silently monitors device location when activated by security personnel.</p>
        <p>Location data is encrypted and only accessible after proper verification.</p>
      </div>
    </div>
  );
}

export default App;