import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlantioPimsArquivo } from '../src/lib/types';

const { lerDoRepo } = vi.hoisted(() => ({ lerDoRepo: vi.fn<() => Promise<PlantioPimsArquivo | null>>() }));
vi.mock('../src/data', () => ({ repo: () => ({ lerPlantioPims: lerDoRepo }) }));

const arq: PlantioPimsArquivo = { versao: 1, geradoEm: '2026-09-28T10:00:00.000Z', fonte: 'PIMS via Agrovex', safras: [] };

/** Módulo novo a cada teste (o cache é do módulo). */
async function carregar() {
  vi.resetModules();
  return (await import('../src/components/usePlantioPims')).lerPlantioPims;
}

beforeEach(() => {
  lerDoRepo.mockReset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-28T12:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('lerPlantioPims (compartilhado entre as telas)', () => {
  it('lê pelo repositório e reaproveita a leitura por 5 min', async () => {
    const lerPlantioPims = await carregar();
    lerDoRepo.mockResolvedValue(arq);

    expect(await lerPlantioPims()).toEqual(arq);
    vi.setSystemTime(new Date('2026-09-28T12:04:59.000Z'));
    expect(await lerPlantioPims()).toEqual(arq);
    expect(lerDoRepo).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2026-09-28T12:05:01.000Z'));
    await lerPlantioPims();
    expect(lerDoRepo).toHaveBeenCalledTimes(2);
  });

  it('falha na leitura (rede, tabela ausente...) → null, e a próxima chamada tenta de novo', async () => {
    const lerPlantioPims = await carregar();
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    lerDoRepo.mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValueOnce(arq);

    expect(await lerPlantioPims()).toBeNull();
    expect(await lerPlantioPims()).toEqual(arq);
    expect(lerDoRepo).toHaveBeenCalledTimes(2);
    aviso.mockRestore();
  });
});
