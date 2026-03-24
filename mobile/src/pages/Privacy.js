import React from 'react';
import Layout from '../Layout';

const highlightBox = {
  background: '#fff3cd',
  border: '2px solid #ffc107',
  borderRadius: '10px',
  padding: '20px 24px',
  margin: '24px 0',
};

const highlightTitle = {
  color: '#856404',
  fontWeight: 700,
  fontSize: '1.1rem',
  marginBottom: '12px',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
};

const highlightText = {
  color: '#856404',
  fontWeight: 600,
  lineHeight: 1.7,
  margin: 0,
};

const redBox = {
  background: '#fce8e6',
  border: '2px solid #c5221f',
  borderRadius: '10px',
  padding: '20px 24px',
  margin: '24px 0',
};

const redTitle = {
  color: '#c5221f',
  fontWeight: 700,
  fontSize: '1.1rem',
  marginBottom: '12px',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
};

const redText = {
  color: '#a50e0e',
  fontWeight: 600,
  lineHeight: 1.7,
  margin: 0,
};

export default function Privacy() {
  return (
    <Layout>
      <div className="page-header">
        <h1>Privacy Policy</h1>
        <p>Last updated: March 24, 2026</p>
      </div>
      <div className="content">
        <h2>1. Introduction</h2>
        <p>Ysecurity ("we," "our," or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use the Ysecurity mobile application and website (collectively, the "Service").</p>
        <p>By using our Service, you agree to the collection and use of information in accordance with this policy.</p>

        <h2>2. Information We Collect</h2>
        <p><strong>Personal Information:</strong></p>
        <ul>
          <li>Email address (provided during membership registration)</li>
          <li>Payment information (processed securely via Stripe; we do not store card details)</li>
          <li>Member ID and associated account data</li>
        </ul>
        <p><strong>Device Information:</strong></p>
        <ul>
          <li>Device model and operating system</li>
          <li>Unique device identifier</li>
          <li>GPS location data (latitude, longitude, accuracy)</li>
          <li>Battery level and network connectivity status</li>
          <li>Photos captured via remote camera feature (only when activated by the device owner)</li>
        </ul>

        <h2>3. Your Member ID &amp; Privacy Protection</h2>

        <div style={highlightBox}>
          <div style={highlightTitle}>⚠️ IMPORTANT — Member ID Is Created Only Once</div>
          <p style={highlightText}>
            Your unique Member ID is generated <strong>one time only</strong> — at the moment your payment is successfully processed and the Ysecurity app is installed on your device. This ID is the sole key that links your account to your device's security system. It is not stored by Ysecurity staff and cannot be regenerated, duplicated, or looked up after creation.
          </p>
        </div>

        <div style={redBox}>
          <div style={redTitle}>🚫 If You Lose Your Member ID — No Recovery Is Possible</div>
          <p style={redText}>
            If you lose your Member ID, <strong>Ysecurity cannot recover it for you</strong>. Without your Member ID, we cannot activate your security system, track your device, or access any data related to your device. No one — including the Ysecurity team — can retrieve any device information without this ID. This is by design to protect your privacy.
          </p>
          <ul style={{ ...redText, paddingLeft: '20px', marginTop: '12px' }}>
            <li>We <strong>cannot</strong> recover or reset a lost Member ID</li>
            <li>We <strong>cannot</strong> track or locate any device without the Member ID</li>
            <li>We <strong>cannot</strong> access any data associated with a device without the Member ID</li>
            <li>The <strong>only option</strong> if you lose your ID is: uninstall the app, create a new account, make a new payment ($20), and receive a new Member ID</li>
          </ul>
        </div>

        <p>This design ensures that <strong>your privacy is fully protected</strong>. Your device data is accessible only to the person who holds the Member ID — and that person is you. No Ysecurity employee, administrator, or third party can access your device information without your Member ID. You are in complete control.</p>

        <h2>4. How We Use Your Information</h2>
        <p>We use the collected information to:</p>
        <ul>
          <li>Provide and maintain the device tracking and security service</li>
          <li>Process membership payments</li>
          <li>Generate and manage your unique Member ID</li>
          <li>Enable real-time GPS tracking and location history</li>
          <li>Send remote commands (alarm, camera) to your registered device</li>
          <li>Send geofence alerts and notifications</li>
          <li>Assist in device recovery when reported lost or stolen</li>
          <li>Communicate service updates and important notices via email</li>
          <li>Improve and optimize our Service</li>
        </ul>

        <h2>5. Location Data</h2>
        <p>Ysecurity collects location data from your registered device to provide tracking and recovery services. Location data is:</p>
        <ul>
          <li>Collected only from devices that have the Ysecurity app installed and activated with a valid Member ID</li>
          <li>Stored securely in encrypted databases</li>
          <li>Accessible only by the holder of the corresponding Member ID</li>
          <li>Used solely for the purpose of device security and recovery</li>
          <li><strong>Inaccessible to anyone — including Ysecurity staff — without the Member ID</strong></li>
        </ul>

        <h2>6. Data Security</h2>
        <p>We implement industry-standard security measures to protect your data, including:</p>
        <ul>
          <li>SSL/TLS encryption for all data in transit</li>
          <li>Encrypted database storage</li>
          <li>Member ID–based access control (no ID = no access)</li>
          <li>Rate limiting and access controls</li>
          <li>Regular security audits</li>
        </ul>

        <h2>7. Third-Party Services</h2>
        <p>We use the following third-party services:</p>
        <ul>
          <li><strong>Stripe:</strong> For secure payment processing. Stripe's privacy policy applies to payment data.</li>
          <li><strong>Amazon Web Services (AWS):</strong> For hosting and database services.</li>
          <li><strong>OpenStreetMap:</strong> For map rendering in the admin dashboard.</li>
        </ul>
        <p>No third-party service has access to your Member ID or the ability to retrieve device tracking data.</p>

        <h2>8. Data Retention</h2>
        <p>We retain your data for as long as your membership is active. Location data is retained for a period of 90 days, after which it is automatically deleted. You may request deletion of your account and associated data at any time by contacting us.</p>

        <h2>9. Your Rights</h2>
        <p>You have the right to:</p>
        <ul>
          <li>Access the personal data we hold about you (Member ID required for verification)</li>
          <li>Request correction of inaccurate data</li>
          <li>Request deletion of your data and account</li>
          <li>Object to processing of your data</li>
        </ul>

        <h2>10. Contact</h2>
        <p>For privacy inquiries, contact us at <a href="mailto:support@ysecurity.app">support@ysecurity.app</a>.</p>
      </div>
    </Layout>
  );
}
