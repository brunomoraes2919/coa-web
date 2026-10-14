import { afterEach, describe, expect, it, vi } from 'vitest';
import { fazendaParaRow, safraParaRow, TABELAS } from '../src/data/supabaseLinhas';
import { criarSupabaseRepo, RECUSA_EXCLUIR } from '../src/data/supabaseRepo';
import type { MapaSalvo } from '../src/lib/types';
import { fazenda, mapa, safra } from './helpers/dominio';
import { BancoFalso } from './helpers/supabaseFalso';

const jpeg = () => new Blob(['jpeg'], { type: 'image/jpeg' });
const png = () => new Blob(['png'], { type: 'image/png' });

/** Banco com uma fazenda, uma safra e `n` mapas salvos (com a imagem e a miniatura no Storage). */
async function montar(n = 1) {
  const banco = new BancoFalso();
  const repo = criarSupabaseRepo(banco.cliente());
  const f = fazenda(0);
  const s = safra(1);
  banco.inserir(TABELAS.fazendas, [fazendaParaRow(f)]);
  banco.inserir(TABELAS.safras, [safraParaRow(s)]);
  const mapas: MapaSalvo[] = [];
  for (let i = 1; i <= n; i++) mapas.push(await repo.salvarMapa(mapa(i, { fazendaId: f.id, pngPath: null, thumbPath: null }), jpeg(), png()));
  banco.requisicoes.length = 0;
  return { banco, repo, f, s, mapas };
}

/** Operações feitas, na ordem: "delete mapas_chuva", "remove storage:mapas-chuva"... */
const passos = (banco: BancoFalso) => banco.requisicoes.filter((r) => r.op === 'delete' || r.op === 'remove').map((r) => `${r.op} ${r.tabela}`);
const ids = (banco: BancoFalso, tabela: string) => banco.tabelas[tabela].map((l) => l.id);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('supabaseRepo: excluirMapa confere se o banco apagou', () => {
  it('apaga a linha primeiro e só depois os arquivos do Storage', async () => {
    const { banco, repo, mapas } = await montar();
    await repo.excluirMapa(mapas[0]);
    expect(ids(banco, TABELAS.mapas)).toEqual([]);
    expect(banco.arquivos.size).toBe(0);
    expect(passos(banco)).toEqual([`delete ${TABELAS.mapas}`, 'remove storage:mapas-chuva']);
  });

  it('banco recusa em silêncio (RLS): erro claro, o mapa e os arquivos dele ficam inteiros', async () => {
    const { banco, repo, mapas } = await montar();
    banco.recusarExclusao = (t) => t === TABELAS.mapas;
    await expect(repo.excluirMapa(mapas[0])).rejects.toThrow(RECUSA_EXCLUIR.mapa);
    expect(ids(banco, TABELAS.mapas)).toEqual([mapas[0].id]);
    expect([...banco.arquivos.keys()].sort()).toEqual([mapas[0].pngPath, mapas[0].thumbPath].sort());
    expect(passos(banco)).toEqual([`delete ${TABELAS.mapas}`]); // nada foi pedido ao Storage
  });

  it('mapa que já não existe (excluído em outra aba): vale como excluído e limpa os arquivos que sobraram', async () => {
    const { banco, repo, mapas } = await montar();
    banco.tabelas[TABELAS.mapas] = [];
    await expect(repo.excluirMapa(mapas[0])).resolves.toBeUndefined();
    expect(banco.arquivos.size).toBe(0);
  });

  it('erro do banco ao apagar: exceção com contexto, arquivos intactos', async () => {
    const { banco, repo, mapas } = await montar();
    banco.falhar = (r) => (r.tabela === TABELAS.mapas && r.op === 'delete' ? 'falha simulada' : null);
    await expect(repo.excluirMapa(mapas[0])).rejects.toThrow('Não foi possível excluir o mapa: falha simulada');
    expect(banco.arquivos.size).toBe(2);
  });

  it('linha apagada e Storage fora do ar: a exclusão vale (o arquivo fica sobrando, com aviso no console)', async () => {
    const { banco, repo, mapas } = await montar();
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    banco.falhar = (r) => (r.op === 'remove' ? 'storage fora do ar' : null);
    await expect(repo.excluirMapa(mapas[0])).resolves.toBeUndefined();
    expect(ids(banco, TABELAS.mapas)).toEqual([]);
    expect(aviso).toHaveBeenCalledTimes(1);
  });
});

describe('supabaseRepo: excluirFazenda confere se o banco apagou', () => {
  it('apaga a fazenda e só depois os arquivos dos mapas dela', async () => {
    const { banco, repo, f } = await montar(2);
    await repo.excluirFazenda(f.id);
    expect(ids(banco, TABELAS.fazendas)).toEqual([]);
    expect(banco.arquivos.size).toBe(0);
    expect(passos(banco)).toEqual([`delete ${TABELAS.fazendas}`, 'remove storage:mapas-chuva']);
  });

  it('administrador restrito (o banco recusa em silêncio): erro claro e nenhum mapa perde a imagem', async () => {
    const { banco, repo, f, mapas } = await montar(2);
    banco.recusarExclusao = (t) => t === TABELAS.fazendas;
    await expect(repo.excluirFazenda(f.id)).rejects.toThrow(RECUSA_EXCLUIR.fazenda);
    expect(ids(banco, TABELAS.fazendas)).toEqual([f.id]);
    expect(ids(banco, TABELAS.mapas).sort()).toEqual(mapas.map((m) => m.id).sort());
    expect(banco.arquivos.size).toBe(4);
    expect(passos(banco)).toEqual([`delete ${TABELAS.fazendas}`]);
    for (const m of mapas) await expect(repo.urlArquivo(m.pngPath as string)).resolves.toContain(m.pngPath as string);
  });

  it('erro do banco ao apagar: exceção com contexto, arquivos intactos', async () => {
    const { banco, repo, f } = await montar();
    banco.falhar = (r) => (r.tabela === TABELAS.fazendas && r.op === 'delete' ? 'falha simulada' : null);
    await expect(repo.excluirFazenda(f.id)).rejects.toThrow('Não foi possível excluir a fazenda: falha simulada');
    expect(banco.arquivos.size).toBe(2);
  });
});

describe('supabaseRepo: excluirSafra confere se o banco apagou', () => {
  it('apaga a safra', async () => {
    const { banco, repo, s } = await montar(0);
    await repo.excluirSafra(s.id);
    expect(ids(banco, TABELAS.safras)).toEqual([]);
  });

  it('administrador restrito (o banco recusa em silêncio, script 0023): erro claro e a safra continua', async () => {
    const { banco, repo, s } = await montar(0);
    banco.recusarExclusao = (t) => t === TABELAS.safras;
    await expect(repo.excluirSafra(s.id)).rejects.toThrow(RECUSA_EXCLUIR.safra);
    expect(ids(banco, TABELAS.safras)).toEqual([s.id]);
  });

  it('safra que já não existe: vale como excluída', async () => {
    const { repo } = await montar(0);
    await expect(repo.excluirSafra('saf-inexistente')).resolves.toBeUndefined();
  });

  it('as mensagens de recusa chegam à tela como estão (em português, sem passar por tradução)', async () => {
    const { mensagemDeErro } = await import('../src/lib/erros');
    for (const texto of Object.values(RECUSA_EXCLUIR)) {
      expect(texto).toMatch(/^Sua conta não pode excluir /);
      expect(mensagemDeErro(new Error(texto))).toBe(texto);
    }
  });
});
