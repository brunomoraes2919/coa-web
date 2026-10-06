/** Ritmo de gente e tetos: o que mais pesa contra o número é parecer robô ou incomodar. */
import { chaveData } from '../logic/tempo'

export const TETO_POR_PESSOA = 3
export const TETO_DO_DIA = 80

const entre = (min: number, max: number, sorteio: () => number) => Math.floor(min + sorteio() * (max - min))

export function pausaEntrePessoas(sorteio: () => number = Math.random): number {
  return entre(20_000, 45_000, sorteio)
}

export function tempoDigitando(sorteio: () => number = Math.random): number {
  return entre(2_000, 4_000, sorteio)
}

const RESPOSTAS_NO_MINIMO_MS = 3_000
const RESPOSTAS_NO_MAXIMO_MS = 8_000

/** Entre uma resposta de ATIVAR/SAIR e a próxima: duas saindo no mesmo instante são sinal de robô. */
export function pausaEntreRespostas(sorteio: () => number = Math.random): number {
  return entre(RESPOSTAS_NO_MINIMO_MS, RESPOSTAS_NO_MAXIMO_MS, sorteio)
}

export class ContadorDoDia {
  private dia = ''
  private porContato = new Map<string, number>()
  private soma = 0
  private agora: () => number

  constructor(agora: () => number) {
    this.agora = agora
  }

  private virar(): void {
    const hoje = chaveData(this.agora())
    if (hoje === this.dia) return
    this.dia = hoje
    this.porContato.clear()
    this.soma = 0
  }

  /** Pode mandar mais uma mensagem qualquer hoje (teto do dia)? */
  podeMensagem(): boolean {
    this.virar()
    return this.soma < TETO_DO_DIA
  }

  /** Pode mandar mais um ALERTA para este contato hoje? */
  podeAlerta(contatoId: string): boolean {
    return this.podeMensagem() && (this.porContato.get(contatoId) ?? 0) < TETO_POR_PESSOA
  }

  /** `null` = resposta de ATIVAR/SAIR. */
  contar(contatoId: string | null): void {
    this.virar()
    this.soma += 1
    if (contatoId) this.porContato.set(contatoId, (this.porContato.get(contatoId) ?? 0) + 1)
  }

  get total(): number {
    this.virar()
    return this.soma
  }
}
