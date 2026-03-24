import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../Layout';

const API_BASE = process.env.REACT_APP_API_BASE_URL || 'https://ysecurity.app/api';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await response.json();
      if (data.success) {
        setSuccess(data.message || 'If an account exists with that email, a reset link has been sent.');
      } else {
        setError(data.error || 'Failed to send reset link. Please try again.');
      }
    } catch (err) {
      setError('An error occurred. Please try again.');
    }
    setLoading(false);
  };

  return (
    <Layout>
      <div className="page-header">
        <h1>Forgot Password</h1>
        <p>Enter your email to receive a password reset link</p>
      </div>

      <div className="auth-container">
        <div className="auth-box">
          <h2 style={{ textAlign: 'center', marginBottom: '24px' }}>🔑 Reset Password</h2>

          {error && <div className="alert alert-error">{error}</div>}
          {success && <div className="alert alert-success">{success}</div>}

          {!success ? (
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
                <small style={{ color: 'var(--gray)', fontSize: '0.8rem' }}>We'll send a password reset link to this email</small>
              </div>

              <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={loading}>
                {loading ? 'Sending...' : 'Send Reset Link'}
              </button>
            </form>
          ) : (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: '3rem', marginBottom: '16px' }}>📧</div>
              <p style={{ fontSize: '0.95rem', color: 'var(--gray)', marginBottom: '20px' }}>
                Check your email inbox (and spam folder) for the reset link.
              </p>
              <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => { setSuccess(''); setEmail(''); }}>
                Send Again
              </button>
            </div>
          )}

          <p style={{ textAlign: 'center', marginTop: '20px', fontSize: '0.9rem' }}>
            Remember your password? <Link to="/signin">Sign In</Link>
          </p>
        </div>
      </div>
    </Layout>
  );
}
