import { useMemo, useState } from 'react';
import { csvChuvaPorTalhao } from '../../lib/editor';
import { baixarArquivo } from '../../lib/exportar';
import { fmtPct, ordenarComSituacao, type ColunaSituacao, type InfoSituacao } from '../../lib/situacaoPlantio';
import type { ResumoChuva } from '../../lib/types';
import ChipSituacao from '../ChipSituacao';

interface Props {
  resumo: ResumoChuva;
  nomeArquivo: string;
  nomeSafra: string;
  /** true enquanto a interpolação recalcula: os números são do cálculo anterior e não podem ser exportados */
  desatualizado?: boolean;
  /** situação do plantio por talhão base (PIMS ou manual) e por área da cultura sem talhão base */
  situacoes?: Map<string, InfoSituacao>;
}

const COLUNAS: { id: ColunaSituacao; rotulo: string; num?: boolean }[] = [
  { id: 'nome', rotulo: 'Talhão' },
  { id: 'setor', rotulo: 'Setor' },
  { id: 'situacao', rotulo: 'Situação' },
  { id: 'pct', rotulo: '% plantado', num: true },
  { id: 'areaHa', rotulo: 'Área (ha)', num: true },
  { id: 'media', rotulo: 'Média (mm)', num: true },
  { id: 'min', rotulo: 'Mín. (mm)', num: true },
  { id: 'max', rotulo: 'Máx. (mm)', num: true },
];

const fmt = (v: number, casas = 1) =>
  Number.isFinite(v) ? v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }) : '—';

/** Chuva interpolada por talhão, com destaque para os plantados. */
const SEM_SITUACAO = new Map<string, InfoSituacao>();

export default function TabelaTalhoes({ resumo, nomeArquivo, nomeSafra, desatualizado = false, situacoes = SEM_SITUACAO }: Props) {
  const [ordem, setOrdem] = useState<{ c: ColunaSituacao; asc: boolean }>({ c: 'nome', asc: true });
  const [soPlantados, setSoPlantados] = useState(false);
  const temPlantados = resumo.talhoes.some((t) => t.plantado);
  // mapas antigos não têm resumo.areas: aí as áreas sem talhão base eram entradas próprias
  const comAreas = (resumo.areas?.length ?? 0) > 0;
  const temAreasSemBase = comAreas || resumo.talhoes.some((t) => situacoes.get(t.talhaoId)?.areaCultura);

  const linhas = useMemo(() => {
    const base = soPlantados ? resumo.talhoes.filter((t) => t.plantado) : resumo.talhoes;
    return ordenarComSituacao(base, ordem.c, ordem.asc, situacoes);
  }, [resumo, ordem, soPlantados, situacoes]);

  const exportar = () => {
    const blob = new Blob(['﻿' + csvChuvaPorTalhao(linhas, situacoes)], { type: 'text/csv;charset=utf-8' });
    baixarArquivo(blob, nomeArquivo);
  };

  const { geral, plantado } = resumo;

  return (
    <div className={`pilha${desatualizado ? ' desatualizado' : ''}`} aria-busy={desatualizado}>
      <div className="indicadores">
        <div className="indicador">
          <span>Chuva média na fazenda</span>
          <strong>{fmt(geral.media)} mm</strong>
          <small>
            mín. {fmt(geral.min)} · máx. {fmt(geral.max)} · {fmt(geral.areaHa, 0)} ha
          </small>
          {temAreasSemBase && <small>{comAreas ? 'talhões base e áreas da cultura' : 'inclui as áreas da cultura sem talhão base'}</small>}
        </div>
        {plantado ? (
          <div className="indicador indicador-plantado">
            <span>Chuva média na área plantada{nomeSafra ? ` (${nomeSafra})` : ''}</span>
            <strong>{fmt(plantado.media)} mm</strong>
            <small>
              mín. {fmt(plantado.min)} · máx. {fmt(plantado.max)} · {fmt(plantado.areaHa, 0)} ha (plantado + plantando;{' '}
              {comAreas ? 'áreas da cultura' : 'talhões base'})
            </small>
          </div>
        ) : (
          <div className="indicador indicador-vazio">
            <span>Área plantada</span>
            <strong>—</strong>
            <small>Nenhum talhão plantado nesta safra. Marque em Safras.</small>
          </div>
        )}
      </div>

      <div className="linha linha-fim">
        {temPlantados && (
          <label className="linha">
            <input type="checkbox" checked={soPlantados} onChange={(e) => setSoPlantados(e.target.checked)} />
            Só plantados
          </label>
        )}
        <button
          type="button"
          className="botao botao-pequeno"
          onClick={exportar}
          disabled={desatualizado}
          title={desatualizado ? 'Aguarde a interpolação terminar' : undefined}
        >
          Exportar CSV (Excel)
        </button>
      </div>

      <div className="tabela-rolagem lista-talhoes">
        <table className="tabela">
          <thead>
            <tr>
              {COLUNAS.map((col) => (
                <th
                  key={col.id}
                  className={col.num ? 'num' : undefined}
                  aria-sort={ordem.c === col.id ? (ordem.asc ? 'ascending' : 'descending') : undefined}
                >
                  <button
                    type="button"
                    className="botao-link ordenar"
                    onClick={() => setOrdem((o) => ({ c: col.id, asc: o.c === col.id ? !o.asc : true }))}
                  >
                    {col.rotulo}
                    {ordem.c === col.id ? (ordem.asc ? ' ▲' : ' ▼') : ''}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.map((t) => {
              const info = situacoes.get(t.talhaoId);
              return (
              <tr key={t.talhaoId} className={t.plantado ? 'marcado' : undefined}>
                <td>
                  {t.nome}
                  {info?.areaCultura && <small className="suave" title="Área da cultura sem talhão base com este código"> (área da cultura)</small>}
                </td>
                <td>{t.setor ?? ''}</td>
                <td>{info ? <ChipSituacao status={info.status} titulo={info.origem === 'pims' ? 'PIMS' : info.areaCultura ? 'Sem registro no PIMS' : 'Marcado manualmente'} /> : t.plantado ? 'Plantado (área da cultura)' : '—'}</td>
                <td className="num">{fmtPct(info?.pct ?? null)}</td>
                <td className="num">{fmt(t.areaHa)}</td>
                <td className="num">
                  <strong>{fmt(t.media)}</strong>
                </td>
                <td className="num">{fmt(t.min)}</td>
                <td className="num">{fmt(t.max)}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
