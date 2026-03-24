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

export default function Terms() {
  return (
    <Layout>
      <div className="page-header">
        <h1>Terms of Service</h1>
        <p>Last updated: March 24, 2026</p>
      </div>
      <div className="content">
        <h2>1. Acceptance of Terms</h2>
        <p>By accessing or using the Ysecurity application and website ("Service"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, do not use the Service.</p>

        <h2>2. Description of Service</h2>
        <p>Ysecurity provides a device security and anti-theft service for tablets and mobile devices. The Service includes:</p>
        <ul>
          <li>Real-time GPS location tracking</li>
          <li>Remote alarm activation</li>
          <li>Remote camera capture</li>
          <li>Geofence monitoring and alerts</li>
          <li>Battery and network status monitoring</li>
          <li>Device recovery assistance</li>
        </ul>
        <p>The Service is designed exclusively for tablets and mobile devices (Android and iOS). It is not available for desktop computers or laptops.</p>

        <h2>3. Membership and Payment</h2>
        <ul>
          <li>Access to Ysecurity requires a one-time membership payment of <strong>$20 USD</strong>.</li>
          <li>Upon successful payment, you will receive a unique Member ID.</li>
          <li>The Member ID is required to install, activate, and use the Ysecurity app on your device.</li>
          <li>Membership is non-transferable and tied to the email address used during registration.</li>
          <li>All payments are processed securely through Stripe.</li>
        </ul>

        <h2>4. Member ID — Critical Terms</h2>

        <div style={highlightBox}>
          <div style={highlightTitle}>⚠️ IMPORTANT — Your Member ID Is Created Only Once</div>
          <p style={highlightText}>
            Your Member ID is generated <strong>one time only</strong> when you complete your payment and install the Ysecurity app on your device. This ID is the only key that activates the security system on your device. It cannot be regenerated, duplicated, or looked up by anyone — including the Ysecurity team.
          </p>
        </div>

        <div style={redBox}>
          <div style={redTitle}>🚫 LOST MEMBER ID — NO RECOVERY POSSIBLE</div>
          <p style={redText}>By using this Service, you acknowledge and agree to the following:</p>
          <ul style={{ ...redText, paddingLeft: '20px', marginTop: '12px' }}>
            <li>If you lose your Member ID, <strong>it cannot be recovered by anyone</strong>, including Ysecurity support</li>
            <li>Without your Member ID, we <strong>cannot activate</strong> the security system on your device</li>
            <li>Without your Member ID, we <strong>cannot track</strong> your device or retrieve any location data</li>
            <li>Without your Member ID, <strong>no one</strong> — not even the Ysecurity team — can access any information about your device</li>
            <li>If your Member ID is lost, the <strong>only resolution</strong> is:
              <ol style={{ marginTop: '8px', paddingLeft: '20px' }}>
                <li>Delete/uninstall the Ysecurity app from your device</li>
                <li>We will remove your old account from our system</li>
                <li>You must create a new account and make a <strong>new payment ($20 USD)</strong></li>
                <li>A <strong>new Member ID</strong> will be generated for you</li>
              </ol>
            </li>
          </ul>
        </div>

        <p><strong>You are solely responsible for storing your Member ID securely.</strong> We recommend saving it in a password manager, writing it down in a secure location, or taking a screenshot immediately upon receiving it. Do not share your Member ID with anyone.</p>

        <h2>5. Privacy by Design</h2>
        <p>The Member ID system is designed this way <strong>intentionally to protect your privacy</strong>:</p>
        <ul>
          <li>Your device data is accessible <strong>only</strong> to the person who holds the Member ID</li>
          <li>No Ysecurity employee or administrator can access your device data without the Member ID</li>
          <li>No third party can request or retrieve your device tracking information without the Member ID</li>
          <li>This ensures that <strong>you — and only you</strong> — have control over your device's security data</li>
        </ul>

        <h2>6. Permitted Use</h2>
        <p>You agree to use Ysecurity only for:</p>
        <ul>
          <li>Protecting your own devices that you legally own</li>
          <li>Recovering devices that have been lost or stolen</li>
          <li>Monitoring devices with the knowledge and consent of the user</li>
        </ul>

        <h2>7. Prohibited Use</h2>
        <p>You must NOT use Ysecurity to:</p>
        <ul>
          <li>Track, monitor, or surveil any person without their explicit consent</li>
          <li>Install the app on devices you do not own without authorization</li>
          <li>Use the remote camera feature to invade anyone's privacy</li>
          <li>Engage in stalking, harassment, or any illegal activity</li>
          <li>Attempt to reverse engineer, hack, or compromise the Service</li>
          <li>Use the Service for any purpose that violates applicable laws</li>
        </ul>

        <h2>8. Refund Policy</h2>
        <p>The $20 membership fee is <strong>non-refundable</strong> once the Member ID has been generated and delivered. If you experience issues with payment processing, contact us within 7 days for assistance.</p>

        <h2>9. Service Availability</h2>
        <ul>
          <li>We strive to maintain the Service available 24/7, but do not guarantee uninterrupted access.</li>
          <li>The accuracy of GPS tracking depends on device hardware, network conditions, and environmental factors.</li>
          <li>We are not liable for any failure to track or recover a device.</li>
          <li>We reserve the right to modify, suspend, or discontinue the Service at any time with reasonable notice.</li>
        </ul>

        <h2>10. Limitation of Liability</h2>
        <p>To the maximum extent permitted by law, Ysecurity is provided "as is" without warranties of any kind. We shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including but not limited to losses resulting from a lost Member ID or inability to recover a device.</p>

        <h2>11. Contact</h2>
        <p>For questions about these Terms, contact us at <a href="mailto:support@ysecurity.app">support@ysecurity.app</a>.</p>
      </div>
    </Layout>
  );
}
