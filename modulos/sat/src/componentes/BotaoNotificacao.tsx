import { useState } from 'react'
import { estadoNotificacao, pedirNotificacao } from '../vigia/notificacaoWindows'

export default function BotaoNotificacao() {
  const [estado, setEstado] = useState(estadoNotificacao)
  if (estado === 'sem-suporte') return null
  if (estado === 'ativa') return <span className="gnss-notif ok">Notificações do Windows ativas</span>
  if (estado === 'negada') return <span className="gnss-notif">Notificações bloqueadas no navegador</span>
  if (estado === 'inseguro') {
    return (
      <span className="gnss-notif" title="O navegador só libera notificação em endereço seguro (https ou localhost).">
        Notificação do Windows só em endereço seguro (https)
      </span>
    )
  }
  return (
    <button type="button" className="gnss-btn" onClick={async () => setEstado(await pedirNotificacao())}>
      Ativar notificações do Windows
    </button>
  )
}
