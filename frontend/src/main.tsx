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
