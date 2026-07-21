import { Navigate, Route, Routes } from "react-router-dom";
import { RequireRole } from "./auth";
import { Shell } from "./components/Shell";
import { Landing } from "./pages/Landing";
import { Login } from "./pages/Login";
import { Learn } from "./pages/examinee/Learn";
import { ExamPage } from "./pages/examinee/ExamPage";
import { Dashboard } from "./pages/merchant/Dashboard";
import { CandidatePage } from "./pages/merchant/CandidatePage";

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route
          path="/learn"
          element={
            <RequireRole role="examinee">
              <Learn />
            </RequireRole>
          }
        />
        <Route
          path="/learn/exams/:examId"
          element={
            <RequireRole role="examinee">
              <ExamPage />
            </RequireRole>
          }
        />
        <Route
          path="/dashboard"
          element={
            <RequireRole role="merchant">
              <Dashboard />
            </RequireRole>
          }
        />
        <Route
          path="/dashboard/candidates/:candidateId"
          element={
            <RequireRole role="merchant">
              <CandidatePage />
            </RequireRole>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
