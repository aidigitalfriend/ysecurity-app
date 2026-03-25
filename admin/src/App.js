import React, { useState, useEffect, useCallback } from 'react';
import {
  AppBar, Toolbar, Typography, Container, Grid, Card, CardContent,
  Button, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, Paper, Chip, IconButton, Alert, Snackbar, Tabs, Tab,
  Box, List, ListItem, ListItemText, ListItemIcon, Divider, Breadcrumbs, Link,
  CircularProgress, ImageList, ImageListItem, Badge
} from '@mui/material';
import {
  Map as MapIcon, LocationOn, Security, CameraAlt,
  Alarm, GpsFixed, BatteryFull, NetworkCheck, Analytics,
  Devices, Timeline, Notifications, People, Delete,
  PlayArrow, Stop, Folder, FolderOpen, Photo, History,
  Wifi, SignalCellularAlt, ArrowBack, Info
} from '@mui/icons-material';
import { MapContainer, TileLayer, Marker, Popup, Circle } from 'react-leaflet';
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
        const errMsg = data.error || (data.errors && data.errors.map(e => e.msg).join(', ')) || 'Delete failed';
        showAlert(errMsg, 'error');
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

  // Full-page login screen when not authenticated
  if (loginDialog) {
    return (
      <Box sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #1a237e 0%, #0d47a1 50%, #01579b 100%)',
      }}>
        <Paper elevation={8} sx={{
          p: 5,
          width: '100%',
          maxWidth: 400,
          borderRadius: 3,
          textAlign: 'center',
        }}>
          <Security sx={{ fontSize: 48, color: '#1a237e', mb: 1 }} />
          <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
            Ysecurity Admin
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Sign in to access the dashboard
          </Typography>
          <TextField
            autoFocus
            margin="dense"
            label="Username"
            fullWidth
            value={loginData.username}
            onChange={(e) => setLoginData({...loginData, username: e.target.value})}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            sx={{ mb: 2 }}
          />
          <TextField
            margin="dense"
            label="Password"
            type="password"
            fullWidth
            value={loginData.password}
            onChange={(e) => setLoginData({...loginData, password: e.target.value})}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            sx={{ mb: 3 }}
          />
          <Button
            variant="contained"
            fullWidth
            size="large"
            onClick={handleLogin}
            sx={{
              py: 1.5,
              fontWeight: 600,
              backgroundColor: '#1a237e',
              '&:hover': { backgroundColor: '#0d47a1' },
            }}
          >
            LOGIN
          </Button>
        </Paper>
        <Snackbar
          open={alert.open}
          autoHideDuration={4000}
          onClose={() => setAlert({...alert, open: false})}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          <Alert severity={alert.severity} onClose={() => setAlert({...alert, open: false})}>
            {alert.message}
          </Alert>
        </Snackbar>
      </Box>
    );
  }

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
            authToken={authToken}
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

