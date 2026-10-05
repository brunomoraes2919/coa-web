import { afterEach, describe, expect, it, vi } from 'vitest'
import { tocarAlertaSonoro } from './alertaSonoro'

const original = window.AudioContext

function definirAudio(valor: unknown) {
  Object.defineProperty(window, 'AudioContext', { value: valor, configurable: true, writable: true })
}

afterEach(() => {
  definirAudio(original)
  vi.useRealTimers()
})

describe('tocarAlertaSonoro', () => {
  it('sem Web Audio não quebra', () => {
    definirAudio(undefined)
    expect(() => tocarAlertaSonoro()).not.toThrow()
  })

  it('dois bipes de 880 Hz', () => {
    vi.useFakeTimers()
    const osciladores: { frequency: { value: number } }[] = []
    const fechar = vi.fn(async () => {})
    class AudioFalso {
      currentTime = 0
      destination = {}
      close = fechar
      createOscillator() {
        const o = { frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() }
        osciladores.push(o)
        return o
      }
      createGain() {
        return { connect: vi.fn(), gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() } }
      }
    }
    definirAudio(AudioFalso)
    tocarAlertaSonoro()
    vi.advanceTimersByTime(300)
    expect(osciladores.map((o) => o.frequency.value)).toEqual([880, 880])
    // Fecha depois dos dois bipes: o navegador limita os AudioContext abertos.
    vi.advanceTimersByTime(399)
    expect(fechar).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fechar).toHaveBeenCalledTimes(1)
  })
})
