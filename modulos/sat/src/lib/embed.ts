/**
 * Modo embutido: o COA WEB mostra o módulo num iframe da mesma origem
 * (`sat/index.html?embed=1#/<rota>`). O módulo avisa o site por postMessage, sempre com
 * `targetOrigin = location.origin`:
 * - `{ tipo: 'sat-rota', rota, titulo }` — destaca o botão do menu e troca o título;
 * - `{ tipo: 'sat-alerta', id, titulo, texto, severidade }` — o site mostra o aviso;
 * - `{ tipo: 'sat-resumo', texto }` — linha de estado no card da categoria.
 */

/** `?embed=1` na URL: o módulo está dentro do COA WEB. Sem `location` (testes em node), false. */
export function emEmbed(loc?: Pick<Location, 'search'>): boolean {
  const l = loc ?? (typeof location !== 'undefined' ? location : undefined)
  if (!l) return false
  return new URLSearchParams(l.search).get('embed') === '1'
}

/** Título do topo do COA WEB para a rota do módulo. */
export function tituloDaRota(rota: string): string {
  if (rota === '/hoje') return 'Hoje'
  if (rota === '/mapa') return 'Mapa da ionosfera'
  if (rota === '/alertas') return 'Alertas'
  return 'Locks SAT'
}

/** Dentro do COA WEB: `?embed=1` na URL E dentro de um iframe (`parent !== window`). Aberto direto, mesmo com `?embed=1`, não. */
export function dentroDoCoa(): boolean {
  if (typeof window === 'undefined' || !emEmbed(window.location)) return false
  const pai = window.parent
  return Boolean(pai) && pai !== window
}

/** Um postMessage que falha nunca pode derrubar quem chama: o vigia toca o bipe logo depois do aviso. */
function paraOCoa(mensagem: object): void {
  if (!dentroDoCoa()) return
  try {
    window.parent.postMessage(mensagem, window.location.origin)
  } catch {
    /* o site não recebe esta mensagem; o módulo segue */
  }
}

export function avisarRota(rota: string): void {
  paraOCoa({ tipo: 'sat-rota', rota, titulo: tituloDaRota(rota) })
}

export interface AlertaParaOCoa {
  id: string
  titulo: string
  texto: string
  severidade: 'aviso' | 'critico'
}

export function avisarAlerta(a: AlertaParaOCoa): void {
  paraOCoa({ tipo: 'sat-alerta', id: a.id, titulo: a.titulo, texto: a.texto, severidade: a.severidade })
}

export function avisarResumo(texto: string): void {
  paraOCoa({ tipo: 'sat-resumo', texto })
}
