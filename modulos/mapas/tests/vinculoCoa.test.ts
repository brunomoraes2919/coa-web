import { describe, expect, it } from 'vitest';
import { nomeVinculoCoa } from '../src/components/CampoFazendaCoa';
import type { FazendaCoa } from '../src/lib/types';

const COA: FazendaCoa[] = [
  { id: 3, nome: 'Fazenda Globo' },
  { id: 7, nome: 'Tres Flechas' },
];

describe('nomeVinculoCoa (coluna "COA WEB" da lista e opção do campo do vínculo)', () => {
  it('fazenda ligada e presente na lista → nome da fazenda do COA WEB', () => {
    expect(nomeVinculoCoa(3, COA)).toBe('Fazenda Globo');
    expect(nomeVinculoCoa(7, COA)).toBe('Tres Flechas');
  });

  it('sem vínculo → null (a lista mostra "Sem vínculo (só admin)")', () => {
    expect(nomeVinculoCoa(null, COA)).toBeNull();
    expect(nomeVinculoCoa(undefined, COA)).toBeNull();
  });

  it('vínculo fora da lista (fazenda removida ou fora do alcance) → aviso com o número', () => {
    expect(nomeVinculoCoa(99, COA)).toBe('Fazenda nº 99 (não encontrada no COA WEB)');
  });
});
