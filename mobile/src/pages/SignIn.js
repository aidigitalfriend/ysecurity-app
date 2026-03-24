import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Layout from '../Layout';

const API_BASE = process.env.REACT_APP_API_BASE_URL || 'https://ysecurity.app/api';

export default function SignIn() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE}/auth/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await response.json();
      if (data.success) {
        localStorage.setItem('ys_token', data.token);
        localStorage.setItem('ys_member', JSON.stringify(data.member));
        // Redirect to payment if not paid, otherwise to app
        if (data.member.paymentStatus === 'completed') {
          navigate('/app');
        } else {
          navigate('/payment');
        }
      } else {
        setError(data.error || 'Sign in failed. Please try again.');
      }
    } catch (err) {
      setError('An error occurred. Please try again.');
    }
    setLoading(false);
  };

  return (
    <Layout>
      <div className="page-header">
        <h1>Welcome Back</h1>
        <p>Sign in to your Ysecurity account</p>
      </div>

      <div className="auth-container">
        <div className="auth-box">
          <h2 style={{ textAlign: 'center', marginBottom: '24px' }}>🛡️ Sign In</h2>

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
            </div>

            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input
                type="password"
                id="password"
                required
                placeholder="Your password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <div style={{ textAlign: 'right', marginBottom: '16px' }}>
              <Link to="/forgot-password" style={{ fontSize: '0.85rem' }}>Forgot Password?</Link>
            </div>

            <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={loading}>
              {loading ? 'Signing In...' : 'Sign In'}
            </button>
          </form>

          <p style={{ textAlign: 'center', marginTop: '20px', fontSize: '0.9rem' }}>
            Don't have an account? <Link to="/signup">Create Account</Link>
          </p>
        </div>
      </div>
    </Layout>
  );
}
