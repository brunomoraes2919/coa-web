// @vitest-environment node
process.env.TZ = 'America/Cuiaba'
import { describe, expect, it } from 'vitest'
import { ContadorDoDia, pausaEntrePessoas, tempoDigitando, TETO_DO_DIA } from './ritmo'

describe('ritmo', () => {
  it('pausa entre pessoas de 20 a 45 s; digitando de 2 a 4 s', () => {
    expect(pausaEntrePessoas(() => 0)).toBe(20_000)
    expect(pausaEntrePessoas(() => 0.999999)).toBeLessThanOrEqual(45_000)
    expect(tempoDigitando(() => 0)).toBe(2_000)
    expect(tempoDigitando(() => 0.999999)).toBeLessThanOrEqual(4_000)
  })
  it('no máximo 3 alertas por pessoa por dia; o dia novo zera', () => {
    let agora = new Date(2026, 9, 6, 7).getTime()
    const c = new ContadorDoDia(() => agora)
    for (let i = 0; i < 3; i++) { expect(c.podeAlerta('a')).toBe(true); c.contar('a') }
    expect(c.podeAlerta('a')).toBe(false)
    expect(c.podeAlerta('b')).toBe(true)
    agora = new Date(2026, 9, 7, 7).getTime()
    expect(c.podeAlerta('a')).toBe(true)
    expect(c.total).toBe(0)
  })
  it('teto do dia vale para tudo, respostas de ATIVAR/SAIR incluídas', () => {
    const c = new ContadorDoDia(() => new Date(2026, 9, 6, 7).getTime())
    for (let i = 0; i < TETO_DO_DIA; i++) c.contar(null)
    expect(c.podeMensagem()).toBe(false)
    expect(c.podeAlerta('a')).toBe(false)
  })
})
