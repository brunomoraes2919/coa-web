// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import * as L from 'leaflet';
import { vincularRotulo } from '../src/components/rotuloTalhao';

describe('rótulo do talhão no mapa Leaflet (nome vem do shapefile: nunca vira HTML)', () => {
  it('um nome com HTML aparece como texto, sem criar elementos', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const mapa = L.map(div).setView([-13.8, -57.2], 14);
    const talhao = L.polygon([
      [-13.8, -57.2],
      [-13.8, -57.19],
      [-13.79, -57.19],
    ]).addTo(mapa);
    const nome = '<img src=x onerror=alert(1)>';

    vincularRotulo(talhao, nome);

    const el = talhao.getTooltip()?.getElement();
    expect(el).toBeTruthy();
    expect(el!.querySelector('img')).toBeNull();
    expect(el!.textContent).toBe(nome);
    expect(el!.classList.contains('rotulo-talhao')).toBe(true);
    mapa.remove();
  });
});
