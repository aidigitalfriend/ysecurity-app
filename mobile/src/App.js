import React, { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Device } from '@capacitor/device';
import { BackgroundGeolocation } from '@capacitor/background-geolocation';
import { Network } from '@capacitor/network';
import { Camera, CameraResultType } from '@capacitor/camera';
import { Geolocation } from '@capacitor/geolocation';

const API_BASE = 'http://localhost:3000/api'; // Replace with actual server

function App() {
  const [deviceId, setDeviceId] = useState(null);
  const [isActive, setIsActive] = useState(false);
  const [geofence, setGeofence] = useState(null); // {lat, lng, radius}

  useEffect(() => {
    initializeApp();
  }, []);

  const initializeApp = async () => {
    // Get device info
    const deviceInfo = await Device.getInfo();
    const id = deviceInfo.uuid || deviceInfo.identifierForVendor; // Use as device ID
    setDeviceId(id);

    // Register device (but dormant)
    await registerDevice(id, deviceInfo);

    // Check status periodically
    checkStatus(id);
    const interval = setInterval(() => checkStatus(id), 60000); // Check every minute

    return () => clearInterval(interval);
  };

  const registerDevice = async (id, info) => {
    try {
      const response = await fetch(`${API_BASE}/devices/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: id,
          model: info.model,
          os: `${info.operatingSystem} ${info.osVersion}`,
          licenseKey: 'some-license' // In real app, generate or input
        })
      });
      const data = await response.json();
      console.log('Device registered:', data);
    } catch (error) {
      console.error('Registration failed:', error);
    }
  };

  const checkStatus = async (id) => {
    try {
      const response = await fetch(`${API_BASE}/devices/${id}/status`);
      const data = await response.json();
      if (data.status === 'active' && !isActive) {
        setIsActive(true);
        startTracking();
      }

      // Check for commands
      const cmdResponse = await fetch(`${API_BASE}/devices/${id}/commands`);
      const commands = await cmdResponse.json();
      commands.forEach(cmd => executeCommand(cmd));
    } catch (error) {
      console.error('Status check failed:', error);
    }
  };

  const startTracking = async () => {
    if (!Capacitor.isNativePlatform()) return;

    // Request permissions
    await BackgroundGeolocation.requestPermissions();

    // Start background tracking
    await BackgroundGeolocation.start({
      distanceFilter: 10, // meters
      desiredAccuracy: BackgroundGeolocation.LocationAccuracy.HIGH,
      stationaryRadius: 20,
      interval: 300000, // 5 minutes when active, faster when lost
    });

    // Listen for location updates
    BackgroundGeolocation.addListener('location', async (location) => {
      const networkStatus = await Network.getStatus();
      const data = {
        lat: location.latitude,
        lng: location.longitude,
        accuracy: location.accuracy,
        battery: location.battery?.level || 0,
        networkType: networkStatus.connectionType
      };

      // Check geofence
      if (geofence) {
        const distance = getDistance(location.latitude, location.longitude, geofence.lat, geofence.lng);
        if (distance > geofence.radius) {
          data.alert = 'geofence_breach';
        }
      }

      await sendPing(data);
    });

    // Listen for network changes (SIM change alert)
    Network.addListener('networkStatusChange', async (status) => {
      // In real app, check if SIM changed by comparing carrier info
      // For now, just send alert on network change
      await sendPing({
        alert: 'network_change',
        networkType: status.connectionType
      });
    });
  };

  const sendPing = async (data) => {
    try {
      await fetch(`${API_BASE}/devices/${deviceId}/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
    } catch (error) {
      console.error('Ping failed:', error);
    }
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
      switch (cmd.command) {
        case 'alarm':
          // Play alarm sound (simplified, in real app use audio API or plugin)
          alert('ALARM! Device is being tracked!');
          break;
        case 'camera':
          const image = await Camera.getPhoto({
            quality: 90,
            allowEditing: false,
            resultType: CameraResultType.Base64
          });
          // Send photo to server
          await fetch(`${API_BASE}/devices/${deviceId}/photo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ photo: image.base64String })
          });
          break;
        case 'geofence':
          const params = JSON.parse(cmd.params);
          setGeofence(params); // {lat, lng, radius}
          console.log('Geofence set:', params);
          break;
        default:
          console.log('Unknown command:', cmd.command);
      }
      // Mark as executed
      await fetch(`${API_BASE}/commands/${cmd.id}/executed`, { method: 'POST' });
    } catch (error) {
      console.error('Command execution failed:', error);
    }
  };

  // For testing, a button to simulate activation
  const activate = () => {
    setIsActive(true);
    startTracking();
  };

  return (
    <div className="App">
      <h1>Sercret Security</h1>
      <p>Device ID: {deviceId}</p>
      <p>Status: {isActive ? 'Active' : 'Dormant'}</p>
    </div>
  );
}

export default App;