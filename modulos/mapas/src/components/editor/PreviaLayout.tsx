import { useEffect, useRef, useState } from 'react';
import { areaVisivel, composicaoDe, desenhoA3, PAGINA_MM, paginaDe, renderLayout, type RenderInput } from '../../render';
import { alturaPrevia, arrastarExtent, controlesPrevia, larguraPrevia, panZoomPermitido, quadroEmCss, zoomNoPonto } from '../../lib/editorRegras';
import { liberarCanvas } from '../../lib/exportar';
import type { MapExtent } from '../../lib/types';
import BarraPrevia from './BarraPrevia';

interface Props {
  /** null = nada para desenhar ainda */
  input: RenderInput | null;
  /** enquadramento efetivo do quadro único (config.extent ?? automático); null com vários quadros */
  extent: MapExtent | null;
  /** enquadramento automático (config.extent null): Centralizar fica desabilitado */
  automatico: boolean;
  /** null = volta ao enquadramento automático (Centralizar) */
  onExtentChange(ext: MapExtent | null): void;
  /** texto sobreposto (ex.: "Interpolando… 42%") */
  ocupado?: string | null;
  onAvisos?(avisos: string[]): void;
}

const ZOOM_PASSO = 1.2;
const ERRO_DESENHO = 'Não foi possível desenhar a prévia do mapa. Tente reenquadrar ou recarregar a página.';
/** a prévia não passa desta fração da altura da janela (folha em retrato na coluna inteira ficaria enorme) */
const FRACAO_ALTURA_JANELA = 0.85;

/**
 * Prévia do layout: usa o mesmo renderLayout da exportação, no tamanho da tela e na proporção da folha
 * da composição (paisagem ou retrato). Com um quadro e o cadeado aberto, arrastar dentro dele move o
 * enquadramento e a roda do mouse aproxima/afasta; travada (padrão ao abrir), a roda rola a página.
 * Centralizar volta ao enquadramento automático. Com vários quadros, cada um se enquadra sozinho e a
 * prévia não reage ao mouse (sem cadeado nem Centralizar).
 */
