/**
 * O que o módulo guarda no navegador (estado do vigia, alertas, centros das fazendas) é de quem
 * estava logado. Entrou outro usuário? Apaga antes de o vigia montar — cada um só vê as fazendas
 * liberadas para ele. A escolha de fundo do mapa é preferência do navegador e fica.
 */
export const CHAVE_DONO = 'locks_sat_usuario_v1'
const PREFIXO = 'locks_sat_'
const FICAM = new Set(['locks_sat_fundo_v1'])

/** Devolve `true` quando apagou dados de outro usuário. Nunca lança (navegador sem armazenamento). */
export function garantirDonoDosDados(usuarioId: string, armazenamento?: Storage): boolean {
  try {
    // Dentro do try: só o acesso a `window.localStorage` já lança em navegador que nega o armazenamento.
    const a = armazenamento ?? window.localStorage
    const dono = a.getItem(CHAVE_DONO)
    if (dono === usuarioId) return false
    let apagou = false
    // Sem dono registrado também apaga: não dá para saber de quem era.
    for (const chave of Object.keys(a)) {
      if (chave.startsWith(PREFIXO) && chave !== CHAVE_DONO && !FICAM.has(chave)) {
        a.removeItem(chave)
        apagou = true
      }
    }
    a.setItem(CHAVE_DONO, usuarioId)
    return apagou
  } catch {
    return false
  }
}
