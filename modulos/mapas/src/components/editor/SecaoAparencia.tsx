import { useState } from 'react';
import { lerParametroIdw, LIMITES_IDW } from '../../lib/editorRegras';
import { PALETTES } from '../../lib/palettes';
import { DESTAQUES_PICS } from '../../render/picStyle';
import { IDW_PADRAO, type DestaquePics, type EstiloPlantado, type IdwParams, type LayoutConfig, type MapaBase } from '../../lib/types';

type Aparencia = Omit<LayoutConfig, 'textos'>;

interface Props {
  config: Aparencia;
  onChange(parcial: Partial<Aparencia>): void;
  /** nome da paleta escolhida no modo automático (para mostrar ao usuário) */
  paletaAutomatica: string | null;
}

const ESTILOS: { id: EstiloPlantado; nome: string }[] = [
  { id: 'quadriculado', nome: 'Quadriculado' },
  { id: 'diagonal', nome: 'Hachura diagonal' },
  { id: 'pontilhado', nome: 'Pontilhado' },
  { id: 'contorno', nome: 'Só contorno laranja' },
];

const BASES: { id: MapaBase; nome: string }[] = [
  { id: 'topo', nome: 'Topográfico claro (Esri)' },
  { id: 'satelite', nome: 'Satélite (Esri)' },
  { id: 'nenhum', nome: 'Sem mapa base' },
];

type Orientacao = NonNullable<LayoutConfig['orientacao']>;
type Quadros = NonNullable<LayoutConfig['quadros']>;

const ORIENTACOES: { id: Orientacao; nome: string }[] = [
  { id: 'auto', nome: 'Automática' },
  { id: 'paisagem', nome: 'Paisagem' },
  { id: 'retrato', nome: 'Retrato' },
];

const QUADROS: { id: string; nome: string }[] = [
  { id: 'auto', nome: 'Automático' },
  { id: '1', nome: 'Um quadro' },
  { id: 'setor', nome: 'Um por setor' },
];

/** valor do seletor "Quadros" → LayoutConfig.quadros (o 1 é número) */
const lerQuadros = (v: string): Quadros => (v === '1' ? 1 : v === 'setor' ? 'setor' : 'auto');

