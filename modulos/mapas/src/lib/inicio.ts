/**
 * Regras da tela inicial do módulo (cards das páginas): o resumo do histórico de cada tipo de mapa e o texto curto
 * que vai no rodapé de cada card. Sem tela, para os testes.
 */
import type { MapaSalvo, TipoMapa, VariedadePims } from './types';

export interface ResumoHistorico {
  total: number;
  /** ISO do mapa salvo mais recente; null = nenhum */
  ultimo: string | null;
}

/** Quantos mapas do tipo estão salvos e quando foi o último (mapa sem tipo = chuva, como no histórico). */
export function resumoHistorico(mapas: readonly MapaSalvo[], tipo: TipoMapa): ResumoHistorico {
  const doTipo = mapas.filter((m) => (m.tipo ?? 'chuva') === tipo);
  const ultimo = doTipo.reduce<string | null>((acc, m) => (!acc || m.criadoEm > acc ? m.criadoEm : acc), null);
  return { total: doTipo.length, ultimo };
}

/** "dd/mm" de um ISO; '' se inválido. */
function diaMes(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** "12 salvos · último em 20/10", "1 salvo · último em 20/10" ou "Nenhum salvo ainda". */
export function textoHistorico(r: ResumoHistorico): string {
  if (!r.total) return 'Nenhum salvo ainda';
  const quando = r.ultimo ? diaMes(r.ultimo) : '';
  return `${r.total} ${r.total === 1 ? 'salvo' : 'salvos'}${quando ? ` · último em ${quando}` : ''}`;
}

/** "20 em uso · 2 sem nome comercial" ou "20 em uso · todas com nome comercial". */
export function textoVariedades(lista: readonly VariedadePims[]): string {
  const emUso = lista.filter((v) => v.emUso);
  if (!lista.length) return 'Cadastro ainda não lido do PIMS';
  const sem = emUso.filter((v) => !(v.nomeComercial ?? '').trim()).length;
  return `${emUso.length} em uso · ${sem ? `${sem} sem nome comercial` : 'todas com nome comercial'}`;
}
