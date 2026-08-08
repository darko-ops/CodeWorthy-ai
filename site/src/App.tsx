import { Navigate, Route, Routes } from "react-router-dom";
import { Landing } from "./pages/Landing";
import { Login } from "./pages/Login";
import { AuthComplete } from "./pages/AuthComplete";
import { RepoDashboard } from "./pages/steward/RepoDashboard";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/auth/complete" element={<AuthComplete />} />
      {/* GitHub-only: RepoDashboard sends anon visitors to /login. */}
      <Route path="/dashboard" element={<RepoDashboard />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
