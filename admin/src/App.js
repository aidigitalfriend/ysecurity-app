import React, { useState, useEffect } from 'react';
import {
  AppBar, Toolbar, Typography, Container, Grid, Card, CardContent,
  Button, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, Paper, Chip, IconButton, Alert, Snackbar, Tabs, Tab,
  Box, List, ListItem, ListItemText, Divider
} from '@mui/material';
import {
  Map as MapIcon, LocationOn, Security, CameraAlt,
  Alarm, GpsFixed, BatteryFull, NetworkCheck, Analytics,
  Devices, Timeline, Notifications
} from '@mui/icons-material';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import io from 'socket.io-client';
import { format } from 'date-fns';
import 'leaflet/dist/leaflet.css';

const API_BASE = 'http://localhost:3000/api';

function AdminDashboard() {
  const [tabValue, setTabValue] = useState(0);
  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [locations, setLocations] = useState([]);
  const [analytics, setAnalytics] = useState({
    totalDevices: 0,
    activeDevices: 0,
    locationPings: 0,
    alertsToday: 0
  });
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [authToken, setAuthToken] = useState(localStorage.getItem('authToken'));
  const [loginDialog, setLoginDialog] = useState(!authToken);
  const [loginData, setLoginData] = useState({ username: '', password: '' });
  const [alert, setAlert] = useState({ open: false, message: '', severity: 'info' });

  useEffect(() => {
    if (authToken) {
      initSocket();
      loadDevices();
      loadAnalytics();
    }
  }, [authToken]);

  const loadAnalytics = async () => {
    try {
      const response = await fetch(`${API_BASE}/admin/devices`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      const data = await response.json();
      if (data.success) {
        const total = data.devices.length;
        const active = data.devices.filter(d => d.status === 'active').length;
        setAnalytics({
          totalDevices: total,
          activeDevices: active,
          locationPings: 0, // Would need additional API endpoint
          alertsToday: 0 // Would need additional API endpoint
        });
      }
    } catch (error) {
      console.error('Failed to load analytics:', error);
    }
  };

  const handleTabChange = (event, newValue) => {
    setTabValue(newValue);
  };

  const initSocket = () => {
    const socketConnection = io('http://localhost:3000');

    socketConnection.on('authenticated', (data) => {
      setIsConnected(data.success);
      if (data.success) {
        showAlert('Connected to real-time updates', 'success');
      }
    });

    socketConnection.on('location-update', (data) => {
      updateDeviceLocation(data);
    });

    socketConnection.on('command-sent', () => {
      showAlert('Command sent successfully', 'success');
    });

    socketConnection.on('command-error', (error) => {
      showAlert(`Command failed: ${error.error}`, 'error');
    });

    if (authToken) {
      socketConnection.emit('authenticate', authToken);
    }

    setSocket(socketConnection);
  };

  const showAlert = (message, severity = 'info') => {
    setAlert({ open: true, message, severity });
  };

  const handleLogin = async () => {
    try {
      const response = await fetch(`${API_BASE}/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginData)
      });

      const data = await response.json();
      if (data.success) {
        localStorage.setItem('authToken', data.token);
        setAuthToken(data.token);
        setLoginDialog(false);
        showAlert('Login successful', 'success');
      } else {
        showAlert(data.error || 'Login failed', 'error');
      }
    } catch (error) {
      showAlert('Login failed', 'error');
    }
  };

  const loadDevices = async () => {
    try {
      const response = await fetch(`${API_BASE}/admin/devices`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      const data = await response.json();
      if (data.success) {
        setDevices(data.devices);
      }
    } catch (error) {
      showAlert('Failed to load devices', 'error');
    }
  };

  const viewLocations = async (deviceId) => {
    try {
      const response = await fetch(`${API_BASE}/admin/devices/${deviceId}/locations`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      const data = await response.json();
      if (data.success) {
        setLocations(data.locations);
        setSelectedDevice(deviceId);

        // Subscribe to real-time updates
        if (socket) {
          socket.emit('subscribe-locations', deviceId);
        }
      }
    } catch (error) {
      showAlert('Failed to load locations', 'error');
    }
  };

  const sendCommand = (deviceId, command, params = {}) => {
    if (socket) {
      socket.emit('send-command', { deviceId, command, params });
    }
  };

  const markAsLost = async (deviceId) => {
    try {
      const response = await fetch(`${API_BASE}/admin/devices/${deviceId}/mark-lost`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      const data = await response.json();
      if (data.success) {
        showAlert('Device marked as lost', 'success');
        loadDevices();
      }
    } catch (error) {
      showAlert('Failed to mark device as lost', 'error');
    }
  };

  const updateDeviceLocation = (data) => {
    setLocations(prev => {
      const newLocations = [data, ...prev.slice(0, 99)]; // Keep last 100 locations
      return newLocations;
    });
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'active': return 'error';
      case 'verified': return 'warning';
      case 'reported': return 'info';
      default: return 'default';
    }
  };

  return (
    <div style={{ backgroundColor: '#f5f5f5', minHeight: '100vh' }}>
      <AppBar position="static">
        <Toolbar>
          <Security sx={{ mr: 2 }} />
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            Sercret Security Admin
          </Typography>
          <Chip
            label={isConnected ? '🟢 Real-time' : '🔴 Offline'}
            color={isConnected ? 'success' : 'error'}
            size="small"
          />
        </Toolbar>
      </AppBar>

      <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tabs value={tabValue} onChange={handleTabChange} aria-label="admin tabs">
            <Tab icon={<Devices />} label="Devices" />
            <Tab icon={<MapIcon />} label="Tracking" />
            <Tab icon={<Analytics />} label="Analytics" />
            <Tab icon={<Notifications />} label="Reports" />
          </Tabs>
        </Box>

        <TabPanel value={tabValue} index={0}>
          <DevicesTab
            devices={devices}
            onViewLocations={viewLocations}
            onMarkAsLost={markAsLost}
            onSendCommand={sendCommand}
          />
        </TabPanel>

        <TabPanel value={tabValue} index={1}>
          <TrackingTab
            locations={locations}
            selectedDevice={selectedDevice}
          />
        </TabPanel>

        <TabPanel value={tabValue} index={2}>
          <AnalyticsTab analytics={analytics} />
        </TabPanel>

        <TabPanel value={tabValue} index={3}>
          <ReportsTab />
        </TabPanel>
      </Container>

      {/* Login Dialog */}
      <Dialog open={loginDialog} onClose={() => {}}>
        <DialogTitle>Admin Login</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Username"
            fullWidth
            value={loginData.username}
            onChange={(e) => setLoginData({...loginData, username: e.target.value})}
          />
          <TextField
            margin="dense"
            label="Password"
            type="password"
            fullWidth
            value={loginData.password}
            onChange={(e) => setLoginData({...loginData, password: e.target.value})}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleLogin}>Login</Button>
        </DialogActions>
      </Dialog>

      {/* Alert Snackbar */}
      <Snackbar
        open={alert.open}
        autoHideDuration={6000}
        onClose={() => setAlert({...alert, open: false})}
      >
        <Alert
          onClose={() => setAlert({...alert, open: false})}
          severity={alert.severity}
          sx={{ width: '100%' }}
        >
          {alert.message}
        </Alert>
      </Snackbar>
    </div>
  );
}

// Tab Panel Component
function TabPanel(props) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`admin-tabpanel-${index}`}
      aria-labelledby={`admin-tab-${index}`}
      {...other}
    >
      {value === index && (
        <Box sx={{ p: 3 }}>
          {children}
        </Box>
      )}
    </div>
  );
}

// Devices Tab Component
function DevicesTab({ devices, onViewLocations, onMarkAsLost, onSendCommand }) {
  const getStatusColor = (status) => {
    switch (status) {
      case 'active': return 'error';
      case 'verified': return 'warning';
      case 'reported': return 'info';
      default: return 'default';
    }
  };

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Device Registry
        </Typography>
        <TableContainer component={Paper} sx={{ maxHeight: 600 }}>
          <Table stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Device ID</TableCell>
                <TableCell>Model</TableCell>
                <TableCell>OS</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Registered</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {devices.map((device) => (
                <TableRow key={device.id}>
                  <TableCell>{device.id.substring(0, 12)}...</TableCell>
                  <TableCell>{device.model}</TableCell>
                  <TableCell>{device.os}</TableCell>
                  <TableCell>
                    <Chip
                      label={device.status}
                      color={getStatusColor(device.status)}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>{format(new Date(device.created_at), 'MMM dd, yyyy')}</TableCell>
                  <TableCell>
                    <IconButton
                      size="small"
                      onClick={() => onViewLocations(device.id)}
                      color="primary"
                      title="View Locations"
                    >
                      <MapIcon />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={() => onMarkAsLost(device.id)}
                      color="error"
                      title="Mark as Lost"
                    >
                      <GpsFixed />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={() => onSendCommand(device.id, 'alarm')}
                      color="warning"
                      title="Trigger Alarm"
                    >
                      <Alarm />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={() => onSendCommand(device.id, 'camera')}
                      color="info"
                      title="Take Photo"
                    >
                      <CameraAlt />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>
    </Card>
  );
}

// Tracking Tab Component
function TrackingTab({ locations, selectedDevice }) {
  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Live Tracking Map {selectedDevice && `- Device: ${selectedDevice.substring(0, 12)}...`}
        </Typography>
        <div style={{ height: 500, width: '100%' }}>
          <MapContainer
            center={locations.length > 0 ? [locations[0].latitude, locations[0].longitude] : [0, 0]}
            zoom={locations.length > 0 ? 13 : 2}
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='© OpenStreetMap contributors'
            />
            {locations.map((loc, index) => (
              <Marker
                key={index}
                position={[loc.latitude, loc.longitude]}
              >
                <Popup>
                  <strong>Device: {selectedDevice?.substring(0, 12)}...</strong><br/>
                  Time: {format(new Date(loc.timestamp), 'MMM dd, yyyy HH:mm:ss')}<br/>
                  Battery: {loc.battery}%<br/>
                  Accuracy: {loc.accuracy}m<br/>
                  Network: {loc.network_type}
                  {loc.alert && <><br/><strong>Alert: {loc.alert}</strong></>}
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>
      </CardContent>
    </Card>
  );
}

// Analytics Tab Component
function AnalyticsTab({ analytics }) {
  const deviceStatusData = [
    { name: 'Active', value: analytics.activeDevices, color: '#f44336' },
    { name: 'Inactive', value: analytics.totalDevices - analytics.activeDevices, color: '#4caf50' }
  ];

  return (
    <Grid container spacing={3}>
      <Grid item xs={12} md={3}>
        <Card>
          <CardContent>
            <Typography color="textSecondary" gutterBottom>
              Total Devices
            </Typography>
            <Typography variant="h4">
              {analytics.totalDevices}
            </Typography>
          </CardContent>
        </Card>
      </Grid>
      <Grid item xs={12} md={3}>
        <Card>
          <CardContent>
            <Typography color="textSecondary" gutterBottom>
              Active Tracking
            </Typography>
            <Typography variant="h4" color="error">
              {analytics.activeDevices}
            </Typography>
          </CardContent>
        </Card>
      </Grid>
      <Grid item xs={12} md={3}>
        <Card>
          <CardContent>
            <Typography color="textSecondary" gutterBottom>
              Location Pings
            </Typography>
            <Typography variant="h4" color="primary">
              {analytics.locationPings}
            </Typography>
          </CardContent>
        </Card>
      </Grid>
      <Grid item xs={12} md={3}>
        <Card>
          <CardContent>
            <Typography color="textSecondary" gutterBottom>
              Alerts Today
            </Typography>
            <Typography variant="h4" color="warning.main">
              {analytics.alertsToday}
            </Typography>
          </CardContent>
        </Card>
      </Grid>
      <Grid item xs={12} md={6}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Device Status Distribution
            </Typography>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={deviceStatusData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {deviceStatusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </Grid>
      <Grid item xs={12} md={6}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Activity Timeline
            </Typography>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={[]}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="pings" stroke="#8884d8" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );
}

// Reports Tab Component
function ReportsTab() {
  const [reports, setReports] = useState([]);

  // Mock reports data - in real app, fetch from API
  useEffect(() => {
    setReports([
      { id: 1, type: 'Geofence Breach', device: 'DEV001', time: new Date(), status: 'Active' },
      { id: 2, type: 'SIM Change', device: 'DEV002', time: new Date(Date.now() - 3600000), status: 'Resolved' },
      { id: 3, type: 'Low Battery', device: 'DEV003', time: new Date(Date.now() - 7200000), status: 'Active' }
    ]);
  }, []);

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Recent Reports & Alerts
        </Typography>
        <List>
          {reports.map((report) => (
            <div key={report.id}>
              <ListItem>
                <ListItemText
                  primary={`${report.type} - Device ${report.device}`}
                  secondary={`Time: ${format(report.time, 'MMM dd, yyyy HH:mm:ss')} | Status: ${report.status}`}
                />
                <Chip
                  label={report.status}
                  color={report.status === 'Active' ? 'error' : 'success'}
                  size="small"
                />
              </ListItem>
              <Divider />
            </div>
          ))}
        </List>
      </CardContent>
    </Card>
  );
}

export default AdminDashboard;