import { Navigate, Route, Routes } from "react-router-dom";
import { RequireRole } from "./auth";
import { Shell } from "./components/Shell";
import { Landing } from "./pages/Landing";
import { Login } from "./pages/Login";
import { Learn } from "./pages/examinee/Learn";
import { ExamPage } from "./pages/examinee/ExamPage";
import { Result } from "./pages/examinee/Result";
import { Dashboard } from "./pages/merchant/Dashboard";
import { CandidatePage } from "./pages/merchant/CandidatePage";
import { Settings } from "./pages/merchant/Settings";
import { Team } from "./pages/merchant/Team";
import { Billing } from "./pages/merchant/Billing";
import { Invite } from "./pages/merchant/Invite";
import { Compare } from "./pages/merchant/Compare";

function examinee(page: React.ReactNode) {
  return <RequireRole role="examinee">{page}</RequireRole>;
}
function merchant(page: React.ReactNode) {
  return <RequireRole role="merchant">{page}</RequireRole>;
}

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/learn" element={examinee(<Learn />)} />
        <Route path="/learn/exams/:examId" element={examinee(<ExamPage />)} />
        <Route path="/learn/results/:examId" element={examinee(<Result />)} />
        <Route path="/dashboard" element={merchant(<Dashboard />)} />
        <Route path="/dashboard/candidates/:candidateId" element={merchant(<CandidatePage />)} />
        <Route path="/dashboard/compare" element={merchant(<Compare />)} />
        <Route path="/dashboard/invite" element={merchant(<Invite />)} />
        <Route path="/dashboard/team" element={merchant(<Team />)} />
        <Route path="/dashboard/settings" element={merchant(<Settings />)} />
        <Route path="/dashboard/billing" element={merchant(<Billing />)} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
