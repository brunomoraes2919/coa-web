import { describe, expect, it } from 'vitest'
import {
  DIAS_NO_MAPA,
  diaDentroDoMapa,
  diasDoMapa,
  FOLGA_ULTIMO_PASSO_MS,
  inicioDaJanelaAoVivo,
  passosDoDia,
  passosDoDiaPassado,
  PASSOS_AO_VIVO,
  PAUSA_NO_ULTIMO_MS,
  proximoPassoAoVivo,
} from './passosMapa'
import { inicioDoDiaLocal, PASSO_MS, passoAnterior } from './tempo'

describe('passosDoDia', () => {
  it('da 00:00 local até o último passo que já tem imagem, de 10 em 10 min', () => {
    const agora = new Date(2026, 8, 24, 20, 7).getTime()
    const passos = passosDoDia(agora)
    expect(passos[0]).toBe(inicioDoDiaLocal(agora))
    expect(passos[passos.length - 1]).toBe(passoAnterior(agora - FOLGA_ULTIMO_PASSO_MS))
    expect(passos.every((p, i) => i === 0 || p - passos[i - 1] === PASSO_MS)).toBe(true)
  })

  it('logo depois da meia-noite, fica no último passo de ontem', () => {
    const agora = new Date(2026, 8, 24, 0, 5).getTime()
    expect(passosDoDia(agora)).toEqual([passoAnterior(agora - FOLGA_ULTIMO_PASSO_MS)])
  })
})

describe('dia passado', () => {
  it('os 144 passos do dia local inteiro, qualquer que seja a hora informada', () => {
    const passos = passosDoDiaPassado(new Date(2026, 8, 25, 15, 37).getTime())
    expect(passos).toHaveLength(144)
    expect(passos[0]).toBe(new Date(2026, 8, 25, 0, 0).getTime())
    expect(passos[143]).toBe(new Date(2026, 8, 25, 23, 50).getTime())
    expect(passos.every((p, i) => i === 0 || p - passos[i - 1] === 600_000)).toBe(true)
  })
})

describe('janela de dias do mapa', () => {
  const AGORA = new Date(2026, 9, 5, 14, 30).getTime()
  const dia = (mes: number, d: number) => new Date(2026, mes, d).getTime()

  it('hoje, ontem e o mais antigo (29 dias atrás), todos 00:00 local', () => {
    expect(DIAS_NO_MAPA).toBe(30)
    expect(diasDoMapa(AGORA)).toEqual({ hoje: dia(9, 5), ontem: dia(9, 4), primeiro: dia(8, 6) })
  })

  it('cruza a virada de mês sem escorregar de dia (1º de março → 31 de janeiro)', () => {
    expect(diasDoMapa(new Date(2026, 2, 1, 0, 5).getTime()).primeiro).toBe(dia(0, 31))
  })

  it('diaDentroDoMapa: um dia passado dentro da janela fica como está', () => {
    expect(diaDentroDoMapa(dia(9, 4), AGORA)).toBe(dia(9, 4))
    expect(diaDentroDoMapa(dia(8, 6), AGORA)).toBe(dia(8, 6)) // o limite vale
  })

  it('diaDentroDoMapa: hoje, nulo, mais velho que a janela e o futuro viram hoje (null)', () => {
    expect(diaDentroDoMapa(null, AGORA)).toBeNull()
    expect(diaDentroDoMapa(dia(9, 5), AGORA)).toBeNull()
    expect(diaDentroDoMapa(dia(8, 5), AGORA)).toBeNull() // um dia antes do limite
    expect(diaDentroDoMapa(dia(9, 6), AGORA)).toBeNull()
    expect(diaDentroDoMapa(Number.NaN, AGORA)).toBeNull()
  })
})

describe('laço do ao vivo (as últimas 3 h)', () => {
  it('a janela são os últimos 18 passos (3 h); a pausa no último é de 3 s', () => {
    expect(PASSOS_AO_VIVO).toBe(18)
    expect(PAUSA_NO_ULTIMO_MS).toBe(3000)
  })

  it('inicioDaJanelaAoVivo: 18 passos até o último; dia com menos passos começa em 0', () => {
    expect(inicioDaJanelaAoVivo(100)).toBe(82)
    expect(inicioDaJanelaAoVivo(18)).toBe(0)
    expect(inicioDaJanelaAoVivo(19)).toBe(1)
    expect(inicioDaJanelaAoVivo(7)).toBe(0)
    expect(inicioDaJanelaAoVivo(1)).toBe(0)
  })

  it('dentro da janela: avança um passo, sem segurar', () => {
    expect(proximoPassoAoVivo(100, 82)).toEqual({ indice: 83, segurar: false })
    expect(proximoPassoAoVivo(100, 97)).toEqual({ indice: 98, segurar: false })
    expect(proximoPassoAoVivo(100, 98)).toEqual({ indice: 99, segurar: false })
  })

  it('no último passo: segura e, depois, recomeça no início da janela (não no começo do dia)', () => {
    expect(proximoPassoAoVivo(100, 99)).toEqual({ indice: 82, segurar: true })
  })

  it('índice antes da janela (ela deslizou, ou o play veio de outro ponto): segue do início dela', () => {
    expect(proximoPassoAoVivo(100, 10)).toEqual({ indice: 82, segurar: false })
    expect(proximoPassoAoVivo(100, 81)).toEqual({ indice: 82, segurar: false })
  })

  it('índice além do último (a lista encolheu): tratado como o último', () => {
    expect(proximoPassoAoVivo(100, 140)).toEqual({ indice: 82, segurar: true })
  })

  it('dia com menos de 18 passos: o laço é o dia todo', () => {
    expect(proximoPassoAoVivo(7, 0)).toEqual({ indice: 1, segurar: false })
    expect(proximoPassoAoVivo(7, 5)).toEqual({ indice: 6, segurar: false })
    expect(proximoPassoAoVivo(7, 6)).toEqual({ indice: 0, segurar: true })
  })

  it('um passo só: segura nele e "recomeça" nele mesmo', () => {
    expect(proximoPassoAoVivo(1, 0)).toEqual({ indice: 0, segurar: true })
  })

  it('percorre exatamente 18 passos por volta e nunca sai da janela', () => {
    const vistos: number[] = []
    let i = inicioDaJanelaAoVivo(100)
    for (let n = 0; n < 40; n++) {
      vistos.push(i)
      i = proximoPassoAoVivo(100, i).indice
    }
    expect(Math.min(...vistos)).toBe(82)
    expect(Math.max(...vistos)).toBe(99)
    expect(vistos.slice(0, 19)).toEqual([...Array.from({ length: 18 }, (_, k) => 82 + k), 82])
  })
})
