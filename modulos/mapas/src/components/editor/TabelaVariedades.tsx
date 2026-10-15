import { csvVariedadePorTalhao, fmtAreaHa, type FeicaoVariedade } from '../../lib/variedades';
import { baixarArquivo } from '../../lib/exportar';
import { fmtDataHora } from '../../lib/situacaoPlantio';
import type { ResumoVariedades } from '../../lib/types';

interface Props {
  resumo: ResumoVariedades;
  feicoes: FeicaoVariedade[];
  nomeArquivo: string;
  /** ISO da última atualização do plantio do PIMS; null = sem PIMS para a safra */
  geradoEm: string | null;
}

/** Seção "2. Variedades": cor, nome, área, % e talhões, e o CSV dos talhões. */
export default function TabelaVariedades({ resumo, feicoes, nomeArquivo, geradoEm }: Props) {
  const exportar = () => {
    const blob = new Blob(['﻿' + csvVariedadePorTalhao(feicoes)], { type: 'text/csv;charset=utf-8' });
    baixarArquivo(blob, nomeArquivo);
  };
  const pims = fmtDataHora(geradoEm, true);
  return (
    <div className="pilha">
      <p className="suave">{pims ? `Plantio do PIMS atualizado em ${pims}.` : 'Sem plantio do PIMS para esta fazenda e safra: os talhões saem como "Sem variedade".'}</p>
      <table className="tabela">
        <thead>
          <tr>
            <th aria-label="Cor" />
            <th>Variedade</th>
            <th className="num">Área (ha)</th>
            <th className="num">%</th>
            <th className="num">Talhões</th>
          </tr>
        </thead>
        <tbody>
          {resumo.itens.map((i) => (
            <tr key={i.chave || 'sem'}>
              <td><span className="amostra-cor" style={{ background: i.cor }} /></td>
              <td>{i.nome}</td>
              <td className="num">{fmtAreaHa(i.areaHa)}</td>
              <td className="num">{i.pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</td>
              <td className="num">{i.talhoes}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td />
            <th>Total</th>
            <th className="num">{fmtAreaHa(resumo.totalHa)}</th>
            <th className="num">100</th>
            <th className="num">{feicoes.length}</th>
          </tr>
        </tfoot>
      </table>
      <div>
        <button type="button" className="botao botao-pequeno" onClick={exportar} disabled={!feicoes.length}>
          Baixar CSV dos talhões
        </button>
      </div>
    </div>
  );
}
