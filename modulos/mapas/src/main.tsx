import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/open-sans/400.css';
import '@fontsource/open-sans/700.css';
import 'leaflet/dist/leaflet.css';
import './styles.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
