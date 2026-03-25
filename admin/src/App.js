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
  Devices, Timeline, Notifications, People, Delete,
  PlayArrow, Stop
} from '@mui/icons-material';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import io from 'socket.io-client';
import { format } from 'date-fns';
import 'leaflet/dist/leaflet.css';

const API_BASE = process.env.REACT_APP_API_BASE_URL || 'https://ysecurity.app/api';

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
  const [members, setMembers] = useState([]);
  const [activateDialog, setActivateDialog] = useState({ open: false, memberId: '' });
  const [confirmDeleteDialog, setConfirmDeleteDialog] = useState({ open: false, memberId: null });
  const [confirmResetDialog, setConfirmResetDialog] = useState({ open: false, deviceId: null, memberId: null });

  useEffect(() => {
    if (authToken) {
      initSocket();
      loadDevices();
      loadMembers();
      loadAnalytics();
    }
  }, [authToken]);

  const loadAnalytics = async () => {
    try {
      const response = await fetch(`${API_BASE}/admin/analytics`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      const data = await response.json();
      if (data.success) {
        setAnalytics(data.analytics);
      }
    } catch (error) {
      console.error('Failed to load analytics:', error);
    }
  };

  const handleTabChange = (event, newValue) => {
    setTabValue(newValue);
  };

  const initSocket = () => {
    const socketConnection = io(API_BASE.replace('/api', ''));

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

  const loadMembers = async () => {
    try {
      const response = await fetch(`${API_BASE}/admin/members`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      const data = await response.json();
      if (data.success) {
        setMembers(data.members);
      }
    } catch (error) {
      showAlert('Failed to load members', 'error');
    }
  };

  const activateDevice = async (memberId) => {
    try {
      const response = await fetch(`${API_BASE}/admin/devices/activate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ memberId })
      });
      const data = await response.json();
      if (data.success) {
        showAlert(`Device activated for ${memberId}`, 'success');
        loadDevices();
        loadMembers();
        setActivateDialog({ open: false, memberId: '' });
      } else {
        showAlert(data.error || 'Activation failed', 'error');
      }
    } catch (error) {
      showAlert('Failed to activate device', 'error');
    }
  };

  const deactivateDevice = async (deviceId) => {
    try {
      const response = await fetch(`${API_BASE}/admin/devices/deactivate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ deviceId })
      });
      const data = await response.json();
      if (data.success) {
        showAlert('Device deactivated', 'success');
        loadDevices();
      } else {
        showAlert(data.error || 'Deactivation failed', 'error');
      }
    } catch (error) {
      showAlert('Failed to deactivate device', 'error');
    }
  };

  const resetDevice = async (deviceId) => {
    try {
      const response = await fetch(`${API_BASE}/admin/devices/${encodeURIComponent(deviceId)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      const data = await response.json();
      if (data.success) {
        showAlert('Device reset successfully. Member can re-register.', 'success');
        loadDevices();
        setConfirmResetDialog({ open: false, deviceId: null, memberId: null });
      } else {
        showAlert(data.error || 'Reset failed', 'error');
      }
    } catch (error) {
      showAlert('Failed to reset device', 'error');
    }
  };

  const deleteMember = async (memberId) => {
    try {
      const response = await fetch(`${API_BASE}/admin/members/${encodeURIComponent(memberId)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      const data = await response.json();
      if (data.success) {
        showAlert(`Member ${memberId} and associated device deleted`, 'success');
        loadMembers();
        loadDevices();
        setConfirmDeleteDialog({ open: false, memberId: null });
      } else {
        showAlert(data.error || 'Delete failed', 'error');
      }
    } catch (error) {
      showAlert('Failed to delete member', 'error');
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
            Ysecurity Admin
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
            <Tab icon={<People />} label="Members" />
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
            onActivate={() => setActivateDialog({ open: true, memberId: '' })}
            onDeactivate={deactivateDevice}
            onResetDevice={(deviceId, memberId) => setConfirmResetDialog({ open: true, deviceId, memberId })}
          />
        </TabPanel>

        <TabPanel value={tabValue} index={1}>
          <MembersTab
            members={members}
            onDelete={(memberId) => setConfirmDeleteDialog({ open: true, memberId })}
            onActivate={(memberId) => activateDevice(memberId)}
          />
        </TabPanel>

        <TabPanel value={tabValue} index={2}>
          <TrackingTab
            locations={locations}
            selectedDevice={selectedDevice}
          />
        </TabPanel>

        <TabPanel value={tabValue} index={3}>
          <AnalyticsTab analytics={analytics} />
        </TabPanel>

        <TabPanel value={tabValue} index={4}>
          <ReportsTab authToken={authToken} />
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

      {/* Activate Device Dialog */}
      <Dialog open={activateDialog.open} onClose={() => setActivateDialog({ open: false, memberId: '' })}>
        <DialogTitle>Activate Device</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            Enter the Member ID to activate their registered device for tracking.
          </Typography>
          <TextField
            autoFocus
            margin="dense"
            label="Member ID (e.g., YS-123456)"
            fullWidth
            value={activateDialog.memberId}
            onChange={(e) => setActivateDialog({...activateDialog, memberId: e.target.value.toUpperCase()})}
            inputProps={{ maxLength: 9 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setActivateDialog({ open: false, memberId: '' })}>Cancel</Button>
          <Button
            onClick={() => activateDevice(activateDialog.memberId)}
            variant="contained"
            color="success"
          >
            Activate
          </Button>
        </DialogActions>
      </Dialog>

      {/* Confirm Device Reset Dialog */}
      <Dialog open={confirmResetDialog.open} onClose={() => setConfirmResetDialog({ open: false, deviceId: null, memberId: null })}>
        <DialogTitle>Reset / Uninstall Device</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            This will delete device <strong>{confirmResetDialog.deviceId?.substring(0, 20)}...</strong>
            {confirmResetDialog.memberId && <> for member <strong>{confirmResetDialog.memberId}</strong></>}.
            All location history, commands, and tracking data will be removed.
            The member can re-register a new device.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmResetDialog({ open: false, deviceId: null, memberId: null })}>Cancel</Button>
          <Button
            onClick={() => resetDevice(confirmResetDialog.deviceId)}
            variant="contained"
            color="error"
          >
            Reset Device
          </Button>
        </DialogActions>
      </Dialog>

      {/* Confirm Delete Dialog */}
      <Dialog open={confirmDeleteDialog.open} onClose={() => setConfirmDeleteDialog({ open: false, memberId: null })}>
        <DialogTitle>Delete Member</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Are you sure you want to delete member <strong>{confirmDeleteDialog.memberId}</strong> and their associated device?
            This action cannot be undone. The member will need to repurchase a new membership.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDeleteDialog({ open: false, memberId: null })}>Cancel</Button>
          <Button
            onClick={() => deleteMember(confirmDeleteDialog.memberId)}
            variant="contained"
            color="error"
          >
            Delete
          </Button>
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
function DevicesTab({ devices, onViewLocations, onMarkAsLost, onSendCommand, onActivate, onDeactivate, onResetDevice }) {
  const getStatusColor = (status) => {
    switch (status) {
      case 'active': return 'error';
      case 'dormant': return 'default';
      case 'verified': return 'warning';
      case 'reported': return 'info';
      default: return 'default';
    }
  };

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6">Device Registry</Typography>
          <Button
            variant="contained"
            color="success"
            startIcon={<PlayArrow />}
            onClick={onActivate}
          >
            Activate Device
          </Button>
        </Box>
        <TableContainer component={Paper} sx={{ maxHeight: 600 }}>
          <Table stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Device ID</TableCell>
                <TableCell>Model</TableCell>
                <TableCell>OS</TableCell>
                <TableCell>Member</TableCell>
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
                  <TableCell>{device.member_id || '—'}</TableCell>
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
                    {device.status === 'active' ? (
                      <IconButton
                        size="small"
                        onClick={() => onDeactivate(device.id)}
                        color="warning"
                        title="Deactivate"
                      >
                        <Stop />
                      </IconButton>
                    ) : (
                      <IconButton
                        size="small"
                        onClick={() => onMarkAsLost(device.id)}
                        color="error"
                        title="Mark as Lost"
                      >
                        <GpsFixed />
                      </IconButton>
                    )}
                    <IconButton
                      size="small"
                      onClick={() => onSendCommand(device.id, 'alarm')}
                      color="warning"
                      title="Trigger Alarm"
                      disabled={device.status !== 'active'}
                    >
                      <Alarm />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={() => onSendCommand(device.id, 'camera')}
                      color="info"
                      title="Take Photo"
                      disabled={device.status !== 'active'}
                    >
                      <CameraAlt />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={() => onResetDevice(device.id, device.member_id)}
                      color="error"
                      title="Reset / Uninstall Device"
                    >
                      <Delete />
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

// Members Tab Component
function MembersTab({ members, onDelete, onActivate }) {
  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>Members</Typography>
        <TableContainer component={Paper} sx={{ maxHeight: 600 }}>
          <Table stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Email</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Device</TableCell>
                <TableCell>Device Status</TableCell>
                <TableCell>Joined</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>{member.email}</TableCell>
                  <TableCell>
                    <Chip
                      label={member.status}
                      color={member.status === 'active' ? 'success' : 'default'}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>
                    {member.device_id ? `${member.device_id.substring(0, 12)}...` : 'No device'}
                  </TableCell>
                  <TableCell>
                    {member.device_status ? (
                      <Chip
                        label={member.device_status}
                        color={member.device_status === 'active' ? 'error' : 'default'}
                        size="small"
                      />
                    ) : '—'}
                  </TableCell>
                  <TableCell>{format(new Date(member.created_at), 'MMM dd, yyyy')}</TableCell>
                  <TableCell>
                    {member.device_id && member.device_status === 'dormant' && (
                      <Button
                        size="small"
                        variant="outlined"
                        color="success"
                        onClick={() => onActivate(member.member_id)}
                        sx={{ mr: 1 }}
                      >
                        Activate
                      </Button>
                    )}
                    <IconButton
                      size="small"
                      onClick={() => onDelete(member.member_id)}
                      color="error"
                      title="Delete Member"
                    >
                      <Delete />
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
    { name: 'Active', value: analytics.activeDevices || 0, color: '#f44336' },
    { name: 'Dormant', value: analytics.dormantDevices || 0, color: '#9e9e9e' },
    { name: 'Reported', value: analytics.reportedDevices || 0, color: '#ff9800' }
  ].filter(d => d.value > 0);

  const timelineData = (analytics.timeline || []).map(t => ({
    time: format(new Date(t.time), 'HH:mm'),
    pings: t.pings
  }));

  return (
    <Grid container spacing={3}>
      <Grid item xs={12} md={3}>
        <Card>
          <CardContent>
            <Typography color="textSecondary" gutterBottom>
              Total Devices
            </Typography>
            <Typography variant="h4">
              {analytics.totalDevices || 0}
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
              {analytics.activeDevices || 0}
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
              {analytics.locationPings || 0}
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
              {analytics.alertsToday || 0}
            </Typography>
          </CardContent>
        </Card>
      </Grid>
      <Grid item xs={12} md={3}>
        <Card>
          <CardContent>
            <Typography color="textSecondary" gutterBottom>
              Total Members
            </Typography>
            <Typography variant="h4" color="success.main">
              {analytics.totalMembers || 0}
            </Typography>
          </CardContent>
        </Card>
      </Grid>
      <Grid item xs={12} md={9} />
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
              Activity Timeline (24h)
            </Typography>
            {timelineData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={timelineData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="time" />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="pings" stroke="#1a73e8" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <Box sx={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Typography color="textSecondary">No activity in the last 24 hours</Typography>
              </Box>
            )}
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );
}

// Reports Tab Component
function ReportsTab({ authToken }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadReports();
  }, []);

  const loadReports = async () => {
    try {
      const response = await fetch(`${API_BASE}/admin/reports`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      const data = await response.json();
      if (data.success) {
        setReports(data.reports);
      }
    } catch (error) {
      console.error('Failed to load reports:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'pending': return 'warning';
      case 'verified': return 'success';
      case 'rejected': return 'error';
      default: return 'default';
    }
  };

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Reports & Alerts
        </Typography>
        {loading ? (
          <Typography color="textSecondary">Loading reports...</Typography>
        ) : reports.length === 0 ? (
          <Typography color="textSecondary">No reports yet</Typography>
        ) : (
          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>ID</TableCell>
                  <TableCell>Device</TableCell>
                  <TableCell>Info</TableCell>
                  <TableCell>Last Alert</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Created</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {reports.map((report) => (
                  <TableRow key={report.id}>
                    <TableCell>#{report.id}</TableCell>
                    <TableCell>{report.device_id ? `${report.device_id.substring(0, 12)}...` : '—'}</TableCell>
                    <TableCell>{report.user_info || '—'}</TableCell>
                    <TableCell>{report.last_alert || '—'}</TableCell>
                    <TableCell>
                      <Chip
                        label={report.status}
                        color={getStatusColor(report.status)}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>{format(new Date(report.created_at), 'MMM dd, yyyy HH:mm')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>
    </Card>
  );
}

export default AdminDashboard;