export default function PreviaLayout({ input, extent, automatico, onExtentChange, ocupado, onAvisos }: Props) {
  const caixaRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** última imagem desenhada (base do retorno visual do arraste) */
  const ultimoRef = useRef<HTMLCanvasElement | null>(null);
  const seqRef = useRef(0);
  const [largura, setLargura] = useState(0);
  const [desenhando, setDesenhando] = useState(false);
  const [erroDesenho, setErroDesenho] = useState<string | null>(null);
  const arrasteRef = useRef<{ x0: number; y0: number; dx: number; dy: number; base: MapExtent } | null>(null);
  const zoomRef = useRef<{ ext: MapExtent; timer: number } | null>(null);
  /** cadeado: fechado a cada abertura do editor (não é guardado) */
  const [travado, setTravado] = useState(true);

  const comp = input ? composicaoDe(input) : null;
  const pagina = input ? paginaDe(input) : PAGINA_MM.A3;
  const folha = desenhoA3(comp?.orientacao ?? 'paisagem');
  const panZoom = !!comp && panZoomPermitido(comp);
  const controles = controlesPrevia(panZoom, travado, automatico);
  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
  const alturaMax = typeof window !== 'undefined' ? window.innerHeight * FRACAO_ALTURA_JANELA : 0;
  /** largura exibida (px CSS) */
  const larguraCss = larguraPrevia(largura, pagina, alturaMax);
  const alturaCss = alturaPrevia(larguraCss, pagina);
  const larguraPx = Math.max(1, Math.round(larguraCss * dpr));
  const alturaPx = Math.max(1, Math.round(alturaCss * dpr));
  const pxPorMm = larguraPx / pagina.w;

  useEffect(() => {
    const el = caixaRef.current;
    if (!el) return;
    // medição inicial síncrona: o ResizeObserver não dispara em abas ocultas/sem renderização
    setLargura(Math.floor(el.getBoundingClientRect().width));
    const obs = new ResizeObserver(([e]) => setLargura(Math.floor(e.contentRect.width)));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Ao desmontar: descarta desenhos em andamento, o zoom pendente e a última imagem.
  useEffect(
    () => () => {
      seqRef.current++;
      if (zoomRef.current) window.clearTimeout(zoomRef.current.timer);
      zoomRef.current = null;
      liberarCanvas(ultimoRef.current);
      ultimoRef.current = null;
    },
    [],
  );

  // Renderiza num canvas fora da tela e só então copia (sem piscar).
  useEffect(() => {
    const seq = ++seqRef.current; // qualquer desenho anterior em andamento fica obsoleto
    const visivel = canvasRef.current;
    if (!visivel || !input || largura < 10) {
      setDesenhando(false);
      if (!input) {
        liberarCanvas(ultimoRef.current);
        ultimoRef.current = null;
        setErroDesenho(null);
      }
      return;
    }
    setDesenhando(true);
    const t = window.setTimeout(async () => {
      const tmp = document.createElement('canvas');
      tmp.width = larguraPx;
      tmp.height = alturaPx;
      try {
        const ctx = tmp.getContext('2d');
        if (!ctx) throw new Error('canvas indisponível');
        const { avisos } = await renderLayout(ctx, input, pxPorMm);
        if (seq !== seqRef.current) {
          liberarCanvas(tmp);
          return;
        }
        visivel.width = larguraPx;
        visivel.height = alturaPx;
        visivel.getContext('2d')?.drawImage(tmp, 0, 0);
        liberarCanvas(ultimoRef.current);
        ultimoRef.current = tmp;
        setErroDesenho(null);
        onAvisos?.(avisos);
      } catch (e) {
        liberarCanvas(tmp);
        console.error('Falha ao desenhar a prévia', e);
        if (seq === seqRef.current) setErroDesenho(ERRO_DESENHO);
      } finally {
        if (seq === seqRef.current) setDesenhando(false);
      }
    }, 60);
    return () => window.clearTimeout(t);
    // onAvisos é callback de notificação; não deve disparar novo desenho
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, larguraPx, alturaPx, pxPorMm]);

  /**
   * Quadro único em pixels CSS: `q` = retângulo da composição (o centro do extent é o centro dele) e
   * `vis` = parte visível (dentro da moldura verde), usada para o toque e o retorno visual do arraste.
   * null com vários quadros (sem pan/zoom).
   */
  const quadroCss = () => {
    if (!comp || !panZoom) return null;
    const rect = comp.quadros[0].rect;
    return { q: quadroEmCss(rect, larguraCss, folha.w), vis: quadroEmCss(areaVisivel(rect, folha), larguraCss, folha.w) };
  };

  const dentroDoQuadro = (ev: { clientX: number; clientY: number }) => {
    const r = canvasRef.current?.getBoundingClientRect();
    const qc = quadroCss();
    if (!r || !qc) return null;
    const { q, vis } = qc;
    const x = ev.clientX - r.left;
    const y = ev.clientY - r.top;
    return x >= vis.x && x <= vis.x + vis.w && y >= vis.y && y <= vis.y + vis.h ? { x, y, q } : null;
  };

  /** Aplica já o zoom pela roda que ainda estava esperando; devolve o enquadramento resultante. */
  const aplicarZoomPendente = (): MapExtent | null => {
    const z = zoomRef.current;
    if (!z) return null;
    window.clearTimeout(z.timer);
    zoomRef.current = null;
    onExtentChange(z.ext);
    return z.ext;
  };

  /** Descarta o zoom pendente da roda e volta ao enquadramento automático. */
  const centralizar = () => {
    if (zoomRef.current) window.clearTimeout(zoomRef.current.timer);
    zoomRef.current = null;
    onExtentChange(null);
  };

  /** Redesenha a última imagem com o quadro do mapa deslocado (retorno visual do arraste). */
  const desenharDeslocado = (dx: number, dy: number) => {
    const c = canvasRef.current;
    const ult = ultimoRef.current;
    const ctx = c?.getContext('2d');
    const qc = quadroCss();
    if (!c || !ult || !ctx || !qc) return;
    const v = qc.vis;
    const [qx, qy, qw, qh] = [v.x * dpr, v.y * dpr, v.w * dpr, v.h * dpr];
    ctx.drawImage(ult, 0, 0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(qx, qy, qw, qh);
    ctx.clip();
    ctx.fillStyle = '#fff';
    ctx.fillRect(qx, qy, qw, qh);
    ctx.drawImage(ult, qx, qy, qw, qh, qx + dx * dpr, qy + dy * dpr, qw, qh);
    ctx.restore();
  };

  const onPointerDown = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    if (!controles.interativa || !extent || !dentroDoQuadro(ev)) return;
    // um zoom da roda ainda pendente vira a base do arraste (senão o arraste o desfaria, ou vice-versa)
    const base = aplicarZoomPendente() ?? extent;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    arrasteRef.current = { x0: ev.clientX, y0: ev.clientY, dx: 0, dy: 0, base };
  };
  const onPointerMove = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const a = arrasteRef.current;
    if (!a) return;
    a.dx = ev.clientX - a.x0;
    a.dy = ev.clientY - a.y0;
    desenharDeslocado(a.dx, a.dy);
  };
  const onPointerUp = () => {
    const a = arrasteRef.current;
    arrasteRef.current = null;
    const qc = quadroCss();
    if (!a || !qc || (Math.abs(a.dx) < 2 && Math.abs(a.dy) < 2)) return;
    onExtentChange(arrastarExtent(a.base, a.dx / qc.q.k, a.dy / qc.q.k)); // px CSS → mm do desenho
  };

  // Roda do mouse: listener não-passivo para poder impedir a rolagem da página (só destravada;
  // travada, a roda não é capturada e a página rola normalmente).
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const aoRolar = (ev: WheelEvent) => {
      if (!controles.interativa) return;
      const alvo = dentroDoQuadro(ev);
      if (!alvo) return;
      ev.preventDefault();
      const base = zoomRef.current?.ext ?? extent;
      if (!base || arrasteRef.current) return; // durante o arraste a roda não mexe no enquadramento
      const { q } = alvo;
      const mmX = (alvo.x - (q.x + q.w / 2)) / q.k;
      const mmY = (alvo.y - (q.y + q.h / 2)) / q.k;
      const novo = zoomNoPonto(base, mmX, mmY, ev.deltaY > 0 ? ZOOM_PASSO : 1 / ZOOM_PASSO);
      if (!novo) return; // já no limite de zoom
      if (zoomRef.current) window.clearTimeout(zoomRef.current.timer);
      zoomRef.current = {
        ext: novo,
        timer: window.setTimeout(() => {
          zoomRef.current = null;
          onExtentChange(novo);
        }, 180),
      };
    };
    c.addEventListener('wheel', aoRolar, { passive: false });
    return () => c.removeEventListener('wheel', aoRolar);
  });

  return (
    <div className="previa" ref={caixaRef}>
      {input ? (
        <canvas
          ref={canvasRef}
          className="previa-canvas"
          style={{
            width: larguraCss,
            height: alturaCss,
            margin: '0 auto',
            ...(controles.interativa ? {} : { cursor: 'default', touchAction: 'auto' }),
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          title={
            controles.interativa
              ? 'Arraste o mapa para mover; use a roda do mouse para aproximar ou afastar'
              : panZoom
                ? 'Mapa travado: clique no cadeado para mover e aproximar'
                : 'Com vários quadros o enquadramento é automático'
          }
        />
      ) : (
        <div className="previa-vazia" style={{ height: alturaCss || 300 }}>
          Escolha a fazenda e carregue o CSV da ZEUS para ver o mapa.
        </div>
      )}
      {(ocupado || desenhando) && input && <div className="previa-ocupado">{ocupado ?? 'Desenhando…'}</div>}
      {erroDesenho && input && (
        <div className="previa-erro" role="alert">
          {erroDesenho}
        </div>
      )}
      {input && (
        <div className="previa-rodape">
          <p className="suave dica-previa">{controles.dica}</p>
          {controles.botoes && (
            <BarraPrevia travado={travado} onTravado={setTravado} podeCentralizar={controles.centralizar} onCentralizar={centralizar} />
          )}
        </div>
      )}
    </div>
  );
}
