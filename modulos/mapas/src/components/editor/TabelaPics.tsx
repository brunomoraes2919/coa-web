import { useRef, useState } from 'react';
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
  if (foiEditado(p)) return 'Editado';
  return '';
}

/** O PIC teve a chuva trocada à mão (o valor do CSV fica em chuvaOriginal). */
export function foiEditado(p: Pic): boolean {
  return p.chuvaOriginal !== undefined && p.chuvaOriginal !== p.chuva;
}

/** Texto digitado → mm (aceita vírgula); null se inválido. Vazio = sem leitura. */
export function lerChuvaDigitada(texto: string): number | null | 'invalido' {
  const t = texto.trim().replace(',', '.');
  if (t === '') return null;
  const v = Number(t);
  if (!Number.isFinite(v) || v < 0 || v > 1000) return 'invalido';
  return Math.round(v * 10) / 10;
}

/**
 * Nova chuva de um PIC. Guarda o valor do CSV em chuvaOriginal na primeira edição (para mostrar
 * "Editado" e poder restaurar). Um PIC que estava sem leitura passa a entrar na interpolação; um que
 * fica sem leitura sai dela.
 */
export function editarChuva(p: Pic, chuva: number | null): Pic {
  const chuvaOriginal = p.chuvaOriginal !== undefined ? p.chuvaOriginal : p.chuva;
  const incluir = chuva === null ? false : p.chuva === null ? !p.inativo : p.incluir;
  return { ...p, chuva, chuvaOriginal, incluir };
}

/** Volta o PIC ao valor do CSV (e tira a marca de editado). */
export function restaurarChuva(p: Pic): Pic {
  if (p.chuvaOriginal === undefined) return p;
  const { chuvaOriginal, ...semOriginal } = editarChuva(p, p.chuvaOriginal);
  void chuvaOriginal;
  return semOriginal;
}

export default function TabelaPics({ pics, onChange, foraDaRegiao }: Props) {
  const [editando, setEditando] = useState<number | null>(null);
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState('');
  // Enter/Esc já resolveram a edição: o blur que vem quando o campo some não grava de novo
  const ignorarBlur = useRef(false);
  const incluidos = pics.filter((p) => p.incluir).length;
  const editados = pics.filter(foiEditado).length;
  const marcar = (i: number, incluir: boolean) => onChange(pics.map((p, j) => (j === i ? { ...p, incluir } : p)));
  const todos = (incluir: boolean) => onChange(pics.map((p) => ({ ...p, incluir: incluir && p.chuva !== null })));

  const abrir = (i: number) => {
    ignorarBlur.current = false;
    setEditando(i);
    setTexto(pics[i].chuva === null ? '' : String(pics[i].chuva).replace('.', ','));
    setErro('');
  };
  const fechar = () => {
    setEditando(null);
    setErro('');
  };
  const salvar = () => {
    if (editando === null) return;
    const v = lerChuvaDigitada(texto);
    if (v === 'invalido') {
      setErro('Digite um valor entre 0 e 1000 mm (ex.: 12,5).');
      return;
    }
    const p = pics[editando];
    if (v !== p.chuva) onChange(pics.map((x, j) => (j === editando ? editarChuva(x, v) : x)));
    fechar();
  };
  const restaurar = (i: number) => {
    onChange(pics.map((x, j) => (j === i ? restaurarChuva(x) : x)));
    if (editando === i) fechar();
  };

  return (
    <div className="pilha">
      <div className="linha linha-fim">
        <span className="suave">
          {incluidos} de {pics.length} PICs na interpolação
          {editados ? ` · ${editados} editado${editados === 1 ? '' : 's'}` : ''}
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
              <th aria-label="Editar" />
            </tr>
          </thead>
          <tbody>
            {pics.map((p, i) => {
              const s = situacao(p, !!foraDaRegiao?.has(i));
              const editado = foiEditado(p);
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
                  <td className="num">
                    {editando === i ? (
                      <input
                        className="pic-mm"
                        inputMode="decimal"
                        autoFocus
                        value={texto}
                        aria-label={`Chuva de ${p.nome} em mm`}
                        aria-invalid={!!erro}
                        onChange={(e) => {
                          setTexto(e.target.value);
                          setErro('');
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            ignorarBlur.current = true;
                            salvar();
                          }
                          if (e.key === 'Escape') {
                            ignorarBlur.current = true;
                            fechar();
                          }
                        }}
                        onBlur={() => {
                          if (ignorarBlur.current) {
                            ignorarBlur.current = false;
                            return;
                          }
                          salvar();
                        }}
                      />
                    ) : (
                      <span className={editado ? 'pic-editado' : undefined} title={editado ? `Valor do CSV: ${p.chuvaOriginal === null ? 'sem leitura' : `${fmtChuva(p.chuvaOriginal ?? 0)} mm`}` : undefined}>
                        {p.chuva === null ? '—' : fmtChuva(p.chuva)}
                      </span>
                    )}
                  </td>
                  <td className={s ? 'destaque' : undefined}>{s}</td>
                  <td className="pic-acoes">
                    {editando === i ? null : (
                      <>
                        <button type="button" className="botao-icone-pic" onClick={() => abrir(i)} title="Editar a chuva deste PIC" aria-label={`Editar a chuva de ${p.nome}`}>
                          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                        </button>
                        {editado ? (
                          <button type="button" className="botao-icone-pic" onClick={() => restaurar(i)} title="Voltar ao valor do CSV" aria-label={`Voltar ${p.nome} ao valor do CSV`}>
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
                          </button>
                        ) : null}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {erro ? <p className="erro-pic" role="alert">{erro}</p> : null}
      {editados ? <p className="suave nota-pic">Valores editados à mão entram na nova interpolação e ficam salvos com o mapa; o valor original do CSV aparece ao parar o mouse.</p> : null}
    </div>
  );
}
