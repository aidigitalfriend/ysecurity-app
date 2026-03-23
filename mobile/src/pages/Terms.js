import React from 'react';
import Layout from '../Layout';

export default function Terms() {
  return (
    <Layout>
      <div className="page-header">
        <h1>Terms of Service</h1>
        <p>Last updated: March 23, 2026</p>
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
          <li>Access to Ysecurity requires a one-time membership payment of $20 USD.</li>
          <li>Upon successful payment, you will receive a unique Member ID.</li>
          <li>The Member ID is required to install, activate, and use the Ysecurity app.</li>
          <li>Membership is non-transferable and tied to the email address used during registration.</li>
          <li>All payments are processed securely through Stripe.</li>
        </ul>

        <h2>4. Member ID</h2>
        <ul>
          <li>You are responsible for keeping your Member ID secure.</li>
          <li>Your Member ID is essential for device recovery — store it safely.</li>
          <li>Do not share your Member ID with others.</li>
          <li>If you believe your credentials have been compromised, contact us immediately.</li>
          <li>We are not responsible for losses resulting from unauthorized use of your credentials.</li>
        </ul>

        <h2>5. Permitted Use</h2>
        <p>You agree to use Ysecurity only for:</p>
        <ul>
          <li>Protecting your own devices that you legally own</li>
          <li>Recovering devices that have been lost or stolen</li>
          <li>Monitoring devices with the knowledge and consent of the user</li>
        </ul>

        <h2>6. Prohibited Use</h2>
        <p>You must NOT use Ysecurity to:</p>
        <ul>
          <li>Track, monitor, or surveil any person without their explicit consent</li>
          <li>Install the app on devices you do not own without authorization</li>
          <li>Use the remote camera feature to invade anyone's privacy</li>
          <li>Engage in stalking, harassment, or any illegal activity</li>
          <li>Attempt to reverse engineer, hack, or compromise the Service</li>
          <li>Use the Service for any purpose that violates applicable laws</li>
        </ul>

        <h2>7. Refund Policy</h2>
        <p>The $20 membership fee is non-refundable once the Member ID has been generated and delivered. If you experience issues with payment processing, contact us within 7 days for assistance.</p>

        <h2>8. Service Availability</h2>
        <ul>
          <li>We strive to maintain the Service available 24/7, but do not guarantee uninterrupted access.</li>
          <li>The accuracy of GPS tracking depends on device hardware, network conditions, and environmental factors.</li>
          <li>We are not liable for any failure to track or recover a device.</li>
          <li>We reserve the right to modify, suspend, or discontinue the Service at any time with reasonable notice.</li>
        </ul>

        <h2>9. Limitation of Liability</h2>
        <p>To the maximum extent permitted by law, Ysecurity is provided "as is" without warranties of any kind. We shall not be liable for any indirect, incidental, special, consequential, or punitive damages.</p>

        <h2>10. Contact</h2>
        <p>For questions about these Terms, contact us at <a href="mailto:support@ysecurity.app">support@ysecurity.app</a>.</p>
      </div>
    </Layout>
  );
}
