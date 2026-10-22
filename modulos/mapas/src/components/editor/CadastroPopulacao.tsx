import { useEffect, useMemo, useState } from 'react';
import { repo } from '../../data';
import { mensagemDeErro } from '../Aviso';
import { colunasNomeVariedade, fmtPopulacao, fmtSementes, soNumeroDigitado, validarPopulacao } from '../../lib/variedades';
import type { PopulacaoVariedade, ResumoVariedades } from '../../lib/types';

interface Props {
  resumo: ResumoVariedades;
  /** unidade e safra do PIMS da fazenda e safra do mapa; null = fazenda sem vínculo com o PIMS */
  chaves: { unidade: string; safra: string } | null;
  /** o que está gravado (chave da variedade → valores) */
  gravados: ReadonlyMap<string, PopulacaoVariedade>;
  /** erro ao ler o cadastro (ex.: tabela ainda não criada) */
  erroLeitura: string | null;
  onSalvo: () => void;
}

type Campos = Record<string, { sementes: string; populacao: string }>;

/**
 * Cadastro de sementes por metro e população das variedades do mapa (fazenda e safra escolhidas). Os valores saem
 * na tabela da legenda do mapa e na página Variedades da Revista do Operacional.
 */
export default function CadastroPopulacao({ resumo, chaves, gravados, erroLeitura, onSalvo }: Props) {
  const itens = useMemo(() => resumo.itens.filter((i) => i.chave), [resumo]);
  const [campos, setCampos] = useState<Campos>({});
  const [invalido, setInvalido] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);

  // campos = o que está gravado (de novo a cada leitura, a cada troca de fazenda ou safra)
  useEffect(() => {
    const novo: Campos = {};
    for (const i of itens) {
      const g = gravados.get(i.chave);
      novo[i.chave] = { sementes: fmtSementes(g?.sementesMetro), populacao: fmtPopulacao(g?.populacao) };
    }
    setCampos(novo);
    setInvalido(null);
  }, [itens, gravados]);

  const cadastradas = itens.filter((i) => gravados.has(i.chave)).length;
  const mudar = (chave: string, campo: 'sementes' | 'populacao', digitado: string) => {
    // só algarismos, vírgula e ponto: letra ou outro sinal digitado (ou colado) não entra no campo
    const valor = soNumeroDigitado(digitado);
    setCampos((c) => ({ ...c, [chave]: { ...c[chave], [campo]: valor } }));
    if (invalido?.startsWith(`${chave}|`)) setInvalido(null);
    setStatus(null);
  };

  const salvar = async () => {
    if (!chaves || gravando) return;
    const linhas: PopulacaoVariedade[] = [];
    for (const i of itens) {
      const c = campos[i.chave] ?? { sementes: '', populacao: '' };
      const r = validarPopulacao(c.sementes, c.populacao);
      if (r.erro !== null) {
        setInvalido(`${i.chave}|${r.campo}`);
        setStatus(`${colunasNomeVariedade(i).comercial || colunasNomeVariedade(i).pims}: ${r.erro}`);
        return;
      }
      linhas.push({ variedade: i.chave, sementesMetro: r.sementesMetro, populacao: r.populacao });
    }
    setGravando(true);
    setStatus('Gravando…');
    try {
      await repo().salvarPopulacao(chaves.unidade, chaves.safra, linhas);
      setStatus('Gravado. A legenda do mapa já mostra os valores.');
      onSalvo();
    } catch (e) {
      setStatus(`Não foi possível gravar: ${mensagemDeErro(e)}`);
    } finally {
      setGravando(false);
    }
  };

  return (
    <details className="cadastro-populacao">
      <summary>
        Sementes e população
        <span className="suave">{cadastradas ? ` · ${cadastradas} de ${itens.length} variedades cadastradas` : ' · nenhuma cadastrada'}</span>
      </summary>
      {!chaves ? (
        <p className="suave">Esta fazenda não tem a unidade do PIMS no cadastro de Fazendas: sem ela não há onde guardar os valores.</p>
      ) : erroLeitura ? (
        <p className="suave">Não foi possível ler o cadastro: {erroLeitura}</p>
      ) : (
        <div className="pilha">
          <p className="suave">
            Sementes por metro linear e população (plantas por hectare) de cada variedade desta fazenda nesta safra. Saem na tabela da legenda do mapa e na
            Revista do Operacional. Deixe em branco o que não quiser mostrar.
          </p>
          <div className="tabela-rolagem">
            <table className="tabela tabela-populacao">
              <thead>
                <tr>
                  <th>Variedade</th>
                  <th className="num">Sementes/m</th>
                  <th className="num">População</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((i) => {
                  const n = colunasNomeVariedade(i);
                  const c = campos[i.chave] ?? { sementes: '', populacao: '' };
                  const nome = n.comercial || n.pims;
                  return (
                    <tr key={i.chave}>
                      <td className="nome">
                        <span className="amostra-cor" style={{ background: i.cor }} /> {nome}
                        {n.comercial ? <small className="suave"> {n.pims}</small> : null}
                      </td>
                      <td className="num">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={c.sementes}
                          placeholder="12,2"
                          aria-label={`Sementes por metro de ${nome}`}
                          aria-invalid={invalido === `${i.chave}|sementes` || undefined}
                          onChange={(e) => mudar(i.chave, 'sementes', e.target.value)}
                        />
                      </td>
                      <td className="num">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={c.populacao}
                          placeholder="244.000"
                          aria-label={`População de ${nome}`}
                          aria-invalid={invalido === `${i.chave}|populacao` || undefined}
                          onChange={(e) => mudar(i.chave, 'populacao', e.target.value)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="linha">
            <button type="button" className="botao botao-pequeno" onClick={() => void salvar()} disabled={gravando || !itens.length}>
              Salvar sementes e população
            </button>
            {status ? (
              <span className="suave" role="status">
                {status}
              </span>
            ) : null}
          </div>
        </div>
      )}
    </details>
  );
}
