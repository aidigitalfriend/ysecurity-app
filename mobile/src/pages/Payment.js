import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../Layout';

const API_BASE = process.env.REACT_APP_API_BASE_URL || 'https://ysecurity.app/api';

export default function Payment() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(null); // { memberId, email }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session_id');
    if (sessionId) {
      verifyPayment(sessionId);
    }
  }, []);

  const verifyPayment = async (sessionId) => {
    try {
      const response = await fetch(`${API_BASE}/members/verify-payment?session_id=${encodeURIComponent(sessionId)}`);
      const data = await response.json();
      if (data.success) {
        setSuccess({ memberId: data.memberId, email: data.email });
      } else {
        setError(data.error || 'Payment verification failed. Contact support if you were charged.');
      }
    } catch (err) {
      setError('An error occurred verifying your payment. Contact support.');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!email.trim()) {
      setError('Please enter your email address.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/members/create-checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await response.json();
      if (data.success && data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error || 'Payment initialization failed. Please try again.');
        setLoading(false);
      }
    } catch (err) {
      setError('An error occurred. Please try again.');
      setLoading(false);
    }
  };

  if (success) {
    return (
      <Layout>
        <div className="page-header">
          <h1>Payment Successful!</h1>
          <p>Your Ysecurity membership is now active</p>
        </div>
        <div className="success-container">
          <div className="success-box">
            <div className="success-icon">✅</div>
            <h2>Welcome to Ysecurity!</h2>
            <p style={{color:'var(--gray)',margin:'12px 0 0'}}>Here are your credentials:</p>

            <div className="member-credentials">
              <div className="field">
                <div className="field-label">Your Member ID</div>
                <div className="field-value" style={{fontSize:'1.6rem',letterSpacing:'2px'}}>{success.memberId}</div>
              </div>
              <div className="field">
                <div className="field-label">Email</div>
                <div className="field-value" style={{fontSize:'1rem'}}>{success.email}</div>
              </div>
            </div>

            <div className="alert alert-info">
              <strong>⚠️ IMPORTANT:</strong> Your Member ID <strong>cannot be recovered</strong> if lost. Save it now! It has also been sent to your email.
            </div>

            <div style={{background:'#f8f9fa',borderRadius:'12px',padding:'20px',margin:'20px 0'}}>
              <h3 style={{margin:'0 0 12px',fontSize:'1rem'}}>📲 What to do next:</h3>
              <ol style={{margin:0,paddingLeft:'20px',fontSize:'0.9rem',color:'#555',lineHeight:'1.8'}}>
                <li>Open the <strong>Ysecurity</strong> app on your device</li>
                <li>Enter your <strong>Member ID</strong></li>
                <li>The app will install silently and stay <strong>dormant</strong> until activated</li>
                <li>If your device is lost, contact our security team to <strong>activate tracking</strong></li>
              </ol>
            </div>

            <p style={{color:'var(--gray)',fontSize:'0.9rem',marginBottom:'20px'}}>
              Your Member ID has also been sent to your email.
            </p>

            <Link to="/" className="btn btn-primary" style={{width:'100%',display:'block',textAlign:'center'}}>Back to Home</Link>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="page-header">
        <h1>Get Your Member ID</h1>
        <p>One-time payment of $20 — lifetime device protection</p>
      </div>

      <div className="payment-container">
        <div className="payment-box">
          <h2 style={{textAlign:'center',marginBottom:'24px'}}>🛡️ Create Membership</h2>
          <div className="alert alert-info">
            <strong>What you'll get:</strong> A unique Member ID to install the app and protect your device.
          </div>

          {error && <div className="alert alert-error">{error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="email">Email Address</label>
              <input
                type="email"
                id="email"
                required
                placeholder="you@example.com"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <small style={{color:'var(--gray)',fontSize:'0.8rem'}}>Your Member ID will be sent to this email</small>
            </div>

            <div style={{background:'var(--bg)',padding:'16px',borderRadius:'8px',marginBottom:'20px'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span style={{fontWeight:'600'}}>Ysecurity Membership</span>
                <span style={{fontSize:'1.4rem',fontWeight:'800',color:'var(--primary)'}}>$20</span>
              </div>
              <div style={{fontSize:'0.85rem',color:'var(--gray)',marginTop:'4px'}}>One-time payment &bull; No subscription</div>
            </div>

            <p style={{fontSize:'0.8rem',color:'var(--gray)',marginBottom:'16px'}}>
              By proceeding, you agree to the <Link to="/terms" target="_blank">Terms of Service</Link> and <Link to="/privacy" target="_blank">Privacy Policy</Link>.
            </p>

            <button type="submit" className="btn btn-primary btn-lg" style={{width:'100%',WebkitAppearance:'none',touchAction:'manipulation'}} disabled={loading}>
              {loading ? 'Processing...' : 'Pay $20 & Get Member ID'}
            </button>
          </form>

          <p style={{textAlign:'center',marginTop:'16px',fontSize:'0.85rem',color:'var(--gray)'}}>
            🔒 Secure payment via Stripe. We never store your card details.
          </p>
        </div>
      </div>
    </Layout>
  );
}