// Devices Tab Component with Directory View
function DevicesTab({ devices, authToken, onViewLocations, onMarkAsLost, onSendCommand, onActivate, onDeactivate, onResetDevice }) {
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  const [deviceDir, setDeviceDir] = useState(null);
  const [openFolder, setOpenFolder] = useState(null); // 'pictures' | 'location' | 'network' | 'activity'
  const [folderData, setFolderData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [geofenceDialog, setGeofenceDialog] = useState({ open: false, lat: '', lng: '', radius: '500' });

  const getStatusColor = (status) => {
    switch (status) {
      case 'active': return 'error';
      case 'dormant': return 'default';
      case 'verified': return 'warning';
      case 'reported': return 'info';
      default: return 'default';
    }
  };

  const openDeviceDirectory = async (deviceId) => {
    setLoading(true);
    setSelectedDeviceId(deviceId);
    setOpenFolder(null);
    setFolderData(null);
    try {
      const response = await fetch(`${API_BASE}/admin/devices/${encodeURIComponent(deviceId)}/directory`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      const data = await response.json();
      if (data.success) {
        setDeviceDir(data);
      }
    } catch (error) {
      console.error('Failed to load device directory:', error);
    } finally {
      setLoading(false);
    }
  };

  const openFolderContent = async (folder) => {
    setLoading(true);
    setOpenFolder(folder);
    try {
      let endpoint = '';
      if (folder === 'pictures') endpoint = 'photos';
      else if (folder === 'location') endpoint = 'locations';
      else if (folder === 'network') endpoint = 'network';
      else if (folder === 'activity') endpoint = 'activity';

      const response = await fetch(`${API_BASE}/admin/devices/${encodeURIComponent(selectedDeviceId)}/${endpoint}`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      const data = await response.json();
      if (data.success) {
        setFolderData(data);
      }
    } catch (error) {
      console.error(`Failed to load ${folder}:`, error);
    } finally {
      setLoading(false);
    }
  };

  const goBack = () => {
    if (openFolder) {
      setOpenFolder(null);
      setFolderData(null);
    } else {
      setSelectedDeviceId(null);
      setDeviceDir(null);
    }
  };

  // Folder content views
  const renderFolderContent = () => {
    if (!folderData) return <CircularProgress />;

    if (openFolder === 'pictures') {
      const photos = folderData.photos || [];
      return (
        <Box>
          <Typography variant="h6" gutterBottom>📸 Pictures ({photos.length})</Typography>
          {photos.length === 0 ? (
            <Typography color="textSecondary">No photos captured yet. Use the camera command to capture photos.</Typography>
          ) : (
            <Grid container spacing={2}>
              {photos.map((photo) => (
                <Grid item xs={6} md={4} lg={3} key={photo.id}>
                  <Card>
                    <Box sx={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#f0f0f0' }}>
                      <img
                        src={`${API_BASE}/admin/devices/${encodeURIComponent(selectedDeviceId)}/photos/${photo.id}/file?token=${authToken}`}
                        alt={photo.filename}
                        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                        onError={(e) => { e.target.src = ''; e.target.alt = 'Failed to load'; }}
                      />
                    </Box>
                    <CardContent sx={{ py: 1 }}>
                      <Typography variant="caption" display="block">{format(new Date(photo.created_at), 'MMM dd, yyyy HH:mm')}</Typography>
                      <Typography variant="caption" color="textSecondary">{(photo.file_size / 1024).toFixed(1)} KB</Typography>
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>
          )}
        </Box>
      );
    }

    if (openFolder === 'location') {
      const locations = folderData.locations || [];
      return (
        <Box>
          <Typography variant="h6" gutterBottom>📍 Location History ({locations.length})</Typography>
          {locations.length === 0 ? (
            <Typography color="textSecondary">No location data yet. Activate the device to start tracking.</Typography>
          ) : (
            <>
              <Box sx={{ height: 350, mb: 2 }}>
                <MapContainer
                  center={[locations[0].latitude, locations[0].longitude]}
                  zoom={13}
                  style={{ height: '100%', width: '100%', borderRadius: 8 }}
                >
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
                  {locations.map((loc, i) => (
                    <Marker key={i} position={[loc.latitude, loc.longitude]}>
                      <Popup>
                        {format(new Date(loc.timestamp), 'MMM dd, HH:mm:ss')}<br/>
                        Battery: {loc.battery}% | Net: {loc.network_type}
                      </Popup>
                    </Marker>
                  ))}
                </MapContainer>
              </Box>
              <TableContainer component={Paper} sx={{ maxHeight: 300 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>Time</TableCell>
                      <TableCell>Latitude</TableCell>
                      <TableCell>Longitude</TableCell>
                      <TableCell>Battery</TableCell>
                      <TableCell>Network</TableCell>
                      <TableCell>Accuracy</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {locations.map((loc, i) => (
                      <TableRow key={i}>
                        <TableCell>{format(new Date(loc.timestamp), 'MMM dd, HH:mm:ss')}</TableCell>
                        <TableCell>{Number(loc.latitude).toFixed(6)}</TableCell>
                        <TableCell>{Number(loc.longitude).toFixed(6)}</TableCell>
                        <TableCell>{loc.battery}%</TableCell>
                        <TableCell>{loc.network_type}</TableCell>
                        <TableCell>{loc.accuracy}m</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </>
          )}
        </Box>
      );
    }

    if (openFolder === 'network') {
      const history = folderData.networkHistory || [];
      const types = folderData.networkTypes || [];
      return (
        <Box>
          <Typography variant="h6" gutterBottom>🌐 Network Info</Typography>
          {history.length === 0 ? (
            <Typography color="textSecondary">No network data available yet.</Typography>
          ) : (
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <Card>
                  <CardContent>
                    <Typography variant="subtitle1" gutterBottom>Current</Typography>
                    <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                      <Box>
                        <Typography variant="caption" color="textSecondary">Network Type</Typography>
                        <Typography variant="h6">{history[0].network_type}</Typography>
                      </Box>
                      <Box>
                        <Typography variant="caption" color="textSecondary">Battery</Typography>
                        <Typography variant="h6">{history[0].battery}%</Typography>
                      </Box>
                      <Box>
                        <Typography variant="caption" color="textSecondary">Last Seen</Typography>
                        <Typography variant="h6">{format(new Date(history[0].timestamp), 'HH:mm:ss')}</Typography>
                      </Box>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={12} md={6}>
                <Card>
                  <CardContent>
                    <Typography variant="subtitle1" gutterBottom>Network Distribution</Typography>
                    {types.map((t) => (
                      <Box key={t.network_type} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.5 }}>
                        <Chip label={t.network_type} size="small" icon={t.network_type === 'wifi' ? <Wifi /> : <SignalCellularAlt />} />
                        <Typography>{t.count} pings</Typography>
                      </Box>
                    ))}
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={12}>
                <TableContainer component={Paper} sx={{ maxHeight: 300 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>Time</TableCell>
                        <TableCell>Network</TableCell>
                        <TableCell>Battery</TableCell>
                        <TableCell>Accuracy</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {history.map((h, i) => (
                        <TableRow key={i}>
                          <TableCell>{format(new Date(h.timestamp), 'MMM dd, HH:mm:ss')}</TableCell>
                          <TableCell>{h.network_type}</TableCell>
                          <TableCell>{h.battery}%</TableCell>
                          <TableCell>{h.accuracy}m</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Grid>
            </Grid>
          )}
        </Box>
      );
    }

    if (openFolder === 'activity') {
      const activities = folderData.activities || [];
      return (
        <Box>
          <Typography variant="h6" gutterBottom>📋 Activity Logs ({activities.length})</Typography>
          {activities.length === 0 ? (
            <Typography color="textSecondary">No activity logged yet.</Typography>
          ) : (
            <TableContainer component={Paper} sx={{ maxHeight: 500 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Time</TableCell>
                    <TableCell>Action</TableCell>
                    <TableCell>Details</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {activities.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>{format(new Date(a.created_at), 'MMM dd, yyyy HH:mm:ss')}</TableCell>
                      <TableCell>
                        <Chip label={a.action} size="small" variant="outlined" />
                      </TableCell>
                      <TableCell sx={{ maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {a.details || '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Box>
      );
    }
  };

  // Device Directory View
  if (selectedDeviceId && deviceDir) {
    const { device, folders, installLocation, latestLocation, geofence } = deviceDir;
    const folderConfig = [
      { key: 'pictures', label: 'Pictures', icon: '📸', subtitle: 'Photos & Images', count: folders.pictures, color: '#e3f2fd' },
      { key: 'location', label: 'Location', icon: '📍', subtitle: 'GPS Data', count: folders.location, color: '#e8f5e9' },
      { key: 'network', label: 'Network', icon: '🌐', subtitle: 'Network Info', count: folders.network, color: '#fff3e0' },
      { key: 'activity', label: 'Activity', icon: '📋', subtitle: 'Logs & Info', count: folders.activity, color: '#fce4ec' },
    ];

    return (
      <Card>
        <CardContent>
          {/* Breadcrumb navigation */}
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <IconButton onClick={goBack} sx={{ mr: 1 }}>
              <ArrowBack />
            </IconButton>
            <Breadcrumbs>
              <Link component="button" underline="hover" onClick={() => { setSelectedDeviceId(null); setDeviceDir(null); }}>
                Devices
              </Link>
              <Link component="button" underline="hover" onClick={() => { setOpenFolder(null); setFolderData(null); }}>
                {device.model} ({device.id.substring(0, 12)}...)
              </Link>
              {openFolder && <Typography color="text.primary">{openFolder.charAt(0).toUpperCase() + openFolder.slice(1)}</Typography>}
            </Breadcrumbs>
          </Box>

          {/* Folder content or folder grid */}
          {openFolder ? (
            loading ? <Box sx={{ textAlign: 'center', py: 4 }}><CircularProgress /></Box> : renderFolderContent()
          ) : (
            <>
              {/* Device header info */}
              <Box sx={{ mb: 3, p: 2, bgcolor: '#f5f5f5', borderRadius: 2 }}>
                <Grid container spacing={2} alignItems="center">
                  <Grid item xs={12} md={6}>
                    <Typography variant="h6">{device.model}</Typography>
                    <Typography variant="body2" color="textSecondary">OS: {device.os}</Typography>
                    <Typography variant="body2" color="textSecondary">Member: {device.member_id}</Typography>
                    <Typography variant="body2" color="textSecondary">Registered: {format(new Date(device.created_at), 'MMM dd, yyyy HH:mm')}</Typography>
                    <Box sx={{ mt: 1 }}>
                      <Chip label={device.status} color={getStatusColor(device.status)} size="small" />
                    </Box>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    {installLocation && (
                      <Box>
                        <Typography variant="subtitle2" color="textSecondary">📍 Install Location</Typography>
                        <Typography variant="body2">
                          {Number(installLocation.latitude).toFixed(6)}, {Number(installLocation.longitude).toFixed(6)}
                        </Typography>
                        <Typography variant="caption" color="textSecondary">
                          {format(new Date(installLocation.timestamp), 'MMM dd, yyyy HH:mm:ss')}
                        </Typography>
                      </Box>
                    )}
                  </Grid>
                </Grid>
                {/* Action buttons */}
                <Box sx={{ mt: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  {device.status !== 'active' && (
                    <Button size="small" variant="contained" color="success" startIcon={<PlayArrow />} onClick={() => onActivate()}>
                      Activate Device
                    </Button>
                  )}
                  {device.status !== 'active' && (
                    <Button size="small" variant="outlined" color="error" startIcon={<GpsFixed />} onClick={() => onMarkAsLost(device.id)}>
                      Mark as Lost
                    </Button>
                  )}
                  {device.status === 'active' && (
                    <Button size="small" variant="outlined" color="warning" startIcon={<Stop />} onClick={() => onDeactivate(device.id)}>
                      Deactivate
                    </Button>
                  )}
                  <Button size="small" variant="outlined" color="warning" startIcon={<Alarm />} onClick={() => onSendCommand(device.id, 'alarm')} disabled={device.status !== 'active'}>
                    Alarm
                  </Button>
                  <Button size="small" variant="outlined" color="info" startIcon={<CameraAlt />} onClick={() => onSendCommand(device.id, 'camera')} disabled={device.status !== 'active'}>
                    Camera
                  </Button>
                  <Button size="small" variant="outlined" color="secondary" startIcon={<LocationOn />}
                    disabled={device.status !== 'active'}
                    onClick={() => {
                      const lat = latestLocation ? latestLocation.latitude : '';
                      const lng = latestLocation ? latestLocation.longitude : '';
                      setGeofenceDialog({ open: true, lat: lat.toString(), lng: lng.toString(), radius: geofence ? geofence.radius.toString() : '500' });
                    }}
                  >
                    Set Geofence
                  </Button>
                  <Button size="small" variant="outlined" color="error" startIcon={<Delete />} onClick={() => onResetDevice(device.id, device.member_id)}>
                    Delete
                  </Button>
                </Box>
              </Box>

              {/* Folder grid */}
              <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 600 }}>Device Directory</Typography>
              <Grid container spacing={2}>
                {folderConfig.map((f) => (
                  <Grid item xs={6} md={3} key={f.key}>
                    <Card
                      sx={{
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        bgcolor: f.color,
                        '&:hover': { transform: 'translateY(-4px)', boxShadow: 4 },
                      }}
                      onClick={() => openFolderContent(f.key)}
                    >
                      <CardContent sx={{ textAlign: 'center', py: 3 }}>
                        <Typography sx={{ fontSize: 48, mb: 1 }}>{f.icon}</Typography>
                        <Typography variant="h6" sx={{ fontWeight: 600 }}>{f.label}</Typography>
                        <Typography variant="body2" color="textSecondary">{f.subtitle}</Typography>
                        <Badge badgeContent={f.count} color="primary" sx={{ mt: 1 }}>
                          <Chip label={`${f.count} items`} size="small" variant="outlined" />
                        </Badge>
                      </CardContent>
                    </Card>
                  </Grid>
                ))}
              </Grid>

              {/* Device Location Map */}
              {latestLocation && (
                <Box sx={{ mt: 3 }}>
                  <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>📍 Device Location</Typography>
                  <Box sx={{ height: 300, borderRadius: 2, overflow: 'hidden', border: '1px solid #e0e0e0' }}>
                    <MapContainer
                      center={[Number(latestLocation.latitude), Number(latestLocation.longitude)]}
                      zoom={14}
                      style={{ height: '100%', width: '100%' }}
                    >
                      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
                      <Marker position={[Number(latestLocation.latitude), Number(latestLocation.longitude)]}>
                        <Popup>
                          <strong>{device.model}</strong><br/>
                          Last seen: {format(new Date(latestLocation.timestamp), 'MMM dd, yyyy HH:mm:ss')}<br/>
                          Battery: {latestLocation.battery}%<br/>
                          Network: {latestLocation.network_type}
                        </Popup>
                      </Marker>
                      {geofence && geofence.lat && geofence.lng && geofence.radius && (
                        <Circle
                          center={[Number(geofence.lat), Number(geofence.lng)]}
                          radius={Number(geofence.radius)}
                          pathOptions={{ color: '#9c27b0', fillColor: '#ce93d8', fillOpacity: 0.2 }}
                        />
                      )}
                    </MapContainer>
                  </Box>
                  <Box sx={{ mt: 1, display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                    <Typography variant="body2" color="textSecondary">
                      Lat: {Number(latestLocation.latitude).toFixed(6)}, Lng: {Number(latestLocation.longitude).toFixed(6)}
                    </Typography>
                    <Typography variant="body2" color="textSecondary">
                      🔋 {latestLocation.battery}% | 📡 {latestLocation.network_type}
                    </Typography>
                    <Typography variant="body2" color="textSecondary">
                      Last updated: {format(new Date(latestLocation.timestamp), 'MMM dd, yyyy HH:mm:ss')}
                    </Typography>
                  </Box>
                  {geofence && (
                    <Chip
                      label={`Geofence: ${geofence.radius}m radius`}
                      color="secondary"
                      size="small"
                      variant="outlined"
                      sx={{ mt: 1 }}
                      icon={<LocationOn />}
                    />
                  )}
                </Box>
              )}
              {!latestLocation && (
                <Box sx={{ mt: 3, p: 2, bgcolor: '#f5f5f5', borderRadius: 2, textAlign: 'center' }}>
                  <Typography color="textSecondary">📍 No location data yet. Device will report its location once activated.</Typography>
                </Box>
              )}

              {/* Geofence Dialog */}
              <Dialog open={geofenceDialog.open} onClose={() => setGeofenceDialog({ ...geofenceDialog, open: false })}>
                <DialogTitle>Set Geofence Area</DialogTitle>
                <DialogContent>
                  <Typography variant="body2" sx={{ mb: 2 }}>
                    Define a geofence zone for this device. You will be alerted when the device leaves this area.
                  </Typography>
                  <TextField
                    margin="dense" label="Center Latitude" fullWidth type="number"
                    value={geofenceDialog.lat}
                    onChange={(e) => setGeofenceDialog({ ...geofenceDialog, lat: e.target.value })}
                    inputProps={{ step: '0.0001', min: -90, max: 90 }}
                    sx={{ mb: 1 }}
                  />
                  <TextField
                    margin="dense" label="Center Longitude" fullWidth type="number"
                    value={geofenceDialog.lng}
                    onChange={(e) => setGeofenceDialog({ ...geofenceDialog, lng: e.target.value })}
                    inputProps={{ step: '0.0001', min: -180, max: 180 }}
                    sx={{ mb: 1 }}
                  />
                  <TextField
                    margin="dense" label="Radius (meters)" fullWidth type="number"
                    value={geofenceDialog.radius}
                    onChange={(e) => setGeofenceDialog({ ...geofenceDialog, radius: e.target.value })}
                    inputProps={{ min: 50, max: 50000, step: 50 }}
                  />
                </DialogContent>
                <DialogActions>
                  <Button onClick={() => setGeofenceDialog({ ...geofenceDialog, open: false })}>Cancel</Button>
                  <Button
                    variant="contained" color="secondary"
                    onClick={() => {
                      const { lat, lng, radius } = geofenceDialog;
                      if (lat && lng && radius) {
                        onSendCommand(device.id, 'geofence', { lat: parseFloat(lat), lng: parseFloat(lng), radius: parseInt(radius) });
                        setGeofenceDialog({ ...geofenceDialog, open: false });
                        setTimeout(() => openDeviceDirectory(device.id), 1000);
                      }
                    }}
                  >
                    Set Geofence
                  </Button>
                </DialogActions>
              </Dialog>
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  // Device list view (default)
  return (
    <Card>
      <CardContent>
        <Typography variant="h6" sx={{ mb: 2 }}>Device Registry</Typography>
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
                <TableRow
                  key={device.id}
                  hover
                  sx={{ cursor: 'pointer' }}
                  onClick={() => openDeviceDirectory(device.id)}
                >
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Folder color="primary" fontSize="small" />
                      {device.id.substring(0, 12)}...
                    </Box>
                  </TableCell>
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
                      onClick={(e) => { e.stopPropagation(); onMarkAsLost(device.id); }}
                      color="error"
                      title="Mark as Lost"
                    >
                      <GpsFixed />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={(e) => { e.stopPropagation(); onSendCommand(device.id, 'alarm'); }}
                      color="warning"
                      title="Trigger Alarm"
                      disabled={device.status !== 'active'}
                    >
                      <Alarm />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={(e) => { e.stopPropagation(); onSendCommand(device.id, 'camera'); }}
                      color="info"
                      title="Take Photo"
                      disabled={device.status !== 'active'}
                    >
                      <CameraAlt />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={(e) => { e.stopPropagation(); onResetDevice(device.id, device.member_id); }}
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