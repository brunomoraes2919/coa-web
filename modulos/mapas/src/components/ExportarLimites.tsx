import { useState } from 'react';
import { baixarArquivo } from '../lib/exportar';
import { kmlDe, shapefileZip, type FeicaoExportada } from '../lib/exportarLimites';
import { mensagemDeErro } from './Aviso';

/**
 * Botões "Exportar SHP" e "Exportar KML" dos limites de uma tela (talhões, áreas da cultura, plantio).
 * `montar` só roda no clique; `nome` é o nome do arquivo sem extensão (também o dos arquivos dentro do zip).
 */
export default function ExportarLimites({
  montar,
  nome,
  titulo,
  campoNome,
  quantidade,
}: {
  montar: () => FeicaoExportada[];
  nome: string;
  /** nome da camada no Google Earth */
  titulo: string;
  /** atributo que vira o nome de cada polígono no KML */
  campoNome: string;
  quantidade: number;
}) {
  const [gerando, setGerando] = useState<'shp' | 'kml' | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function exportar(formato: 'shp' | 'kml') {
    setGerando(formato);
    setMsg(null);
    try {
      const feicoes = montar();
      const { blob, ignoradas } =
        formato === 'shp'
          ? await shapefileZip(feicoes, nome)
          : (() => {
              const k = kmlDe(feicoes, titulo, campoNome);
              return { blob: new Blob([k.texto], { type: 'application/vnd.google-earth.kml+xml' }), ignoradas: k.ignoradas };
            })();
      baixarArquivo(blob, `${nome}.${formato === 'shp' ? 'zip' : 'kml'}`);
      if (ignoradas > 0) setMsg(`${ignoradas} ${ignoradas === 1 ? 'feição sem polígono ficou' : 'feições sem polígono ficaram'} de fora.`);
    } catch (e) {
      setMsg(`Não foi possível exportar: ${mensagemDeErro(e)}`);
    } finally {
      setGerando(null);
    }
  }

  return (
    <div className="linha exportar-limites">
      <button
        type="button"
        className="botao botao-pequeno"
        onClick={() => void exportar('shp')}
        disabled={quantidade === 0 || gerando !== null}
        title="Shapefile zipado (.shp, .shx, .dbf, .prj e .cpg), em WGS84"
      >
        {gerando === 'shp' ? 'Gerando…' : 'Exportar SHP'}
      </button>
      <button
        type="button"
        className="botao botao-pequeno"
        onClick={() => void exportar('kml')}
        disabled={quantidade === 0 || gerando !== null}
        title="KML para o Google Earth, com os atributos de cada polígono"
      >
        {gerando === 'kml' ? 'Gerando…' : 'Exportar KML'}
      </button>
      {msg && <span className="suave">{msg}</span>}
    </div>
  );
}
