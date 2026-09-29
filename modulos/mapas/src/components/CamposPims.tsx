import { useMemo, useState } from 'react';
import { unidadesDoArquivo } from '../lib/situacaoPlantio';
import { usePlantioPims } from './usePlantioPims';

const OUTRA = '__outra__';

interface Props {
  colunas: string[];
  /** até 3 valores de exemplo da coluna */
  exemplos(coluna: string): string;
  campoCodigo: string | null;
  onCampoCodigo(c: string | null): void;
  unidadePims: string | null;
  onUnidadePims(u: string | null): void;
}

/** Coluna do código PIMS do talhão e unidade da fazenda no PIMS (lista das unidades do plantio.json). */
export default function CamposPims({ colunas, exemplos, campoCodigo, onCampoCodigo, unidadePims, onUnidadePims }: Props) {
  const arquivo = usePlantioPims();
  const unidades = useMemo(() => unidadesDoArquivo(arquivo ?? null), [arquivo]);
  const [digitando, setDigitando] = useState(false);
  const foraDaLista = !!unidadePims && !unidades.includes(unidadePims);

  return (
    <>
      <label className="campo">
        <span>Coluna do código PIMS do talhão</span>
        <select value={campoCodigo ?? ''} onChange={(e) => onCampoCodigo(e.target.value || null)}>
          <option value="">(nenhuma — sem plantio automático)</option>
          {!!campoCodigo && !colunas.includes(campoCodigo) && <option value={campoCodigo}>{campoCodigo}</option>}
          {colunas.map((c) => (
            <option key={c} value={c}>
              {c}
              {exemplos(c) ? ` — ex.: ${exemplos(c)}` : ''}
            </option>
          ))}
        </select>
        <small>
          Código do talhão no PIMS (ex.: 001, 013A, 02PIVO). É normalizado ("TH 33A" → 033A); polígonos com o mesmo código viram um só
          talhão no cadastro.
        </small>
      </label>
      <label className="campo">
        <span>Unidade no PIMS</span>
        {digitando || (foraDaLista && unidades.length === 0) ? (
          <input
            type="text"
            value={unidadePims ?? ''}
            placeholder="Ex.: SIRIEMA"
            onChange={(e) => onUnidadePims(e.target.value.toUpperCase() || null)}
          />
        ) : (
          <select
            value={unidadePims ?? ''}
            onChange={(e) => {
              if (e.target.value === OUTRA) {
                setDigitando(true);
                return;
              }
              onUnidadePims(e.target.value || null);
            }}
          >
            <option value="">(sem vínculo com o PIMS)</option>
            {foraDaLista && <option value={unidadePims}>{unidadePims}</option>}
            {unidades.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
            <option value={OUTRA}>outra…</option>
          </select>
        )}
        <small>
          {arquivo === undefined
            ? 'Carregando as unidades do plantio do PIMS…'
            : unidades.length
              ? 'Unidades encontradas no plantio do PIMS (plantio.json).'
              : 'Plantio do PIMS indisponível: digite o nome da unidade como está no PIMS.'}
          {digitando && (
            <>
              {' '}
              <button type="button" className="botao-link" onClick={() => setDigitando(false)}>
                Voltar à lista
              </button>
            </>
          )}
        </small>
      </label>
    </>
  );
}