export function SecaoAparencia({ config, onChange, paletaAutomatica }: Props) {
  const marca = (campo: 'mostrarRotulosTalhoes' | 'mostrarValoresPics' | 'mostrarGrade' | 'legendaCompacta', rotulo: string) => (
    <label className="linha">
      <input type="checkbox" checked={config[campo]} onChange={(e) => onChange({ [campo]: e.target.checked })} />
      {rotulo}
    </label>
  );
  return (
    <div className="pilha">
      <div className="grade-2">
        <label className="campo">
          <span>Página</span>
          <select value={config.pagina} onChange={(e) => onChange({ pagina: e.target.value as 'A3' | 'A4' })}>
            <option value="A3">A3 (padrão)</option>
            <option value="A4">A4</option>
          </select>
        </label>
        <label className="campo">
          <span>Orientação</span>
          <select
            value={config.orientacao ?? 'auto'}
            // outra folha = outro quadro: o enquadramento manual deixa de servir
            onChange={(e) => onChange({ orientacao: e.target.value as Orientacao, extent: null })}
          >
            {ORIENTACOES.map((o) => (
              <option key={o.id} value={o.id}>
                {o.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="campo">
          <span>Quadros</span>
          <select value={String(config.quadros ?? 'auto')} onChange={(e) => onChange({ quadros: lerQuadros(e.target.value), extent: null })}>
            {QUADROS.map((q) => (
              <option key={q.id} value={q.id}>
                {q.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="campo">
          <span>Mapa base</span>
          <select value={config.mapaBase} onChange={(e) => onChange({ mapaBase: e.target.value as MapaBase })}>
            {BASES.map((b) => (
              <option key={b.id} value={b.id}>
                {b.nome}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="campo">
        <span>Escala de cores</span>
        <select value={config.paletaId} onChange={(e) => onChange({ paletaId: e.target.value })}>
          <option value="auto">Automática{paletaAutomatica ? ` — ${paletaAutomatica}` : ''}</option>
          {PALETTES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </select>
        <small>A automática escolhe pela chuva máxima, com as cores dos estilos do COA.</small>
      </label>
      <label className="campo">
        <span>Talhões plantados</span>
        <select value={config.estiloPlantado} onChange={(e) => onChange({ estiloPlantado: e.target.value as EstiloPlantado })}>
          {ESTILOS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nome}
            </option>
          ))}
        </select>
      </label>
      <label className="campo">
        <span>Destaque do valor dos PICs</span>
        <select value={config.destaquePics ?? 'escuro'} onChange={(e) => onChange({ destaquePics: e.target.value as DestaquePics })}>
          {DESTAQUES_PICS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.nome}
            </option>
          ))}
        </select>
        <small>Compare na prévia: o contorno escuro lê bem sobre qualquer cor; o vermelho destaca mais em mapas azuis e verdes.</small>
      </label>
      <div className="pilha pilha-justa">
        {marca('mostrarRotulosTalhoes', 'Mostrar nome dos talhões')}
        {marca('mostrarValoresPics', 'Mostrar chuva de cada PIC')}
        {marca('mostrarGrade', 'Mostrar coordenadas nas bordas')}
        {marca('legendaCompacta', 'Legenda só com as classes presentes no mapa')}
      </div>
      <div>
        <button type="button" className="botao botao-pequeno" onClick={() => onChange({ extent: null })} disabled={!config.extent}>
          Reenquadrar a fazenda
        </button>
      </div>
    </div>
  );
}

interface PropsAvancado {
  idw: IdwParams;
  onChange(idw: IdwParams): void;
}

const TEXTOS_IDW: Record<keyof IdwParams, { rotulo: string; dica: string }> = {
  potencia: { rotulo: 'Potência', dica: 'Peso 1/dᵖ. QGIS do COA: 4' },
  vizinhos: { rotulo: 'PICs vizinhos', dica: 'Quantos PICs mais próximos entram em cada pixel (número inteiro). QGIS: 12' },
  pixel: { rotulo: 'Pixel (m)', dica: 'Tamanho da célula. QGIS: 5 m' },
  buffer: { rotulo: 'Buffer (m)', dica: 'Margem além dos talhões. QGIS: 10 m' },
};

const paraTexto = (v: number) => String(v).replace('.', ',');

/**
 * Campo de um parâmetro do IDW. Guarda o texto digitado à parte: valores intermediários ("", "2,",
 * "0" a caminho de "0,5"…) ficam na tela sem serem aplicados; só um valor válido vai para o mapa.
 */
function CampoIdw({ campo, valor, onValor }: { campo: keyof IdwParams; valor: number; onValor(v: number): void }) {
  const [texto, setTexto] = useState(() => paraTexto(valor));
  const [ultimo, setUltimo] = useState(valor);
  // valor mudou por fora (ex.: "Voltar ao padrão" ou mapa reaberto): mostra o novo valor
  if (valor !== ultimo) {
    setUltimo(valor);
    if (lerParametroIdw(campo, texto) !== valor) setTexto(paraTexto(valor));
  }
  const l = LIMITES_IDW[campo];
  const invalido = lerParametroIdw(campo, texto) === null;
  return (
    <label className="campo">
      <span>{TEXTOS_IDW[campo].rotulo}</span>
      <input
        type="text"
        inputMode={l.inteiro ? 'numeric' : 'decimal'}
        value={texto}
        aria-invalid={invalido}
        title={`Entre ${paraTexto(l.min)} e ${paraTexto(l.max)}${l.inteiro ? ' (número inteiro)' : ''}`}
        onChange={(e) => {
          setTexto(e.target.value);
          const v = lerParametroIdw(campo, e.target.value);
          if (v !== null && v !== valor) onValor(v);
        }}
        onBlur={() => {
          if (invalido) setTexto(paraTexto(valor)); // ao sair do campo, volta ao valor em uso
        }}
      />
      <small>
        {invalido ? `Valor inválido: use de ${paraTexto(l.min)} a ${paraTexto(l.max)}${l.inteiro ? ', inteiro' : ''}. ` : ''}
        {TEXTOS_IDW[campo].dica}
      </small>
    </label>
  );
}

export function SecaoAvancado({ idw, onChange }: PropsAvancado) {
  const padrao =
    idw.potencia === IDW_PADRAO.potencia &&
    idw.vizinhos === IDW_PADRAO.vizinhos &&
    idw.pixel === IDW_PADRAO.pixel &&
    idw.buffer === IDW_PADRAO.buffer;
  return (
    <div className="pilha">
      <p className="suave">
        Mesmo modelo do QGIS (<code>v.surf.idw</code> do GRASS). Só altere se quiser testar outro ajuste.
      </p>
      <div className="grade-2">
        {(Object.keys(LIMITES_IDW) as (keyof IdwParams)[]).map((k) => (
          <CampoIdw key={k} campo={k} valor={idw[k]} onValor={(v) => onChange({ ...idw, [k]: v })} />
        ))}
      </div>
      {!padrao && (
        <div>
          <button type="button" className="botao botao-pequeno" onClick={() => onChange({ ...IDW_PADRAO })}>
            Voltar ao padrão do QGIS
          </button>
        </div>
      )}
    </div>
  );
}
