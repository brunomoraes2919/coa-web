import { useEffect, useMemo, useState } from 'react';
import { repo } from '../data';
import Aviso, { mensagemDeErro } from '../components/Aviso';
import Carregando from '../components/Carregando';
import '../components/editor/editor.css';
import type { VariedadePims } from '../lib/types';
import { emUsoSemNome, nomeExibido, novasSemNome } from '../lib/variedades';

type Filtro = 'uso' | 'pendentes' | 'todas';

/** Ordem da lista: em uso sem nome comercial, novas sem nome, em uso, depois as outras, pelo nome do PIMS. */
function peso(v: VariedadePims, novas: Set<string>): number {
  const semNome = !(v.nomeComercial ?? '').trim();
  if (v.emUso && semNome) return 0;
  if (novas.has(v.chave)) return 1;
  return v.emUso ? 2 : 3;
}

/**
 * Cadastro de variedades do PIMS com o nome comercial (administrador). A lista vem do PIMS pela rotina da VM (de
 * hora em hora); aqui só se digita o nome comercial, que salva ao sair do campo. No mapa de variedade a variedade
 * sai como "Nome comercial (nome do PIMS)".
 */
export default function VariedadesPims() {
  const [lista, setLista] = useState<VariedadePims[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('uso');
  const [editando, setEditando] = useState<Record<string, string>>({});
  const [gravando, setGravando] = useState<string | null>(null);

  const carregar = () =>
    repo()
      .listarVariedadesPims()
      .then(setLista)
      .catch((e) => {
        setErro(`Não foi possível ler o cadastro de variedades: ${mensagemDeErro(e)}`);
        setLista([]);
      });
  useEffect(() => {
    void carregar();
  }, []);

  const novas = useMemo(() => novasSemNome(lista ?? []), [lista]);
  const pendentes = useMemo(() => emUsoSemNome(lista ?? []), [lista]);
  const emUso = useMemo(() => (lista ?? []).filter((v) => v.emUso).length, [lista]);
  const faltam = useMemo(() => (lista ?? []).filter((v) => peso(v, novas) <= 1).length, [lista, novas]);

  const visiveis = useMemo(() => {
    const t = busca.trim().toUpperCase();
    return (lista ?? [])
      .filter((v) => (filtro === 'todas' ? true : filtro === 'uso' ? v.emUso || novas.has(v.chave) : peso(v, novas) <= 1))
      .filter((v) => !t || v.chave.includes(t) || (v.nomeComercial ?? '').toUpperCase().includes(t) || v.codigos.some((c) => String(c.codigo ?? '') === t || (c.descricao ?? '').toUpperCase().includes(t)))
      .sort((a, b) => peso(a, novas) - peso(b, novas) || a.chave.localeCompare(b.chave, 'pt-BR'));
  }, [lista, busca, filtro, novas]);

  const gravar = async (v: VariedadePims) => {
    const texto = (editando[v.chave] ?? v.nomeComercial ?? '').trim();
    if (texto === (v.nomeComercial ?? '').trim()) return;
    if (texto.length > 80) {
      setErro('O nome comercial pode ter no máximo 80 caracteres.');
      return;
    }
    setErro(null);
    setGravando(v.chave);
    try {
      await repo().salvarNomeComercial(v.chave, texto || null);
      setLista((l) => (l ?? []).map((x) => (x.chave === v.chave ? { ...x, nomeComercial: texto || null, comercialEm: new Date().toISOString() } : x)));
      setEditando((e) => {
        const { [v.chave]: _feito, ...resto } = e;
        return resto;
      });
      setSalvo(texto ? `Gravado: ${nomeExibido(v.nomePims, texto)}.` : `Nome comercial de ${v.nomePims} apagado.`);
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setGravando(null);
    }
  };

  return (
    <div className="pagina">
      <div className="pagina-cabecalho">
        <div>
          <h1>Variedades</h1>
          <p className="subtitulo">
            O cadastro de variedades do PIMS, atualizado de hora em hora. Digite o nome comercial: no mapa de variedade ela sai como “Nome comercial (nome do PIMS)”.
          </p>
        </div>
      </div>
      {erro && (
        <Aviso tipo="erro" onFechar={() => setErro(null)}>
          {erro}
        </Aviso>
      )}
      {salvo && (
        <Aviso tipo="sucesso" onFechar={() => setSalvo(null)}>
          {salvo}
        </Aviso>
      )}
      {!lista ? (
        <Carregando texto="Carregando as variedades…" />
      ) : lista.length === 0 ? (
        <div className="cartao vazio">
          <p>O cadastro de variedades ainda não chegou do PIMS. A rotina do servidor grava a lista na próxima rodada (de hora em hora).</p>
        </div>
      ) : (
        <>
          {(pendentes.length > 0 || novas.size > 0) && (
            <Aviso tipo="alerta" titulo="Falta o nome comercial">
              {pendentes.length > 0 && (
                <p>
                  {pendentes.length} {pendentes.length === 1 ? 'variedade em uso' : 'variedades em uso'} nas safras atuais sem nome comercial:{' '}
                  {pendentes.slice(0, 8).map((v) => v.nomePims).join(', ')}
                  {pendentes.length > 8 ? ` e mais ${pendentes.length - 8}` : ''}.
                </p>
              )}
              {novas.size > 0 && (
                <p>
                  {novas.size} {novas.size === 1 ? 'variedade nova chegou' : 'variedades novas chegaram'} do PIMS sem nome comercial (marcadas como “nova” na lista).
                </p>
              )}
            </Aviso>
          )}
          <section className="cartao pilha">
            <div className="linha" style={{ flexWrap: 'wrap', gap: 10 }}>
              <input type="search" placeholder="Buscar pela variedade, nome comercial ou código do PIMS…" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar variedades" style={{ flex: '1 1 280px' }} />
              <div className="chips" role="group" aria-label="Quais variedades mostrar" style={{ marginTop: 0 }}>
                {(
                  [
                    ['uso', `Em uso e novas (${emUso})`],
                    ['pendentes', `Sem nome comercial (${faltam})`],
                    ['todas', `Todas (${lista.length})`],
                  ] as [Filtro, string][]
                ).map(([f, texto]) => (
                  <button key={f} type="button" className={`chip ${filtro === f ? 'ativo' : 'chip-neutro'}`} aria-pressed={filtro === f} onClick={() => setFiltro(f)}>
                    {texto}
                  </button>
                ))}
              </div>
            </div>
            <div className="tabela-rolagem">
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Variedade (PIMS)</th>
                    <th>Nome comercial</th>
                    <th>Grupo de maturação</th>
                    <th className="num">Talhões nas safras atuais</th>
                    <th>Código no PIMS</th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((v) => {
                    const semNome = !(v.nomeComercial ?? '').trim();
                    return (
                      <tr key={v.chave}>
                        <td>
                          <b>{v.nomePims}</b>{' '}
                          {novas.has(v.chave) && <span className="selo-alerta">nova</span>}{' '}
                          {v.emUso && semNome && <span className="selo-alerta">sem nome</span>}
                        </td>
                        <td>
                          <input
                            type="text"
                            maxLength={80}
                            value={editando[v.chave] ?? v.nomeComercial ?? ''}
                            placeholder="Nome comercial"
                            aria-label={`Nome comercial de ${v.nomePims}`}
                            disabled={gravando === v.chave}
                            onChange={(e) => setEditando((x) => ({ ...x, [v.chave]: e.target.value }))}
                            onBlur={() => void gravar(v)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                              if (e.key === 'Escape') setEditando(({ [v.chave]: _desfeito, ...resto }) => resto);
                            }}
                            style={{ minWidth: 220 }}
                          />
                        </td>
                        <td>{v.grupo ?? '—'}</td>
                        <td className="num">{v.talhoes || '—'}</td>
                        <td className="suave" title={v.codigos.map((c) => `${c.codigo ?? '—'}: ${c.descricao ?? ''}`).join('\n')}>
                          {v.codigos.map((c) => c.codigo ?? '—').join(', ')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {visiveis.length === 0 && <p className="suave">Nenhuma variedade com esse filtro.</p>}
          </section>
        </>
      )}
    </div>
  );
}
