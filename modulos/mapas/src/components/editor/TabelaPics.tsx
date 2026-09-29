import { fmtChuva } from '../../lib/format';
import type { Pic } from '../../lib/types';

interface Props {
  pics: Pic[];
  onChange(pics: Pic[]): void;
  /** índices de PICs que ficaram fora da área do mapa (não entram no IDW, como no QGIS) */
  foraDaRegiao?: Set<number>;
}

function situacao(p: Pic, fora: boolean): string {
  if (p.inativo) return 'Inativo';
  if (p.chuva === null) return 'Sem leitura';
  if (fora && p.incluir) return 'Fora da área';
  return '';
}

export default function TabelaPics({ pics, onChange, foraDaRegiao }: Props) {
  const incluidos = pics.filter((p) => p.incluir).length;
  const marcar = (i: number, incluir: boolean) => onChange(pics.map((p, j) => (j === i ? { ...p, incluir } : p)));
  const todos = (incluir: boolean) => onChange(pics.map((p) => ({ ...p, incluir: incluir && p.chuva !== null })));

  return (
    <div className="pilha">
      <div className="linha linha-fim">
        <span className="suave">
          {incluidos} de {pics.length} PICs na interpolação
        </span>
        <button type="button" className="botao botao-pequeno" onClick={() => todos(true)}>
          Marcar todos
        </button>
        <button type="button" className="botao botao-pequeno" onClick={() => todos(false)}>
          Desmarcar todos
        </button>
      </div>
      <div className="tabela-rolagem lista-pics">
        <table className="tabela">
          <thead>
            <tr>
              <th aria-label="Incluir" />
              <th>PIC</th>
              <th className="num">Chuva (mm)</th>
              <th>Situação</th>
            </tr>
          </thead>
          <tbody>
            {pics.map((p, i) => {
              const s = situacao(p, !!foraDaRegiao?.has(i));
              return (
                <tr key={`${p.id}-${i}`} className={p.incluir ? 'marcado' : undefined}>
                  <td>
                    <input
                      type="checkbox"
                      checked={p.incluir}
                      disabled={p.chuva === null}
                      aria-label={`Incluir ${p.nome}`}
                      onChange={(e) => marcar(i, e.target.checked)}
                    />
                  </td>
                  <td>{p.nome}</td>
                  <td className="num">{p.chuva === null ? '—' : fmtChuva(p.chuva)}</td>
                  <td className={s ? 'destaque' : undefined}>{s}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
