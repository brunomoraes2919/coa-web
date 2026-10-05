/**
 * Do que o vigia viu (ocorrências por quadrado) para o que a pessoa lê
 * (alertas por fazenda). Agrupa o mesmo tipo e severidade num alerta só —
 * cintilação é regional, e três fazendas vizinhas alertando juntas seriam
 * três toasts para a mesma notícia.
 */
import type { AlertaGnss, Janela, NivelCintilacao, Severidade, TipoAlerta } from '../tipos'
import { janelaAindaPorVir, textoJanela } from './janelaRisco'
import { horaDe, minutoDoDia, rotuloHora } from './tempo'

export const ANTECEDENCIA_JANELA_MIN = 30

export interface Ocorrencia {
  tipo: TipoAlerta
  severidade: Severidade
  celulaId: string
  /** Cintilação: valor medido (0–100). Previsão: índice de pico. Janela: dias. */
  valor: number
  /** Cintilação: hora da medida. Previsão: hora do pico. Janela: agora. */
  instante: number
  janela?: Janela
  /** Só janela: aviso do dia ou aviso de 30 min antes. */
  momento?: 'dia' | 'antes'
}

export function listarFazendas(nomes: string[]): string {
  const n = [...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  if (n.length === 1) return n[0]
  const resto = n.length > 3 ? ` e mais ${n.length - 3}` : ''
  return `${n.length} fazendas: ${n.slice(0, 3).join(', ')}${resto}`
}

function chaveGrupo(o: Ocorrencia): string {
  // O resumo do dia junta todas as janelas de todos os quadrados num alerta só;
  // o "começa em breve" é por janela (cada fazenda da mesma janela vai junta).
  if (o.tipo === 'janela') return o.momento === 'antes' ? `janela:antes:${o.janela?.inicio}:${o.janela?.fim}` : 'janela:dia'
  return `${o.tipo}:${o.severidade}`
}

function textoGrupo(grupo: Ocorrencia[], nomes: string[]): string {
  const o = grupo[0]
  const onde = listarFazendas(nomes)
  const pico = Math.max(...grupo.map((x) => x.valor))
  if (o.tipo === 'cintilacao') {
    const nivel = o.severidade === 'critico' ? 'forte' : 'média'
    return `Cintilação ${nivel} agora em ${onde} (até ${Math.round(pico)} de 100).`
  }
  if (o.tipo === 'previsao') {
    const primeiro = Math.min(...grupo.map((x) => x.instante))
    return `Previsão: índice ionosférico ${pico} a partir de ${horaDe(primeiro)} em ${onde}.`
  }
  if (o.momento !== 'antes') {
    const inicio = Math.min(...grupo.map((x) => x.janela?.inicio ?? 0))
    const fim = Math.max(...grupo.map((x) => x.janela?.fim ?? 0))
    const pior = grupo.reduce((a, b) => ((b.janela?.dias ?? 0) > (a.janela?.dias ?? 0) ? b : a))
    return `Janelas de risco de cintilação hoje entre ${rotuloHora(inicio)} e ${rotuloHora(fim)} em ${onde}. Pior horário: ${pior.janela ? textoJanela(pior.janela) : ''}.`
  }
  return `Janela de risco de cintilação começa em breve: ${o.janela ? textoJanela(o.janela) : ''} em ${onde}.`
}

const ORDEM_SEVERIDADE: Record<Severidade, number> = { critico: 0, aviso: 1 }

export function montarAlertas(
  ocorrencias: Ocorrencia[],
  fazendasPorCelula: Record<string, string[]>,
  agora: number,
): AlertaGnss[] {
  const grupos = new Map<string, Ocorrencia[]>()
  for (const o of ocorrencias) {
    const k = chaveGrupo(o)
    grupos.set(k, [...(grupos.get(k) ?? []), o])
  }
  const alertas: AlertaGnss[] = []
  for (const [k, grupo] of grupos) {
    const nomes = [...new Set(grupo.flatMap((o) => fazendasPorCelula[o.celulaId] ?? []))]
      .sort((a, b) => a.localeCompare(b, 'pt-BR'))
    if (!nomes.length) continue
    alertas.push({
      id: `${agora}:${k}`,
      instante: agora,
      tipo: grupo[0].tipo,
      severidade: grupo[0].severidade,
      fazendas: nomes,
      texto: textoGrupo(grupo, nomes),
    })
  }
  return alertas.sort((a, b) => ORDEM_SEVERIDADE[a.severidade] - ORDEM_SEVERIDADE[b.severidade])
}

/** Quais avisos de janela disparar agora. `avisados` são as chaves já
 *  avisadas HOJE — quem chama zera o conjunto quando o dia muda. As chaves são
 *  por quadrado, não por janela: o alerta por pedaço da noite era ruído. */
export function avisosDeJanela(
  celulaId: string,
  janelas: Janela[],
  agora: number,
  avisados: ReadonlySet<string>,
): { novasChaves: string[]; ocorrencias: Ocorrencia[] } {
  const minuto = minutoDoDia(agora)
  const novasChaves: string[] = []
  const ocorrencias: Ocorrencia[] = []
  const porVir = janelas.filter((j) => janelaAindaPorVir(j, minuto))
  // dia: UMA vez por dia por quadrado, levando todas as janelas que ainda vêm
  //  (o resumo junta tudo num alerta só — ver montarAlertas).
  // antes: UMA vez por noite por quadrado, para a primeira janela que começa
  //  nos próximos 30 min — as seguintes já estão no resumo da manhã.
  const chaveDia = `${celulaId}:dia`
  const chaveAntes = `${celulaId}:antes`
  const base = { tipo: 'janela' as const, severidade: 'aviso' as const, celulaId, instante: agora }

  if (porVir.length && !avisados.has(chaveDia)) {
    novasChaves.push(chaveDia)
    for (const j of porVir) ocorrencias.push({ ...base, valor: j.dias, janela: j, momento: 'dia' })
  }
  const proxima = porVir.find((j) => j.inicio - minuto >= 0 && j.inicio - minuto <= ANTECEDENCIA_JANELA_MIN)
  if (proxima && !avisados.has(chaveAntes)) {
    novasChaves.push(chaveAntes)
    ocorrencias.push({ ...base, valor: proxima.dias, janela: proxima, momento: 'antes' })
  }
  return { novasChaves, ocorrencias }
}

export function tituloAlerta(a: AlertaGnss): string {
  if (a.tipo === 'previsao') return a.severidade === 'critico' ? 'Previsão ionosférica — crítico' : 'Previsão ionosférica — aviso'
  if (a.tipo === 'janela') return 'Janela de risco de cintilação'
  if (!a.fazendas.length) return 'Locks SAT'
  return a.severidade === 'critico' ? 'Cintilação forte' : 'Cintilação média'
}

/** Cabe na tela: passou do limite, saem primeiro os AVISOS mais antigos —
 *  crítico só sai quando a fila inteira é de críticos (aí, o mais antigo). */
export function limitarAvisos(lista: AlertaGnss[], maximo: number): AlertaGnss[] {
  const fila = [...lista]
  while (fila.length > maximo) {
    const i = fila.findIndex((a) => a.severidade === 'aviso')
    fila.splice(i >= 0 ? i : 0, 1)
  }
  return fila
}

/** Uma linha de estado para o card do Locks SAT no COA WEB. Vazia quando não há fazenda para
 *  acompanhar (o card fica sem linha, em vez de "Aguardando dados" para sempre). */
export function resumoAgora(niveis: NivelCintilacao[], semDados: boolean): string {
  if (semDados) return 'Sem dados da Trimble'
  if (niveis.length === 0) return ''
  const conta = (n: NivelCintilacao) => niveis.filter((x) => x === n).length
  const fazendas = (n: number) => `${n} ${n === 1 ? 'fazenda' : 'fazendas'}`
  if (conta('forte')) return `Agora: forte em ${fazendas(conta('forte'))}`
  if (conta('media')) return `Agora: média em ${fazendas(conta('media'))}`
  // "Tranquilo" é afirmação sobre a medida: só vale com TODAS medidas. Falta
  // de dado dita como calma seria o falso negativo que o vigia existe para evitar.
  const semDado = conta('sem-dado')
  if (semDado === niveis.length) return 'Aguardando dados'
  if (semDado) return `Sem medida recente em ${fazendas(semDado)}`
  return 'Tudo tranquilo agora'
}
