import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./site.css";
import DeviceApp from "./pages/DeviceApp";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DeviceApp />} />
        <Route path="/app" element={<DeviceApp />} />
        <Route path="*" element={<DeviceApp />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
