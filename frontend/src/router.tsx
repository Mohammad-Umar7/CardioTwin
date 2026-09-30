/**
 * Routes (HashRouter — works on static hosting under any sub-path). Pages are code-split; the
 * persistent 3D canvas lives in the shell, so navigating never remounts the scene.
 */
import { lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppShell } from '@/features/shell/AppShell';
import { NotFoundPage } from '@/features/shell/NotFoundPage';
import { loadLanding, loadMethodology, loadPerformance, loadReport, loadWorkstation } from './routes';

const LandingPage = lazy(loadLanding);
const WorkstationPage = lazy(loadWorkstation);
const PerformancePage = lazy(loadPerformance);
const MethodologyPage = lazy(loadMethodology);
const ReportPage = lazy(loadReport);

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<LandingPage />} />
        <Route path="workstation" element={<WorkstationPage />} />
        <Route path="workstation/:patientId" element={<WorkstationPage />} />
        <Route path="performance" element={<PerformancePage />} />
        <Route path="methodology" element={<MethodologyPage />} />
        <Route path="report" element={<ReportPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
