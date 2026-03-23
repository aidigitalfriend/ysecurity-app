import React from 'react';
import Layout from '../Layout';

export default function Privacy() {
  return (
    <Layout>
      <div className="page-header">
        <h1>Privacy Policy</h1>
        <p>Last updated: March 23, 2026</p>
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

        <h2>3. How We Use Your Information</h2>
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

        <h2>4. Location Data</h2>
        <p>Ysecurity collects location data from your registered device to provide tracking and recovery services. Location data is:</p>
        <ul>
          <li>Collected only from devices that have the Ysecurity app installed and activated</li>
          <li>Stored securely in encrypted databases</li>
          <li>Accessible only by the registered member and authorized administrators</li>
          <li>Used solely for the purpose of device security and recovery</li>
        </ul>

        <h2>5. Data Security</h2>
        <p>We implement industry-standard security measures to protect your data, including:</p>
        <ul>
          <li>SSL/TLS encryption for all data in transit</li>
          <li>Encrypted database storage</li>
          <li>Rate limiting and access controls</li>
          <li>Regular security audits</li>
        </ul>

        <h2>6. Third-Party Services</h2>
        <p>We use the following third-party services:</p>
        <ul>
          <li><strong>Stripe:</strong> For secure payment processing. Stripe's privacy policy applies to payment data.</li>
          <li><strong>Amazon Web Services (AWS):</strong> For hosting and database services.</li>
          <li><strong>OpenStreetMap:</strong> For map rendering in the admin dashboard.</li>
        </ul>

        <h2>7. Data Retention</h2>
        <p>We retain your data for as long as your membership is active. Location data is retained for a period of 90 days, after which it is automatically deleted. You may request deletion of your account and associated data at any time by contacting us.</p>

        <h2>8. Your Rights</h2>
        <p>You have the right to:</p>
        <ul>
          <li>Access the personal data we hold about you</li>
          <li>Request correction of inaccurate data</li>
          <li>Request deletion of your data</li>
          <li>Object to processing of your data</li>
        </ul>

        <h2>9. Contact</h2>
        <p>For privacy inquiries, contact us at <a href="mailto:support@ysecurity.app">support@ysecurity.app</a>.</p>
      </div>
    </Layout>
  );
}
