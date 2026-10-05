/**
 * Notificação do Windows (Notification API). O navegador só a libera em
 * contexto seguro: o COA WEB, em https, serve; um http comum fora do localhost
 * não. Sem ela o alerta continua chegando por aviso e bipe.
 */
export type EstadoNotificacao = 'ativa' | 'pedir' | 'negada' | 'inseguro' | 'sem-suporte'

export function estadoNotificacao(): EstadoNotificacao {
  const N = typeof window === 'undefined' ? undefined : window.Notification
  if (!N) return 'sem-suporte'
  if (!window.isSecureContext) return 'inseguro'
  if (N.permission === 'granted') return 'ativa'
  if (N.permission === 'denied') return 'negada'
  return 'pedir'
}

export async function pedirNotificacao(): Promise<EstadoNotificacao> {
  if (estadoNotificacao() === 'pedir') {
    try {
      await window.Notification.requestPermission()
    } catch {
      /* navegador antigo: fica como está */
    }
  }
  return estadoNotificacao()
}

/** `tag` é o id do alerta. */
export function notificarWindows(titulo: string, corpo: string, tag: string): void {
  if (estadoNotificacao() !== 'ativa') return
  try {
    // Tag por alerta, não por título: com a mesma tag a nova SUBSTITUI a
    // anterior em silêncio — a média em Siriema apagaria a de Dourado ainda
    // não lida. Muda: a aba líder já bipou, o som do Windows seria eco.
    new window.Notification(titulo, { body: corpo, tag: `locks-sat-${tag}`, silent: true })
  } catch {
    /* alguns navegadores só notificam por service worker */
  }
}
