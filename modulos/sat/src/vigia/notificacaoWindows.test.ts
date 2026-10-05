import { afterEach, describe, expect, it, vi } from 'vitest'
import { estadoNotificacao, notificarWindows, pedirNotificacao } from './notificacaoWindows'

const original = { Notification: window.Notification, isSecureContext: window.isSecureContext }

function definir(nome: string, valor: unknown) {
  Object.defineProperty(window, nome, { value: valor, configurable: true, writable: true })
}

function notificacaoFalsa(permissao: NotificationPermission) {
  const criadas: { titulo: string; opcoes: NotificationOptions }[] = []
  class Falsa {
    static permission: NotificationPermission = permissao
    static requestPermission = vi.fn(async () => {
      Falsa.permission = 'granted'
      return 'granted' as NotificationPermission
    })
    constructor(titulo: string, opcoes: NotificationOptions) {
      criadas.push({ titulo, opcoes })
    }
  }
  definir('Notification', Falsa)
  return criadas
}

afterEach(() => {
  definir('Notification', original.Notification)
  definir('isSecureContext', original.isSecureContext)
})

describe('notificação do Windows', () => {
  it('sem suporte no navegador', () => {
    definir('Notification', undefined)
    expect(estadoNotificacao()).toBe('sem-suporte')
  })

  it('endereço inseguro (IP da rede) não libera', () => {
    notificacaoFalsa('default')
    definir('isSecureContext', false)
    expect(estadoNotificacao()).toBe('inseguro')
  })

  it('pede permissão e passa a notificar', async () => {
    const criadas = notificacaoFalsa('default')
    definir('isSecureContext', true)
    expect(estadoNotificacao()).toBe('pedir')
    expect(await pedirNotificacao()).toBe('ativa')
    notificarWindows('Cintilação forte', 'Dourado', 'a1')
    expect(criadas).toEqual([
      { titulo: 'Cintilação forte', opcoes: { body: 'Dourado', tag: 'locks-sat-a1', silent: true } },
    ])
  })

  it('dois alertas de mesmo título: cada um com sua tag, um não substitui o outro', () => {
    const criadas = notificacaoFalsa('granted')
    definir('isSecureContext', true)
    notificarWindows('Cintilação forte', 'Dourado', 'a1')
    notificarWindows('Cintilação forte', 'Siriema', 'a2')
    expect(criadas.map((c) => c.opcoes.tag)).toEqual(['locks-sat-a1', 'locks-sat-a2'])
  })

  it('negada não notifica', () => {
    const criadas = notificacaoFalsa('denied')
    definir('isSecureContext', true)
    expect(estadoNotificacao()).toBe('negada')
    notificarWindows('x', 'y', 'z')
    expect(criadas).toEqual([])
  })
})
