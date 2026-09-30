import { HashRouter } from 'react-router-dom';
import { AppRoutes } from './router';

export function App() {
  return (
    <HashRouter>
      <AppRoutes />
    </HashRouter>
  );
}
