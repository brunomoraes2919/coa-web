import { useEffect, useState } from 'react';
import { repo } from '../data';
import Aviso, { mensagemDeErro } from '../components/Aviso';
import Carregando from '../components/Carregando';
import '../components/editor/editor.css';
import type { CorVariedade } from '../lib/types';

/** Cadastro de cores das variedades: trocar a cor ou apagar uma variedade (administrador). */
export default function CoresVariedades() {
  const [lista, setLista] = useState<CorVariedade[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState('');

  const carregar = () =>
    repo()
      .listarCoresVariedade()
      .then(setLista)
      .catch((e) => {
        setErro(`Não foi possível ler as cores: ${mensagemDeErro(e)}`);
        setLista([]);
      });
  useEffect(() => {
    void carregar();
  }, []);

  const trocar = async (variedade: string, cor: string) => {
    setErro(null);
    try {
      await repo().trocarCorVariedade(variedade, cor.toUpperCase());
    } catch (e) {
      setErro(`Não foi possível trocar a cor de ${variedade}: ${mensagemDeErro(e)}`);
    }
    await carregar();
  };
  const apagar = async (variedade: string) => {
    if (!window.confirm(`Apagar ${variedade} do cadastro de cores? Se ela aparecer de novo num mapa, ganha uma cor automática.`)) return;
    setErro(null);
    try {
      await repo().excluirCorVariedade(variedade);
    } catch (e) {
      setErro(`Não foi possível apagar ${variedade}: ${mensagemDeErro(e)}`);
    }
    await carregar();
  };

  const t = filtro.trim().toUpperCase();
  const visiveis = (lista ?? []).filter((c) => !t || c.variedade.includes(t));

  return (
    <div className="pagina">
      <div className="pagina-cabecalho">
        <div>
          <h1>Cores das variedades</h1>
          <p className="subtitulo">A mesma variedade sai com a mesma cor em todos os mapas de variedade. Troque a cor aqui.</p>
        </div>
      </div>
      {erro && (
        <Aviso tipo="erro" onFechar={() => setErro(null)}>
          {erro}
        </Aviso>
      )}
      {!lista ? (
        <Carregando texto="Carregando cores…" />
      ) : lista.length === 0 ? (
        <div className="cartao vazio">
          <p>Nenhuma variedade ainda. As cores são criadas sozinhas no primeiro mapa de variedade de cada uma.</p>
        </div>
      ) : (
        <section className="cartao pilha">
          <input type="search" placeholder="Filtrar pela variedade…" value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Filtrar variedades" />
          <table className="tabela">
            <thead>
              <tr>
                <th>Cor</th>
                <th>Variedade</th>
                <th>Criada em</th>
                <th aria-label="Ações" />
              </tr>
            </thead>
            <tbody>
              {visiveis.map((c) => (
                <tr key={c.variedade}>
                  <td>
                    <input type="color" value={c.cor} aria-label={`Cor de ${c.variedade}`} onChange={(e) => void trocar(c.variedade, e.target.value)} />
                  </td>
                  <td>{c.variedade}</td>
                  <td>{new Date(c.criadoEm).toLocaleDateString('pt-BR')}</td>
                  <td>
                    <button type="button" className="botao botao-pequeno botao-perigo" onClick={() => void apagar(c.variedade)}>
                      Apagar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
