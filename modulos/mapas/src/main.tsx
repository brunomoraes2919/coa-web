import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/open-sans/400.css';
import '@fontsource/open-sans/700.css';
import 'leaflet/dist/leaflet.css';
import './styles.css';
import App from './App';
import { emEmbed, iniciarEscutaFazendaCoa } from './lib/embed';

if (emEmbed()) {
  // dentro do COA WEB: cores do COA WEB e a fazenda do topo guardada desde já (antes de o editor abrir)
  document.documentElement.classList.add('embed');
  iniciarEscutaFazendaCoa();
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
