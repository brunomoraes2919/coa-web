import { colunasNomeVariedade, csvVariedadePorTalhao, fmtAreaHa, fmtPctVariedade, type FeicaoVariedade } from '../../lib/variedades';
import { baixarArquivo } from '../../lib/exportar';
import { fmtDataHora } from '../../lib/situacaoPlantio';
import type { ResumoVariedades } from '../../lib/types';

interface Props {
  resumo: ResumoVariedades;
  feicoes: FeicaoVariedade[];
  nomeArquivo: string;
  /** ISO da última atualização do plantio do PIMS; null = sem PIMS para a safra */
  geradoEm: string | null;
  /** chave da variedade → nome comercial (coluna própria no CSV) */
  comerciais?: ReadonlyMap<string, string>;
}

/** Seção "2. Variedades": cor, nome comercial, nome do PIMS, área, % e talhões, e o CSV dos talhões. */
export default function TabelaVariedades({ resumo, feicoes, nomeArquivo, geradoEm, comerciais }: Props) {
  const exportar = () => {
    const blob = new Blob(['﻿' + csvVariedadePorTalhao(feicoes, comerciais)], { type: 'text/csv;charset=utf-8' });
    baixarArquivo(blob, nomeArquivo);
  };
  const pims = fmtDataHora(geradoEm, true);
  return (
    <div className="pilha">
      <p className="suave">{pims ? `Plantio do PIMS atualizado em ${pims}.` : 'Sem plantio do PIMS para esta fazenda e safra: os talhões saem como "Sem variedade".'}</p>
      <div className="tabela-rolagem">
      <table className="tabela tabela-variedades">
        <colgroup>
          <col className="col-cor" />
          <col />
          <col />
          <col className="col-ha" />
          <col className="col-pct" />
          <col className="col-talhoes" />
        </colgroup>
        <thead>
          <tr>
            <th aria-label="Cor" />
            <th>Nome comercial</th>
            <th>Variedade (PIMS)</th>
            <th className="num" title="Área (ha)">ha</th>
            <th className="num">%</th>
            <th className="num">Talhões</th>
          </tr>
        </thead>
        <tbody>
          {resumo.itens.map((i) => {
            const n = colunasNomeVariedade(i);
            return (
              <tr key={i.chave || 'sem'}>
                <td><span className="amostra-cor" style={{ background: i.cor }} /></td>
                <td className={n.comercial ? 'nome' : 'nome suave'}>{n.comercial || '—'}</td>
                <td className="nome">{n.pims}</td>
                <td className="num">{fmtAreaHa(i.areaHa)}</td>
                <td className="num">{fmtPctVariedade(i.pct)}</td>
                <td className="num">{i.talhoes}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td />
            <th colSpan={2}>Total</th>
            <th className="num">{fmtAreaHa(resumo.totalHa)}</th>
            <th className="num">100</th>
            <th className="num">{feicoes.length}</th>
          </tr>
        </tfoot>
      </table>
      </div>
      <div>
        <button type="button" className="botao botao-pequeno" onClick={exportar} disabled={!feicoes.length}>
          Baixar CSV dos talhões
        </button>
      </div>
    </div>
  );
}
