import { useRef, useState } from 'react';
import type { ResultadoIntegracao } from '../../lib/chuvaZeus';
import { fmtPeriodo } from '../../lib/format';
import type { Pic } from '../../lib/types';
import IntegracaoZeus from './IntegracaoZeus';
import TabelaPics from './TabelaPics';

export interface CsvInfo {
  nome: string;
  inicio: Date | null;
  fim: Date | null;
  avisos: string[];
}

interface Props {
  csv: CsvInfo | null;
  onArquivo(arquivo: File): void;
  pics: Pic[];
  onPics(pics: Pic[]): void;
  /** índices de PICs fora da área do mapa (só com a interpolação atualizada) */
  foraDaRegiao: Set<number>;
  /** nome da fazenda escolhida (para "Inserir dados via integração"); null = nenhuma */
  fazendaNome: string | null;
  /** PICs vindos da integração com a ZEUS, no lugar do CSV */
  onIntegracao(r: ResultadoIntegracao): void;
}

/**
 * Seção "2. Chuva da ZEUS": área para soltar/escolher o CSV, o botão "Inserir dados via integração"
 * (busca a chuva na ZEUS, sem CSV) e a tabela de PICs.
 */
export default function SecaoCsv({ csv, onArquivo, pics, onPics, foraDaRegiao, fazendaNome, onIntegracao }: Props) {
  const arquivoRef = useRef<HTMLInputElement>(null);
  const [arrastando, setArrastando] = useState(false);
  const receber = (arquivo: File | undefined) => {
    if (arquivo) onArquivo(arquivo);
  };

  return (
    <section className="cartao pilha">
      <h2>2. Chuva da ZEUS</h2>
      <div
        className={`soltar${arrastando ? ' sobre' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => arquivoRef.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && arquivoRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastando(false);
          receber(e.dataTransfer.files[0]);
        }}
      >
        <strong>{csv ? csv.nome : 'Arraste o CSV exportado da ZEUS'}</strong>
        <span className="suave">
          {csv ? `Período: ${fmtPeriodo(csv.inicio, csv.fim) || 'não informado'} · clique para trocar` : 'ou clique para escolher'}
        </span>
        <input
          ref={arquivoRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(e) => {
            receber(e.target.files?.[0]);
            e.target.value = ''; // permite escolher o mesmo arquivo de novo
          }}
        />
      </div>
      <IntegracaoZeus fazendaNome={fazendaNome} onDados={onIntegracao} />
      {pics.length > 0 && <TabelaPics pics={pics} onChange={onPics} foraDaRegiao={foraDaRegiao} />}
    </section>
  );
}
