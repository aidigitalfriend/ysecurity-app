import React, { useState } from 'react';
import { Link } from 'react-router-dom';

export default function Layout({ children }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <nav className="navbar">
        <div className="nav-container">
          <Link to="/" className="nav-logo"><span className="shield">🛡️</span> Ysecurity</Link>
          <button className="nav-toggle" onClick={() => setMenuOpen(!menuOpen)}>☰</button>
          <ul className={`nav-links${menuOpen ? ' active' : ''}`}>
            <li><Link to="/" onClick={() => setMenuOpen(false)}>Home</Link></li>
            <li><Link to="/services" onClick={() => setMenuOpen(false)}>Services</Link></li>
            <li><Link to="/privacy" onClick={() => setMenuOpen(false)}>Privacy</Link></li>
            <li><Link to="/terms" onClick={() => setMenuOpen(false)}>Terms</Link></li>
            <li><Link to="/payment" className="btn btn-primary" style={{padding:'8px 20px',fontSize:'0.9rem'}} onClick={() => setMenuOpen(false)}>Get Started</Link></li>
          </ul>
        </div>
      </nav>

      {children}

      <footer className="footer">
        <div className="footer-container">
          <div>
            <h4>🛡️ Ysecurity</h4>
            <p style={{fontSize:'0.9rem',color:'var(--gray)'}}>Smart device security for<br/>tablets &amp; mobile devices.</p>
          </div>
          <div>
            <h4>Product</h4>
            <ul>
              <li><Link to="/services">Services</Link></li>
              <li><Link to="/payment">Get Member ID</Link></li>
            </ul>
          </div>
          <div>
            <h4>Legal</h4>
            <ul>
              <li><Link to="/privacy">Privacy Policy</Link></li>
              <li><Link to="/terms">Terms of Service</Link></li>
            </ul>
          </div>
          <div>
            <h4>Contact</h4>
            <ul>
              <li><a href="mailto:support@ysecurity.app">support@ysecurity.app</a></li>
            </ul>
          </div>
        </div>
        <div className="footer-bottom">&copy; 2026 Ysecurity. All rights reserved.</div>
      </footer>
    </>
  );
}
