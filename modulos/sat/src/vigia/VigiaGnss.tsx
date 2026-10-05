/**
 * O vigia de cintilação — montado UMA vez, na casca do módulo (App.tsx). Dentro
 * do COA WEB o iframe do módulo é carregado depois do login e fica vivo o tempo
 * todo, então o vigia vale para o site inteiro, em qualquer categoria aberta; e
 * quem desenha o aviso é o site (`avisarAlerta`), não o módulo.
 *
 * Só a aba líder (logic/liderAba.ts) consulta a Trimble e roda o juízo; ela
 * grava estado e alertas no localStorage e as outras abas leem pelo evento
 * `storage`. O aviso chega em todas; bipe e notificação do Windows só na
 * líder, para não ecoar.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { celulasDasFazendas } from '../fazendasGnss'
import { avisarAlerta, avisarResumo, dentroDoCoa } from '../lib/embed'
import { limitarAvisos, tituloAlerta } from '../logic/alertas'
import { novaIdAba, RENOVACAO_MS, soltarLideranca, tentarLiderar } from '../logic/liderAba'
import { HORA_MS } from '../logic/tempo'
import type { AlertaGnss, FazendaGnss } from '../tipos'
import { tocarAlertaSonoro } from '../ui/alertaSonoro'
import AvisosGnss from './AvisosGnss'
import { avaliar, FALHAS_PARA_SEM_DADOS, resumoDoVigia } from './avaliar'
import { aplicarCiclo, comJitter, dependenciasPadrao, executarCiclo, msAteProximoCiclo } from './ciclo'
import type { EstadoVigia } from './estado'
import { notificarWindows } from './notificacaoWindows'
import {
  CHAVE_ALERTAS, CHAVE_ESTADO, CHAVE_MEMORIA, gravar, lerAlertas, lerEstado, lerMemoria, podarAlertas,
} from './persistencia'
import { VigiaContexto, type ValorVigia } from './vigiaContexto'

const ESPERA_APOS_FALHA_MS = 5 * 60_000
const RECARGA_FAZENDAS_MS = HORA_MS
/** Aba seguidora só mostra toast de alerta recente — nunca a fila antiga. */
const JANELA_TOAST_SEGUIDORA_MS = 15 * 60_000
const MAX_AVISOS = 3
/** Dado mais novo que um passo da Trimble: abrir/recarregar a página não
 *  consulta de novo (cada F5 eram 1–2 chamadas por quadrado). */
const DADO_FRESCO_MS = 10 * 60_000
/** "Atualizar" no máximo uma vez por minuto — clique repetido é rajada. */
const INTERVALO_MINIMO_ATUALIZAR_MS = 60_000

/** O mesmo id em todas as abas para a mesma sequência de falhas (ela só
 *  recomeça depois de um sucesso, que muda `ultimoSucesso`) — assim cada aba
 *  mostra o aviso uma vez só, sem combinar nada com a líder. */
function avisoSemDados(estado: EstadoVigia, agora: number): AlertaGnss {
  return {
    id: `sem-dados:${estado.ultimoSucesso ?? 0}`,
    instante: agora,
    tipo: 'cintilacao',
    severidade: 'aviso',
    fazendas: [],
    texto: 'Monitoramento de cintilação sem dados da Trimble — sem medida nova até a conexão voltar.',
  }
}

interface Props {
  /** Há sessão no COA WEB: o vigia roda. Sem ela, não consulta nada. */
  ativo: boolean
  /** Fazendas do usuário (cadastro do Mapas). Só a aba líder chama. Precisa ser estável entre renders (useCallback). */
  carregarFazendas: () => Promise<FazendaGnss[]>
  children: ReactNode
}

