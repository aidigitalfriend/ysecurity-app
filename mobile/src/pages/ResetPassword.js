import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Layout from '../Layout';

const API_BASE = process.env.REACT_APP_API_BASE_URL || 'https://ysecurity.app/api';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!token) {
      setError('Invalid reset link. Please request a new one.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await response.json();
      if (data.success) {
        setSuccess(data.message || 'Password has been reset successfully.');
      } else {
        setError(data.error || 'Failed to reset password. Please try again.');
      }
    } catch (err) {
      setError('An error occurred. Please try again.');
    }
    setLoading(false);
  };

  if (!token) {
    return (
      <Layout>
        <div className="page-header">
          <h1>Invalid Link</h1>
          <p>This password reset link is invalid or has expired</p>
        </div>
        <div className="auth-container">
          <div className="auth-box" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '3rem', marginBottom: '16px' }}>⚠️</div>
            <p style={{ color: 'var(--gray)', marginBottom: '20px' }}>Please request a new password reset link.</p>
            <Link to="/forgot-password" className="btn btn-primary" style={{ display: 'inline-block' }}>Request New Link</Link>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="page-header">
        <h1>Reset Password</h1>
        <p>Enter your new password below</p>
      </div>

      <div className="auth-container">
        <div className="auth-box">
          <h2 style={{ textAlign: 'center', marginBottom: '24px' }}>🔐 New Password</h2>

          {error && <div className="alert alert-error">{error}</div>}

          {success ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: '3rem', marginBottom: '16px' }}>✅</div>
              <p style={{ fontSize: '1rem', fontWeight: '600', marginBottom: '12px' }}>{success}</p>
              <Link to="/signin" className="btn btn-primary btn-lg" style={{ width: '100%', display: 'block', textAlign: 'center' }}>
                Sign In
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="password">New Password</label>
                <input
                  type="password"
                  id="password"
                  required
                  minLength={6}
                  placeholder="At least 6 characters"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label htmlFor="confirmPassword">Confirm New Password</label>
                <input
                  type="password"
                  id="confirmPassword"
                  required
                  minLength={6}
                  placeholder="Repeat your new password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>

              <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={loading}>
                {loading ? 'Resetting...' : 'Reset Password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </Layout>
  );
}
