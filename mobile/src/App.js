import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './site.css';
import Landing from './pages/Landing';
import Payment from './pages/Payment';
import Services from './pages/Services';
import Privacy from './pages/Privacy';
import Terms from './pages/Terms';
import DeviceApp from './pages/DeviceApp';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/payment" element={<Payment />} />
        <Route path="/payment.html" element={<Payment />} />
        <Route path="/services" element={<Services />} />
        <Route path="/services.html" element={<Services />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/privacy.html" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/terms.html" element={<Terms />} />
        <Route path="/app" element={<DeviceApp />} />
        <Route path="/app.html" element={<DeviceApp />} />
        <Route path="*" element={<Landing />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
