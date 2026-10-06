/** ATIVAR e SAIR: as duas únicas mensagens que o serviço entende. */
export type Comando = 'ativar' | 'sair'

export function lerComando(texto: string): Comando | null {
  const limpo = texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, ' ').trim()
  if (limpo === 'ativar') return 'ativar'
  if (limpo === 'sair' || limpo === 'parar') return 'sair'
  return null
}

/** DDD + 8 últimos dígitos. O WhatsApp guarda alguns números brasileiros sem o nono dígito. */
export function chaveDoNumero(telefoneOuJid: string): string | null {
  const [usuario, servidor] = telefoneOuJid.split('@')
  if (servidor !== undefined && servidor !== 's.whatsapp.net') return null
  const d = usuario.split(':')[0].replace(/\D/g, '')
  const m = /^55([1-9][1-9])9?(\d{8})$/.exec(d)
  return m ? m[1] + m[2] : null
}

export function mesmoNumero(a: string, b: string): boolean {
  const ka = chaveDoNumero(a)
  return ka !== null && ka === chaveDoNumero(b)
}

/** Para os registros: nunca o número inteiro. */
export function mascarar(telefone: string): string {
  return `…${telefone.replace(/\D/g, '').slice(-4)}`
}
