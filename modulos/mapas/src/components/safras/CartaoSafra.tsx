import { Link } from 'react-router-dom';
import { fmtDataIso } from '../../lib/situacaoPlantio';
import type { Fazenda, Safra } from '../../lib/types';
import Carregando from '../Carregando';
import BarraPlantio from './BarraPlantio';
import MenuAcoes from './MenuAcoes';
import { resumoSafra, textoContagem, textoManuais, textoPims, type ResumoPlantioFazenda } from './safrasResumo';
import { chaveLinha, type LinhaResumo } from './useResumoSafras';

interface Props {
  safra: Safra;
  fazendas: Fazenda[];
  /** null = ainda carregando o plantio/áreas */
  linhas: Map<string, LinhaResumo> | null;
  onEditar: () => void;
  onExcluir: () => void;
}

function CelulaPlantio({ plantio, safra, fazenda }: { plantio: ResumoPlantioFazenda; safra: Safra; fazenda: Fazenda }) {
  if (plantio.fonte === 'pims') {
    const rodape = [textoPims(plantio.geradoEm), plantio.manuais > 0 ? `+ ${textoManuais(plantio.manuais)}` : ''].filter(Boolean).join(' · ');
    return (
      <div className="celula-plantio">
        <span>{textoContagem(plantio.contagem)}</span>
        <BarraPlantio contagem={plantio.contagem} />
        {rodape && <span className="suave">{rodape}</span>}
      </div>
    );
  }
  const motivo = fazenda.unidadePims
    ? `A unidade ${fazenda.unidadePims} ou a safra ${safra.nomePims ?? safra.nome} não está no plantio do PIMS.`
    : 'Fazenda sem unidade do PIMS vinculada (Fazendas → editar).';
  return (
    <div className="celula-plantio">
      <span className="chip chip-neutro" title={motivo}>
        Sem dados do PIMS
      </span>
      {plantio.manuais > 0 && <span className="suave">{textoManuais(plantio.manuais)}</span>}
    </div>
  );
}

export default function CartaoSafra({ safra, fazendas, linhas, onEditar, onExcluir }: Props) {
  const resumo = linhas
    ? resumoSafra(fazendas.map((f) => linhas.get(chaveLinha(safra.id, f.id))?.plantio).filter((p): p is ResumoPlantioFazenda => !!p))
    : null;

  return (
    <section className="cartao cartao-safra" aria-labelledby={`safra-${safra.id}`}>
      <div className="safra-cabecalho">
        <div className="safra-titulo">
          <h2 id={`safra-${safra.id}`}>{safra.nome}</h2>
          <div className="suave">
            {safra.cultura} · {fmtDataIso(safra.inicio)} a {fmtDataIso(safra.fim)}
            {safra.nomePims && safra.nomePims !== safra.nome ? ` · PIMS: ${safra.nomePims}` : ''}
          </div>
        </div>
        <div className="safra-resumo">
          {resumo ? (
            <>
              <strong>{resumo.texto}</strong>
              {resumo.total > 0 && (
                <BarraPlantio
                  contagem={{ plantado: resumo.plantados, plantando: resumo.plantando, a_plantar: resumo.total - resumo.plantados - resumo.plantando }}
                />
              )}
            </>
          ) : (
            <Carregando inline texto="Calculando o plantio…" />
          )}
        </div>
        <MenuAcoes
          rotulo={`Mais ações da safra ${safra.nome}`}
          acoes={[
            { rotulo: 'Editar safra', onClick: onEditar },
            { rotulo: 'Excluir safra', perigo: true, onClick: onExcluir },
          ]}
        />
      </div>

      {fazendas.length === 0 ? (
        <div className="vazio">
          <p>
            <Link to="/fazendas/nova">Cadastre uma fazenda</Link> para acompanhar o plantio e importar as áreas da cultura.
          </p>
        </div>
      ) : (
        <table className="tabela tabela-safra">
          <thead>
            <tr>
              <th>Fazenda</th>
              <th>Plantio (PIMS)</th>
              <th>Áreas da cultura</th>
              <th className="acoes">Ações</th>
            </tr>
          </thead>
          <tbody>
            {fazendas.map((f) => {
              const linha = linhas?.get(chaveLinha(safra.id, f.id));
              const semAreas = linha ? linha.areas.quantidade === 0 : false;
              return (
                <tr key={f.id}>
                  <td className="celula-fazenda">
                    <strong>{f.nome}</strong>
                    {!f.unidadePims && <span className="suave">sem vínculo com o PIMS</span>}
                  </td>
                  <td data-rotulo="Plantio (PIMS)">
                    {linhas === null ? (
                      <Carregando inline texto="Carregando…" />
                    ) : linha ? (
                      <CelulaPlantio plantio={linha.plantio} safra={safra} fazenda={f} />
                    ) : (
                      <span className="suave">—</span>
                    )}
                  </td>
                  <td data-rotulo="Áreas da cultura">
                    {linhas === null ? (
                      <span className="suave">…</span>
                    ) : !linha ? (
                      <span className="suave">—</span>
                    ) : semAreas ? (
                      <span
                        className="chip chip-alerta"
                        title={`Sem as áreas da cultura (shape da ${safra.cultura.toLowerCase()}), o mapa de chuva pinta os talhões base desta fazenda.`}
                      >
                        <span aria-hidden="true">!</span> Nenhuma área importada
                      </span>
                    ) : (
                      linha.areas.texto
                    )}
                  </td>
                  <td className="acoes">
                    <div className="linha">
                      <Link to={`/safras/${safra.id}/plantio/${f.id}`} className="botao botao-pequeno">
                        Ver plantio
                      </Link>
                      <Link
                        to={`/safras/${safra.id}/areas/${f.id}`}
                        className={semAreas ? 'botao botao-pequeno botao-primario' : 'botao botao-pequeno'}
                        title={`Áreas da cultura (shape da ${safra.cultura.toLowerCase()}) de ${f.nome} nesta safra`}
                      >
                        {linha && !semAreas ? 'Editar áreas' : 'Importar áreas'}
                      </Link>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
