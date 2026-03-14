# sercret-security

## Overview
Sercret-Security is a comprehensive device tracking and security system designed for anti-theft protection. The system consists of a mobile app (device-side) and a backend server that work together to provide location tracking, device management, and security features.

**Important Note on Activation:** The system is installed in a dormant state and does not activate tracking or any security features upon installation. Activation only occurs after a user reports the device as lost/stolen, provides verification information, and the security team manually verifies and confirms the report. Only then is the device marked as lost, and the system activates to begin tracking and security measures.

## Setup Instructions

### Backend Setup
1. Navigate to the `backend` directory
2. Run `npm install` to install dependencies
3. Update the Stripe secret key and email credentials in `server.js`
4. Run `npm start` to start the server on port 3000
5. Access admin interface at `http://localhost:3000/admin.html`

### Mobile App Setup
1. Navigate to the `mobile` directory
2. Run `npm install` to install dependencies
3. For web development: `npm start`
4. For native: Install Capacitor CLI globally if needed, then:
   - `npx cap add android` or `npx cap add ios`
   - `npx cap sync`
   - `npx cap run android` or `npx cap run ios`

## App (Device Side)

### Core Features
| Feature | Implementation |
|---------|---------------|
| Silent install — no app icon visible | Capacitor + Android LAUNCHER category removed |
| One device = one license | Device fingerprint (IMEI-style ID) registered to server — 2nd install blocked |
| Background GPS ping (screen off) | Capacitor Background Geolocation plugin |
| Auto-start on reboot | Android BOOT_COMPLETED broadcast receiver |
| Can't be uninstalled easily | Android device admin privileges (locks uninstall) |
| Sends battery %, network type, GPS accuracy | Included in each ping |

### Activation Mechanism
- **Dormant Installation:** App installs silently without user interaction or visible activation
- **No Immediate Activation:** System remains inactive until manually activated by security team
- **Verification Required:** User must report device as lost/stolen with verification details
- **Security Team Verification:** Team matches and verifies user information before activation
- **Manual Activation:** Only after verification is the device marked as lost and system activated

## Backend

### Core Features
| Feature | Implementation |
|---------|---------------|
| Device registry | devices table — unique ID, model, OS, owner |
| Location history | location_pings table — lat, lng, accuracy, battery, timestamp |
| "Mark as Lost" | Changes device status → triggers faster ping interval |
| Payment → reveal location | Stripe one-time payment → unlock coordinates |
| Admin sees all devices on map | Leaflet map, all device pins |
| Notification to owner | Email/SMS when location traced |

### Activation Process
1. User reports device as lost/stolen through secure channel
2. User provides verification information (e.g., device details, purchase info, personal identifiers)
3. Security team manually reviews and verifies the report
4. Upon verification, security team marks device as "lost" in backend
5. Backend sends activation signal to device
6. Device activates tracking and security features
7. System begins location pinging and monitoring

## Interesting Extra Features

### Remote Security Features
| Feature | Implementation |
|---------|---------------|
| Remote alarm | Admin triggers loud alarm on stolen device (alert in app) |
| Remote camera snap | Silently take front camera photo, send to server |
| SIM change alert | If network changes, immediately ping with alert |
| Geofence alert | Device can be configured with geofence (command sent) |
| Location history replay | See where device traveled over time (admin map)

### Additional Security Measures
- **Tamper Detection:** Detects attempts to uninstall or disable the app
- **Network Monitoring:** Tracks network changes and SIM card swaps
- **Battery Optimization:** Efficient background operation to minimize battery drain
- **Data Encryption:** All communications encrypted end-to-end
- **Privacy Controls:** Location data only accessible after payment and verification

## System Architecture

### Device States
1. **Installed (Dormant):** App installed but inactive
2. **Reported:** User has reported device lost, awaiting verification
3. **Verified:** Security team has confirmed report
4. **Active (Lost):** Device marked lost, tracking activated
5. **Recovered:** Device recovered, tracking can be deactivated

### Security Considerations
- Device fingerprinting prevents unauthorized installations
- Manual activation prevents false positives
- Payment gateway integration for location access
- Admin privileges protect against easy removal
- Background operation ensures continuous monitoring

## Next Steps

### 1. Environment Setup
```bash
# Install dependencies
cd backend && npm install
cd ../mobile && npm install

# Start backend server
cd backend && npm start

# In another terminal, start mobile web app
cd mobile && npm start
```

### 2. Test the System
- Open `http://localhost:3000/admin.html` in browser
- Register a test device (simulate in mobile app)
- Mark device as lost in admin
- Test remote commands (alarm, camera, geofence)
- Check location tracking

### 3. Add Native Platforms
```bash
cd mobile
npx cap add android
npx cap add ios
npx cap sync
```

### 4. Configure Android Native Features
Edit `mobile/android/app/src/main/AndroidManifest.xml`:

```xml
<!-- Remove LAUNCHER category to hide app icon -->
<intent-filter android:enabled="false">
    <action android:name="android.intent.action.MAIN" />
    <category android:name="android.intent.category.LAUNCHER" />
</intent-filter>

<!-- Add device admin for uninstall protection -->
<receiver android:name=".DeviceAdminReceiver"
    android:label="@string/app_name"
    android:description="@string/app_name"
    android:permission="android.permission.BIND_DEVICE_ADMIN">
    <meta-data android:name="android.app.device_admin"
        android:resource="@xml/device_admin" />
    <intent-filter>
        <action android:name="android.app.action.DEVICE_ADMIN_ENABLED" />
    </intent-filter>
</receiver>

<!-- Add boot receiver for auto-start -->
<receiver android:name=".BootReceiver">
    <intent-filter>
        <action android:name="android.intent.action.BOOT_COMPLETED" />
    </intent-filter>
</receiver>
```

### 5. Create Device Admin Resources
Create `mobile/android/app/src/main/res/xml/device_admin.xml`:
```xml
<device-admin xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-policies>
        <disable-camera />
        <disable-keyguard-features />
    </uses-policies>
</device-admin>
```

### 6. Implement Custom Plugins
For advanced features, create Capacitor plugins:
- Device admin management
- Silent installation
- Enhanced SIM monitoring
- Advanced geofencing

### 7. Security Hardening
- Implement JWT authentication for admin
- Encrypt sensitive data
- Add rate limiting
- Secure API keys (Stripe, email)
- Database encryption

### 8. Testing & Deployment
- Unit tests for backend APIs
- Integration tests for mobile app
- End-to-end testing of activation flow
- Deploy backend to cloud (Heroku, AWS, etc.)
- Publish mobile app to stores
- Set up monitoring and logging

### 9. Production Configuration
- Update API_BASE URLs
- Configure production database
- Set up email/SMS services
- Implement payment processing
- Add user authentication for reports

### 10. Documentation & Support
- User guide for reporting lost devices
- Admin manual
- API documentation
- Support channels for users
