import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { repo } from '../data/index';
import type { Fazenda, FazendaCoa } from '../lib/types';
import Aviso, { mensagemDeErro } from '../components/Aviso';
import Carregando from '../components/Carregando';
import { nomeVinculoCoa } from '../components/CampoFazendaCoa';
import { useImportarCadastroPadrao } from '../components/ImportarCadastroPadrao';

interface Linha {
  fazenda: Fazenda;
  talhoes: number;
  area: number;
}

const fmtHa = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtDataCurta = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR');
};

export default function Fazendas() {
  const loc = useLocation();
  const navigate = useNavigate();
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>((loc.state as { msg?: string } | null)?.msg ?? null);
  /** muda ao fim de uma importação do cadastro padrão: recarrega a lista */
  const [versao, setVersao] = useState(0);
  const importacao = useImportarCadastroPadrao(() => setVersao((v) => v + 1));
  /** fazendas do COA WEB, para a coluna do vínculo (modo local: vazia → coluna escondida) */
  const [fazendasCoa, setFazendasCoa] = useState<FazendaCoa[]>([]);
  const [erroCoa, setErroCoa] = useState<string | null>(null);

  // limpa a mensagem do histórico para não reaparecer ao recarregar
  useEffect(() => {
    if (loc.state) navigate(loc.pathname, { replace: true, state: null });
  }, [loc.state, loc.pathname, navigate]);

  // a lista do COA WEB muda pouco: carregada uma vez; se falhar, a coluna fica escondida (com aviso)
  useEffect(() => {
    let ativo = true;
    repo()
      .listarFazendasCoa()
      .then(
        (lista) => {
          if (ativo) setFazendasCoa(lista);
        },
        (e: unknown) => {
          if (ativo) setErroCoa(`Não foi possível listar as fazendas do COA WEB (coluna "COA WEB" oculta): ${mensagemDeErro(e)}`);
        },
      );
    return () => {
      ativo = false;
    };
  }, []);

  useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        const r = repo();
        const fazendas = await r.listarFazendas();
        const lista = await Promise.all(
          fazendas.map(async (fazenda) => {
            const ts = await r.obterTalhoes(fazenda.id);
            return { fazenda, talhoes: ts.length, area: ts.reduce((a, t) => a + (t.areaHa || 0), 0) };
          }),
        );
        lista.sort((a, b) => a.fazenda.nome.localeCompare(b.fazenda.nome, 'pt-BR'));
        if (ativo) {
          setErro(null);
          setLinhas(lista);
        }
      } catch (e) {
        if (ativo) {
          setErro(`Não foi possível carregar as fazendas: ${mensagemDeErro(e)}`);
          setLinhas([]);
        }
      }
    })();
    return () => {
      ativo = false;
    };
  }, [versao]);

  const comCoa = fazendasCoa.length > 0;
  const celulaCoa = (fazenda: Fazenda) =>
    nomeVinculoCoa(fazenda.coaFazendaId, fazendasCoa) ?? (
      <span className="chip chip-alerta" title="Sem fazenda do COA WEB ligada: só administradores veem esta fazenda e os mapas dela.">
        Sem vínculo (só admin)
      </span>
    );

  return (
    <div className="pagina">
      <div className="pagina-cabecalho">
        <div>
          <h1>Fazendas</h1>
          <p className="subtitulo">Shapes dos talhões usados nos mapas de chuva.</p>
        </div>
        <div className="linha">
          {importacao.botao}
          <Link to="/fazendas/nova" className="botao botao-primario">
            + Cadastrar fazenda
          </Link>
        </div>
      </div>

      {msg && (
        <Aviso tipo="sucesso" onFechar={() => setMsg(null)}>
          {msg}
        </Aviso>
      )}
      {importacao.aviso}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {erroCoa && (
        <Aviso tipo="alerta" onFechar={() => setErroCoa(null)}>
          {erroCoa}
        </Aviso>
      )}

      <div className="cartao">
        {linhas === null ? (
          <Carregando texto="Carregando fazendas…" />
        ) : linhas.length === 0 ? (
          !erro && (
            <div className="vazio">
              <p>Nenhuma fazenda cadastrada ainda.</p>
              <p className="suave">Para as unidades do COA, use “Importar cadastro padrão” com o arquivo cadastro-padrao-mapas.zip.</p>
              <Link to="/fazendas/nova" className="botao botao-primario">
                Cadastrar a primeira fazenda
              </Link>
            </div>
          )
        ) : (
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Fazenda</th>
                  <th className="num">Talhões</th>
                  <th className="num">Área (ha)</th>
                  {comCoa && <th>COA WEB</th>}
                  <th>Coluna do nome</th>
                  <th>Coluna do setor</th>
                  <th>Cadastrada em</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {linhas.map(({ fazenda, talhoes, area }) => (
                  <tr key={fazenda.id}>
                    <td>
                      <strong>{fazenda.nome}</strong>
                    </td>
                    <td className="num">{talhoes}</td>
                    <td className="num">{fmtHa(area)}</td>
                    {comCoa && <td>{celulaCoa(fazenda)}</td>}
                    <td>{fazenda.campoNome}</td>
                    <td>{fazenda.campoSetor ?? '—'}</td>
                    <td>{fmtDataCurta(fazenda.criadoEm)}</td>
                    <td className="num">
                      <Link to={`/fazendas/${fazenda.id}`} className="botao botao-pequeno">
                        Editar
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
