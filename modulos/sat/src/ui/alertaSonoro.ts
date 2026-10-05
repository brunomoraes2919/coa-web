/**
 * Beep de alerta do vigia.
 *
 * Dois tons curtos (880Hz, 0.32s, defasados 220ms) via Web Audio API — sem
 * arquivo de áudio pra carregar. Silenciosamente ignorado se o navegador não
 * suportar (ou se a política de autoplay ainda não liberou áudio).
 */
export function tocarAlertaSonoro(): void {
  try {
    const AudioCtxCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtxCtor) return
    const ctx = new AudioCtxCtor()
    for (const atraso of [0, 220]) {
      window.setTimeout(() => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.frequency.value = 880
        gain.gain.setValueAtTime(0.0001, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3)
        osc.start()
        osc.stop(ctx.currentTime + 0.32)
      }, atraso)
    }
    // Um contexto novo por alerta: fecha depois do segundo bipe (220 ms +
    // 320 ms), senão cada alerta deixa um aberto segurando o áudio — e o
    // navegador limita quantos podem existir.
    window.setTimeout(() => void ctx.close?.(), 700)
  } catch {
    /* áudio não suportado nesse navegador — ignora silenciosamente */
  }
}
