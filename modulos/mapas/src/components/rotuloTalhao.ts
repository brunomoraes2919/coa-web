import type * as L from 'leaflet';

/**
 * Rótulo fixo no centro do talhão. O nome vem do shapefile (dado externo): o Leaflet insere
 * conteúdo em texto como HTML (innerHTML), por isso passamos um elemento com textContent.
 */
export function vincularRotulo(camada: L.Layer, texto: string): void {
  const el = document.createElement('span');
  el.textContent = texto;
  camada.bindTooltip(el, { permanent: true, direction: 'center', className: 'rotulo-talhao' });
}
