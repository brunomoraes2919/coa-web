import { useState } from 'react';
import { mensagemDeErro } from '../Aviso';
import type { CamadaExportavel } from '../../lib/camadasCar';
import { baixarArquivo, nomeBaseArquivo } from '../../lib/exportar';
import { camadasZip, shapefileZip } from '../../lib/exportarLimites';
import type { MapaBase } from '../../lib/types';
import { CAMADAS_CAR, type CamadaCar } from '../../render/car';

/** Imagens de fundo do Mapa de CAR (o topográfico completo só existe aqui). */
const BASES_CAR: { id: MapaBase; nome: string }[] = [
  { id: 'satelite', nome: 'Satélite (Esri)' },
  { id: 'topoCompleto', nome: 'Topográfico (Esri)' },
  { id: 'topo', nome: 'Topográfico claro (Esri)' },
  { id: 'nenhum', nome: 'Sem imagem de fundo' },
];

interface Props {
  mapaBase: MapaBase;
  onMapaBase(b: MapaBase): void;
  /** camadas com alguma feição nesta fazenda (as outras nem aparecem na lista) */
  presentes: ReadonlySet<CamadaCar>;
  ocultas: ReadonlySet<CamadaCar>;
  onOcultas(o: Set<CamadaCar>): void;
  /** camadas para exportar (só as que têm feição) */
  exportaveis: CamadaExportavel[];
  fazenda: string;
}

/**
 * Mapa de CAR e Matrícula: imagem de fundo, camadas que aparecem no mapa (e na legenda) e exportação de cada camada
 * em shapefile, separada, ou todas num zip.
 */
export default function CamadasCar({ mapaBase, onMapaBase, presentes, ocultas, onOcultas, exportaveis, fazenda }: Props) {
  const [gerando, setGerando] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const lista = CAMADAS_CAR.filter((c) => presentes.has(c.id));

  const alternar = (id: CamadaCar, ligada: boolean) => {
    const o = new Set(ocultas);
    if (ligada) o.delete(id);
    else o.add(id);
    onOcultas(o);
  };

  const exportar = async (qual: CamadaExportavel | 'todas') => {
    setGerando(qual === 'todas' ? 'todas' : qual.id);
    setMsg(null);
    try {
      if (qual === 'todas') {
        const blob = await camadasZip(exportaveis.map((c) => ({ base: c.arquivo, feicoes: c.feicoes, geometria: c.geometria })));
        baixarArquivo(blob, `${nomeBaseArquivo('CAR', fazenda, 'CAMADAS')}.zip`);
      } else {
        const base = nomeBaseArquivo('CAR', fazenda, qual.arquivo);
        const { blob } = await shapefileZip(qual.feicoes, base, qual.geometria);
        baixarArquivo(blob, `${base}.zip`);
      }
    } catch (e) {
      setMsg(`Não foi possível exportar: ${mensagemDeErro(e)}`);
    } finally {
      setGerando(null);
    }
  };

  return (
    <div className="pilha">
      <label className="campo">
        <span>Imagem de fundo</span>
        <select value={mapaBase} onChange={(e) => onMapaBase(e.target.value as MapaBase)}>
          {BASES_CAR.map((b) => (
            <option key={b.id} value={b.id}>
              {b.nome}
            </option>
          ))}
        </select>
      </label>

      {lista.length > 0 && (
        <fieldset className="camadas-car">
          <legend>Camadas no mapa</legend>
          {lista.map((c) => (
            <label key={c.id} className="linha">
              <input type="checkbox" checked={!ocultas.has(c.id)} onChange={(e) => alternar(c.id, e.target.checked)} />
              {c.nome}
            </label>
          ))}
          <small className="suave">A camada desligada sai do mapa, dos rótulos e da legenda. O quadro de áreas continua igual.</small>
          {ocultas.size > 0 && (
            <div>
              <button type="button" className="botao botao-pequeno" onClick={() => onOcultas(new Set())}>
                Mostrar todas
              </button>
            </div>
          )}
        </fieldset>
      )}

      {exportaveis.length > 0 && (
        <div className="pilha pilha-justa">
          <strong>Exportar camadas (.shp)</strong>
          <small className="suave">Cada camada sai num .zip com .shp, .shx, .dbf, .prj e .cpg, em WGS84, com os atributos da base de origem.</small>
          <ul className="lista-camadas-exportar">
            {exportaveis.map((c) => (
              <li key={c.id}>
                <span>
                  {c.nome} <small className="suave">{c.feicoes.length}</small>
                </span>
                <button type="button" className="botao botao-pequeno" onClick={() => void exportar(c)} disabled={gerando !== null} aria-label={`Exportar ${c.nome} em .shp`}>
                  {gerando === c.id ? 'Gerando…' : 'SHP'}
                </button>
              </li>
            ))}
          </ul>
          <div className="linha">
            <button type="button" className="botao botao-pequeno" onClick={() => void exportar('todas')} disabled={gerando !== null}>
              {gerando === 'todas' ? 'Gerando…' : 'Todas as camadas (.zip)'}
            </button>
            {msg && <span className="suave">{msg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
