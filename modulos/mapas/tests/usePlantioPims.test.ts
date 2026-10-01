import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlantioPimsArquivo } from '../src/lib/types';

const { lerDoRepo } = vi.hoisted(() => ({ lerDoRepo: vi.fn<() => Promise<PlantioPimsArquivo | null>>() }));
vi.mock('../src/data', () => ({ repo: () => ({ lerPlantioPims: lerDoRepo }) }));

const arq: PlantioPimsArquivo = { versao: 1, geradoEm: '2026-09-28T10:00:00.000Z', fonte: 'PIMS', safras: [] };

const novo: PlantioPimsArquivo = { ...arq, geradoEm: '2026-09-28T12:01:00.000Z' };

/** Módulo novo a cada teste (o cache é do módulo). */
async function modulo() {
  vi.resetModules();
  return import('../src/components/usePlantioPims');
}
const carregar = async () => (await modulo()).lerPlantioPims;

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

describe('recarregarPlantioPims (botão "Atualizar plantio")', () => {
  it('ignora o cache de 5 min, relê e as leituras seguintes usam o valor novo', async () => {
    const { lerPlantioPims, recarregarPlantioPims } = await modulo();
    lerDoRepo.mockResolvedValueOnce(arq).mockResolvedValueOnce(novo);

    expect(await lerPlantioPims()).toEqual(arq);
    expect(await recarregarPlantioPims()).toEqual(novo);
    expect(await lerPlantioPims()).toEqual(novo);
    expect(lerDoRepo).toHaveBeenCalledTimes(2);
  });

  it('avisa todos os inscritos (cada usePlantioPims montado) com o valor novo; quem saiu não é avisado', async () => {
    const { ouvirPlantioPims, recarregarPlantioPims } = await modulo();
    lerDoRepo.mockResolvedValue(novo);
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    ouvirPlantioPims(a);
    ouvirPlantioPims(b);
    const sair = ouvirPlantioPims(c);
    sair();

    await recarregarPlantioPims();

    expect(a).toHaveBeenCalledExactlyOnceWith(novo);
    expect(b).toHaveBeenCalledExactlyOnceWith(novo);
    expect(c).not.toHaveBeenCalled();
  });

  it('sem plantio no banco: avisa null', async () => {
    const { ouvirPlantioPims, recarregarPlantioPims } = await modulo();
    lerDoRepo.mockResolvedValue(null);
    const a = vi.fn();
    ouvirPlantioPims(a);
    expect(await recarregarPlantioPims()).toBeNull();
    expect(a).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('falha na releitura: rejeita, não avisa ninguém (as telas ficam com o plantio que tinham) e a próxima leitura tenta de novo', async () => {
    const { lerPlantioPims, ouvirPlantioPims, recarregarPlantioPims } = await modulo();
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    lerDoRepo.mockResolvedValueOnce(arq).mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValueOnce(novo);
    await lerPlantioPims();
    const a = vi.fn();
    ouvirPlantioPims(a);

    await expect(recarregarPlantioPims()).rejects.toThrow('Failed to fetch');
    expect(a).not.toHaveBeenCalled();
    expect(await lerPlantioPims()).toEqual(novo);
    expect(lerDoRepo).toHaveBeenCalledTimes(3);
    aviso.mockRestore();
  });

  it('uma leitura em andamento de antes da releitura não sobrescreve o valor novo no cache', async () => {
    const { lerPlantioPims, recarregarPlantioPims } = await modulo();
    let soltarAntiga: (a: PlantioPimsArquivo) => void = () => undefined;
    lerDoRepo.mockReturnValueOnce(new Promise((r) => (soltarAntiga = r))).mockResolvedValueOnce(novo);

    const antiga = lerPlantioPims();
    expect(await recarregarPlantioPims()).toEqual(novo);
    soltarAntiga(arq);
    expect(await antiga).toEqual(arq);
    expect(await lerPlantioPims()).toEqual(novo);
  });
});
