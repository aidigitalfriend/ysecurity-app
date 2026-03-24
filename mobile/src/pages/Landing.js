import React from 'react';
import { Link } from 'react-router-dom';
import Layout from '../Layout';

export default function Landing() {
  return (
    <Layout>
      <section className="hero">
        <div className="hero-badge">📱 For Tablets &amp; Mobile Devices Only</div>
        <h1>Protect Your Device.<br/>Recover What's Yours.</h1>
        <p>Ysecurity turns your tablet or mobile device into a smart-secured asset with real-time GPS tracking, remote alarm, camera capture, and instant recovery tools.</p>
        <div className="hero-buttons">
          <Link to="/app" className="btn btn-lg" style={{background:'#4caf50',color:'#fff',fontSize:'18px',padding:'16px 40px'}}>🛡️ Install App on This Device</Link>
          <Link to="/services" className="btn btn-lg btn-outline" style={{borderColor:'#fff',color:'#fff'}}>Learn More</Link>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Why Ysecurity?</h2>
        <p className="section-subtitle">Advanced anti-theft protection designed specifically for tablets and mobile devices.</p>
        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-icon">📍</div>
            <h3>Real-Time GPS Tracking</h3>
            <p>Track your device's exact location in real-time with high-accuracy GPS, Wi-Fi, and cellular positioning.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">🔔</div>
            <h3>Remote Alarm</h3>
            <p>Trigger a loud alarm remotely even if your device is on silent mode. Find it instantly when nearby.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">📸</div>
            <h3>Stealth Camera Capture</h3>
            <p>Remotely capture photos using front or rear cameras. Identify who has your device.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">🔐</div>
            <h3>Member ID Recovery</h3>
            <p>Your unique Member ID lets you activate tracking and recover your device if lost or stolen.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">🌐</div>
            <h3>Geofence Alerts</h3>
            <p>Set safety zones and get instant alerts if your device leaves the designated area.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">🔋</div>
            <h3>Battery &amp; Network Monitor</h3>
            <p>Monitor battery level and network connectivity status of your device remotely.</p>
          </div>
        </div>
      </section>

      <section className="section" style={{background:'#fff'}}>
        <h2 className="section-title">How It Works</h2>
        <p className="section-subtitle">Get protected in 4 simple steps.</p>
        <div className="steps">
          <div className="step">
            <div className="step-number">1</div>
            <h3>Pay Once — $20</h3>
            <p>Make a one-time payment of $20 to create your Ysecurity membership. No subscriptions, no hidden fees.</p>
          </div>
          <div className="step">
            <div className="step-number">2</div>
            <h3>Get Your Member ID</h3>
            <p>After payment, you'll receive a unique Member ID instantly. Save it securely.</p>
          </div>
          <div className="step">
            <div className="step-number">3</div>
            <h3>Install the App</h3>
            <p>Open the Ysecurity app on your tablet or mobile device and enter your Member ID.</p>
          </div>
          <div className="step">
            <div className="step-number">4</div>
            <h3>Stay Protected</h3>
            <p>Your device stays silently secured. If lost or stolen, contact us and we'll activate tracking to recover it.</p>
          </div>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Simple Pricing</h2>
        <p className="section-subtitle">One payment. Lifetime protection.</p>
        <div className="pricing-card">
          <h3>Ysecurity Membership</h3>
          <div className="price">$20</div>
          <div className="price-type">One-time payment</div>
          <ul>
            <li>Unique Member ID</li>
            <li>Real-time GPS Tracking</li>
            <li>Remote Alarm &amp; Camera</li>
            <li>Geofence Alerts</li>
            <li>Device Recovery Support</li>
            <li>Lifetime access — no monthly fees</li>
          </ul>
          <Link to="/payment" className="btn btn-primary btn-lg" style={{width:'100%'}}>Get Started</Link>
        </div>
      </section>

      <section className="section" style={{background:'#fff'}}>
        <h2 className="section-title">Device Compatibility</h2>
        <p className="section-subtitle">Ysecurity is built exclusively for tablets and mobile devices.</p>
        <div className="features-grid" style={{maxWidth:'600px',margin:'0 auto'}}>
          <div className="feature-card">
            <div className="feature-icon">📱</div>
            <h3>Android Phones &amp; Tablets</h3>
            <p>Android 8.0 (Oreo) and above. Phones and tablets supported.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">🍎</div>
            <h3>iPhone &amp; iPad</h3>
            <p>iOS 14.0 and above. Compatible with all iPhone and iPad models.</p>
          </div>
        </div>
      </section>
    </Layout>
  );
}
