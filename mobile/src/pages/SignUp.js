import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Layout from '../Layout';

const API_BASE = process.env.REACT_APP_API_BASE_URL || 'https://ysecurity.app/api';

export default function SignUp() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password }),
      });
      const data = await response.json();
      if (data.success) {
        localStorage.setItem('ys_token', data.token);
        localStorage.setItem('ys_member', JSON.stringify(data.member));
        navigate('/payment');
      } else {
        setError(data.error || 'Signup failed. Please try again.');
      }
    } catch (err) {
      setError('An error occurred. Please try again.');
    }
    setLoading(false);
  };

  return (
    <Layout>
      <div className="page-header">
        <h1>Create Account</h1>
        <p>Sign up to get your Ysecurity membership</p>
      </div>

      <div className="auth-container">
        <div className="auth-box">
          <h2 style={{ textAlign: 'center', marginBottom: '24px' }}>🛡️ Sign Up</h2>

          {error && <div className="alert alert-error">{error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="name">Full Name</label>
              <input
                type="text"
                id="name"
                required
                placeholder="John Doe"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

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
                minLength={6}
                placeholder="At least 6 characters"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label htmlFor="confirmPassword">Confirm Password</label>
              <input
                type="password"
                id="confirmPassword"
                required
                minLength={6}
                placeholder="Repeat your password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>

            <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={loading}>
              {loading ? 'Creating Account...' : 'Create Account'}
            </button>
          </form>

          <p style={{ textAlign: 'center', marginTop: '20px', fontSize: '0.9rem' }}>
            Already have an account? <Link to="/signin">Sign In</Link>
          </p>

          <p style={{ textAlign: 'center', marginTop: '8px', fontSize: '0.8rem', color: 'var(--gray)' }}>
            By signing up, you agree to the <Link to="/terms" target="_blank">Terms of Service</Link> and <Link to="/privacy" target="_blank">Privacy Policy</Link>.
          </p>
        </div>
      </div>
    </Layout>
  );
}
