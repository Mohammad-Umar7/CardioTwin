import '@fontsource-variable/inter';
import '@fontsource-variable/inter-tight';
import '@fontsource-variable/jetbrains-mono';
import './styles/globals.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const container = document.getElementById('root');
if (!container) throw new Error('CardioTwin: #root element missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Boot screen (index.html): fade it out once the app has painted its first frame, then drop it. A timer backs
// up the frame callbacks, which never fire in a background tab.
const boot = document.getElementById('boot');
if (boot) {
  let done = false;
  const dismiss = () => {
    if (done) return;
    done = true;
    boot.classList.add('boot-out');
    window.setTimeout(() => boot.remove(), 700);
  };
  requestAnimationFrame(() => requestAnimationFrame(dismiss));
  window.setTimeout(dismiss, 400);
}