export default function VigiaGnssProvider({ ativo, carregarFazendas, children }: Props) {
  const [estado, setEstado] = useState<EstadoVigia>(lerEstado)
  const [alertas, setAlertas] = useState<AlertaGnss[]>(lerAlertas)
  const [lider, setLider] = useState(false)
  const [avisos, setAvisos] = useState<AlertaGnss[]>([])
  const [aba] = useState(novaIdAba)
  const [vistosIniciais] = useState(() => new Set(alertas.map((a) => a.id)))

  const estadoRef = useRef(estado)
  const liderRef = useRef(false)
  const rodando = useRef(false)
  /** Quando o último ciclo COMEÇOU — é o que limita o "Atualizar". */
  const inicioUltimoCiclo = useRef(0)
  const vistos = useRef(vistosIniciais)
  /** O vigia saiu de cena (logout, outro usuário)? Um ciclo que termina depois disso não grava nem avisa. */
  const montado = useRef(true)
  useEffect(() => {
    montado.current = true
    return () => {
      montado.current = false
    }
  }, [])

  const publicarEstado = useCallback((proximo: EstadoVigia) => {
    estadoRef.current = proximo
    gravar(CHAVE_ESTADO, proximo)
    setEstado(proximo)
  }, [])

  const anunciar = useCallback((lista: AlertaGnss[], comSom: boolean) => {
    const ineditos = lista.filter((a) => !vistos.current.has(a.id))
    if (!ineditos.length) return
    for (const a of ineditos) vistos.current.add(a.id)
    setAvisos((atuais) => limitarAvisos([...atuais, ...ineditos], MAX_AVISOS))
    // Dentro do COA WEB quem mostra o aviso é o site — em todas as abas, com ou sem som.
    for (const a of ineditos) avisarAlerta({ id: a.id, titulo: tituloAlerta(a), texto: a.texto, severidade: a.severidade })
    if (!comSom) return
    tocarAlertaSonoro()
    for (const a of ineditos) notificarWindows(tituloAlerta(a), a.texto, a.id)
  }, [])

  /** Um ciclo completo. Devolve o estado novo, ou `null` se não rodou. */
  const ciclo = useCallback(async (): Promise<EstadoVigia | null> => {
    if (rodando.current || !liderRef.current) return null
    const celulas = celulasDasFazendas(estadoRef.current.fazendas)
    if (!celulas.length) return null
    rodando.current = true
    inicioUltimoCiclo.current = Date.now()
    try {
      const resultado = await executarCiclo(celulas, Date.now(), dependenciasPadrao())
      // Saiu de cena durante a consulta: o dado é de quem já foi embora — nada é gravado, avisado nem tocado.
      if (!montado.current) return null
      const agora = Date.now()
      const proximo = aplicarCiclo(estadoRef.current, resultado, agora)
      publicarEstado(proximo)

      const juizo = avaliar(proximo, lerMemoria(), agora)
      gravar(CHAVE_MEMORIA, juizo.memoria)
      if (juizo.alertas.length) {
        const lista = podarAlertas([...juizo.alertas, ...lerAlertas()], agora)
        gravar(CHAVE_ALERTAS, lista)
        setAlertas(lista)
        anunciar(juizo.alertas, true)
      }
      // Falta de dado nunca é silenciosa: na terceira falha seguida, um aviso só.
      if (proximo.falhasSeguidas === FALHAS_PARA_SEM_DADOS) anunciar([avisoSemDados(proximo, agora)], true)
      return proximo
    } finally {
      rodando.current = false
    }
  }, [anunciar, publicarEstado])

  /* Liderança: tenta assumir agora e renova a cada 30 s. */
  useEffect(() => {
    if (!ativo) return
    const renovar = () => {
      const eu = tentarLiderar(window.localStorage, aba, Date.now())
      liderRef.current = eu
      setLider(eu)
    }
    const sair = () => soltarLideranca(window.localStorage, aba)
    renovar()
    const t = window.setInterval(renovar, RENOVACAO_MS)
    // O COA WEB descarrega o módulo removendo o iframe (logout): aí `beforeunload` não dispara, `pagehide` sim.
    window.addEventListener('beforeunload', sair)
    window.addEventListener('pagehide', sair)
    return () => {
      window.clearInterval(t)
      window.removeEventListener('beforeunload', sair)
      window.removeEventListener('pagehide', sair)
      sair()
      liderRef.current = false
      setLider(false)
    }
  }, [ativo, aba])

  /* Fazendas: só a líder busca (as outras recebem pelo estado). Falhou? Fica
     a última lista guardada. Recarrega de hora em hora — cadastro novo entra
     sem F5. */
  useEffect(() => {
    if (!ativo || !lider) return
    let vivo = true
    const carregar = () => {
      carregarFazendas()
        .then((fazendas) => {
          if (vivo) publicarEstado({ ...estadoRef.current, fazendas })
        })
        .catch(() => {
          /* Supabase fora: segue com a última lista */
        })
    }
    carregar()
    const t = window.setInterval(carregar, RECARGA_FAZENDAS_MS)
    return () => {
      vivo = false
      window.clearInterval(t)
    }
  }, [ativo, lider, carregarFazendas, publicarEstado])

  /* Laço do ciclo: roda já e reagenda para 2 min depois do próximo passo de
     10 min (ou 5 min depois de uma falha), mais o jitter. Reinicia quando os
     quadrados mudam. */
  const chaveCelulas = celulasDasFazendas(estado.fazendas).map((c) => c.id).join('|')
  useEffect(() => {
    if (!ativo || !lider || !chaveCelulas) return
    let vivo = true
    let timer = 0
    const rodar = async () => {
      // Falha inesperada (cache corrompido, erro no juízo) não pode matar o
      // vigia: registra e tenta de novo como numa falha da Trimble.
      let espera = ESPERA_APOS_FALHA_MS
      try {
        const proximo = await ciclo()
        espera = proximo?.erro ? ESPERA_APOS_FALHA_MS : msAteProximoCiclo(Date.now())
      } catch (e) {
        console.error('[locks-sat] ciclo do vigia falhou; nova tentativa em 5 min', e)
        // E aparece: sem isto o selo seguiria "ATUALIZADO" com o vigia parado.
        if (vivo) {
          publicarEstado({ ...estadoRef.current, erro: 'rede', falhasSeguidas: estadoRef.current.falhasSeguidas + 1 })
        }
      }
      if (!vivo) return
      agendar(espera)
    }
    const agendar = (espera: number) => {
      timer = window.setTimeout(() => void rodar(), comJitter(espera))
    }
    // Só na largada: com dado fresco de TODOS os quadrados (F5, outra aba que
    // passou a liderança), espera o próximo passo em vez de consultar de novo.
    // Quadrado novo, ainda sem dado, consulta já.
    const guardado = estadoRef.current
    const fresco =
      guardado.ultimoSucesso != null &&
      Date.now() - guardado.ultimoSucesso < DADO_FRESCO_MS &&
      celulasDasFazendas(guardado.fazendas).every((c) => guardado.celulas[c.id])
    if (fresco) agendar(msAteProximoCiclo(Date.now()))
    else void rodar()
    return () => {
      vivo = false
      window.clearTimeout(timer)
    }
  }, [ativo, lider, chaveCelulas, ciclo, publicarEstado])

  /* Outras abas: estado e alertas chegam pelo evento `storage`. */
  useEffect(() => {
    if (!ativo) return
    const aoMudar = (e: StorageEvent) => {
      if (e.key === CHAVE_ESTADO) {
        const s = lerEstado()
        estadoRef.current = s
        setEstado(s)
        if (s.falhasSeguidas === FALHAS_PARA_SEM_DADOS) anunciar([avisoSemDados(s, Date.now())], false)
      } else if (e.key === CHAVE_ALERTAS) {
        const lista = lerAlertas()
        setAlertas(lista)
        const agora = Date.now()
        anunciar(lista.filter((a) => agora - a.instante < JANELA_TOAST_SEGUIDORA_MS), false)
      }
    }
    window.addEventListener('storage', aoMudar)
    return () => window.removeEventListener('storage', aoMudar)
  }, [ativo, anunciar])

  /* A linha de estado do card do COA WEB acompanha o estado do vigia. */
  useEffect(() => {
    if (ativo) avisarResumo(resumoDoVigia(estado, Date.now()))
  }, [ativo, estado])

  const atualizar = useCallback(() => {
    // Ciclo rodando ou começado há menos de 1 min: o dado é o mesmo, e cada
    // clique seriam mais chamadas na conta da rajada da Trimble.
    if (rodando.current || Date.now() - inicioUltimoCiclo.current < INTERVALO_MINIMO_ATUALIZAR_MS) return
    ciclo().catch((e: unknown) => console.error('[locks-sat] atualização manual falhou', e))
  }, [ciclo])
  const fecharAviso = useCallback((id: string) => setAvisos((l) => l.filter((a) => a.id !== id)), [])

  const valor = useMemo<ValorVigia>(
    () => ({ ativo, estado, alertas, lider, atualizar }),
    [ativo, estado, alertas, lider, atualizar],
  )

  return (
    <VigiaContexto.Provider value={valor}>
      {children}
      {ativo && !dentroDoCoa() && <AvisosGnss avisos={avisos} aoFechar={fecharAviso} />}
    </VigiaContexto.Provider>
  )
}
