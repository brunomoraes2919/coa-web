import { fmtDataIso, fmtPct, pctPlantado } from '../lib/situacaoPlantio';
import type { PlantioPimsTalhao, Talhao } from '../lib/types';
import ChipSituacao from './ChipSituacao';

const fmtHa = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

interface Props {
  talhoes: Talhao[];
  /** registro do PIMS do talhão (casado pelo código); undefined = plantio manual */
  pimsDe(t: Talhao): PlantioPimsTalhao | undefined;
  /** talhaoId → data do plantio manual ('' = sem data); presença = plantado */
  marcados: Record<string, string>;
  onAlternar(id: string): void;
  onData(id: string, data: string): void;
  busca: string;
}

function datasPims(p: PlantioPimsTalhao): string {
  if (p.inicio && p.fim) return `${fmtDataIso(p.inicio)} a ${fmtDataIso(p.fim)}`;
  if (p.inicio) return `desde ${fmtDataIso(p.inicio)}`;
  return '—';
}

/** Lista do plantio: situação do PIMS (só leitura) ou marcação manual nos talhões sem PIMS. */
export default function TabelaPlantio({ talhoes, pimsDe, marcados, onAlternar, onData, busca }: Props) {
  return (
    <table className="tabela">
      <thead>
        <tr>
          <th />
          <th>Talhão</th>
          <th>Setor</th>
          <th className="num">Área (ha)</th>
          <th>Situação</th>
          <th className="num">%</th>
          <th>Plantio</th>
          <th>Variedade</th>
        </tr>
      </thead>
      <tbody>
        {talhoes.map((t) => {
          const p = pimsDe(t);
          if (p) {
            return (
              <tr key={t.id} className={p.status !== 'a_plantar' ? 'marcado' : undefined}>
                <td title="Situação lida do PIMS (não é editável aqui)">
                  <input type="checkbox" checked={p.status !== 'a_plantar'} disabled aria-label={`Situação no PIMS: ${t.nome}`} />
                </td>
                <td>{t.nome}</td>
                <td>{t.setor ?? '—'}</td>
                <td className="num">{fmtHa(t.areaHa)}</td>
                <td>
                  <ChipSituacao status={p.status} titulo={`PIMS: ${p.codigoPims} · ${fmtHa(p.areaPlantada)} de ${fmtHa(p.areaPrevista)} ha`} />
                </td>
                <td className="num">{fmtPct(pctPlantado(p.areaPlantada, p.areaPrevista))}</td>
                <td>{datasPims(p)}</td>
                <td>{p.variedade ?? '—'}</td>
              </tr>
            );
          }
          const marcado = t.id in marcados;
          return (
            <tr key={t.id} className={marcado ? 'marcado' : undefined}>
              <td>
                <input type="checkbox" checked={marcado} onChange={() => onAlternar(t.id)} aria-label={`Plantado: ${t.nome}`} />
              </td>
              <td>{t.nome}</td>
              <td>{t.setor ?? '—'}</td>
              <td className="num">{fmtHa(t.areaHa)}</td>
              <td>{marcado ? <ChipSituacao status="plantado" titulo="Marcado manualmente" /> : <span className="suave">manual</span>}</td>
              <td className="num">—</td>
              <td>
                <input
                  type="date"
                  value={marcados[t.id] ?? ''}
                  aria-label={`Data do plantio de ${t.nome}`}
                  onChange={(e) => onData(t.id, e.target.value)}
                />
              </td>
              <td>—</td>
            </tr>
          );
        })}
        {talhoes.length === 0 && (
          <tr>
            <td colSpan={8} className="suave">
              Nenhum talhão encontrado para "{busca}".
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
