import React from 'react';
import { Link } from 'react-router-dom';
import Layout from '../Layout';

export default function Services() {
  return (
    <Layout>
      <div className="page-header">
        <h1>Our Services</h1>
        <p>Complete device security for your tablet and mobile device</p>
      </div>

      <section className="section">
        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-icon">📍</div>
            <h3>Real-Time GPS Tracking</h3>
            <p>Track your device's precise location in real-time using GPS, Wi-Fi, and cellular network triangulation. View live location on an interactive map with accuracy indicators. Location history is stored securely so you can trace your device's movements over time.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">🔔</div>
            <h3>Remote Alarm</h3>
            <p>Lost your device nearby? Trigger a loud alarm remotely that sounds even when your device is set to silent or vibrate mode. The alarm continues until manually stopped on the device, making it easy to locate in cushions, bags, or nearby locations.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">📸</div>
            <h3>Stealth Camera Capture</h3>
            <p>Remotely activate the front or rear camera on your device without any visible indication. Capture photos of the person using your stolen device. Photos are securely transmitted to your dashboard and sent to your email for evidence.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">🌐</div>
            <h3>Geofence Alerts</h3>
            <p>Define virtual boundaries (geofences) around locations like your home, office, or school. Receive instant notifications when your device enters or leaves these zones. Set custom radius for each geofence zone from 100m to 5km.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">🔋</div>
            <h3>Battery &amp; Connectivity Monitoring</h3>
            <p>Monitor your device's battery level and network status in real-time. Receive alerts when battery drops below critical levels. Know whether your device is connected via Wi-Fi, cellular data, or offline — essential for tracking operations.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">🔐</div>
            <h3>Member ID Recovery System</h3>
            <p>Your unique Member ID serves as your recovery key. If your device is lost or stolen, your Member ID activates all tracking features. Your Member ID is linked to your device, ensuring only you can trigger recovery actions.</p>
          </div>
        </div>
      </section>

      <section className="section" style={{background:'#fff'}}>
        <h2 className="section-title">How Device Recovery Works</h2>
        <p className="section-subtitle">When your tablet or mobile device goes missing, Ysecurity has you covered.</p>
        <div className="steps">
          <div className="step">
            <div className="step-number">1</div>
            <h3>Report Lost Device</h3>
            <p>Contact the Ysecurity team with your Member ID. Report your device as lost or stolen.</p>
          </div>
          <div className="step">
            <div className="step-number">2</div>
            <h3>Activate Tracking</h3>
            <p>Tracking mode is activated. Your device's location is updated in real-time on the dashboard map.</p>
          </div>
          <div className="step">
            <div className="step-number">3</div>
            <h3>Use Recovery Tools</h3>
            <p>Trigger remote alarm, capture photos, and monitor location. All evidence is logged and emailed to you.</p>
          </div>
          <div className="step">
            <div className="step-number">4</div>
            <h3>Recover Your Device</h3>
            <p>Use the live tracking data and captured evidence to recover your device or assist law enforcement.</p>
          </div>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Supported Devices</h2>
        <p className="section-subtitle">Ysecurity is designed exclusively for tablets and mobile devices.</p>
        <div className="features-grid" style={{maxWidth:'700px',margin:'0 auto'}}>
          <div className="feature-card">
            <div className="feature-icon">📱</div>
            <h3>Android</h3>
            <p><strong>Phones:</strong> All Android smartphones running Android 8.0 (Oreo) or above.</p>
            <p><strong>Tablets:</strong> Samsung Galaxy Tab, Lenovo Tab, and other Android tablets.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">🍎</div>
            <h3>iOS</h3>
            <p><strong>iPhone:</strong> iPhone 8 and later running iOS 14.0+.</p>
            <p><strong>iPad:</strong> All iPad models running iPadOS 14.0+.</p>
          </div>
        </div>
      </section>

      <section className="section" style={{background:'linear-gradient(135deg,#1a73e8 0%,#0d47a1 100%)',color:'#fff',textAlign:'center',borderRadius:0}}>
        <h2 style={{fontSize:'2rem',marginBottom:'16px',color:'#fff'}}>Ready to Protect Your Device?</h2>
        <p style={{opacity:0.9,marginBottom:'32px',fontSize:'1.1rem'}}>Get your Ysecurity Member ID today — one-time $20 payment, lifetime protection.</p>
        <Link to="/payment" className="btn btn-lg" style={{background:'#fff',color:'#1a73e8'}}>Get Started — $20</Link>
      </section>
    </Layout>
  );
}
