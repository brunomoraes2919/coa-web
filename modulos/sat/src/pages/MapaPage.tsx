/**
 * Mapa da ionosfera na paleta do módulo: a imagem da Trimble (um tile Web Mercator de zoom 0
 * do mundo) vira uma camada em grade recolorida sobre o fundo escolhido; as fazendas aparecem
 * como bolinha (de longe) ou pelo contorno dos talhões (de perto), na cor da cintilação do
 * horário. Abre ao vivo (hoje, seguindo o passo mais novo, com um laço das últimas 3 h no play);
 * dá para ver hoje à mão e voltar até 30 dias.
 */
import L from 'leaflet'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CircleMarker, GeoJSON, MapContainer, Popup, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import AjudaGnss from '../componentes/AjudaGnss'
import BarraHorario from '../componentes/BarraHorario'
import GuiaRtk from '../componentes/GuiaRtk'
import LegendaGnss from '../componentes/LegendaGnss'
import SeletorDia, { type ModoDia } from '../componentes/SeletorDia'
import { celulasDasFazendas } from '../fazendasGnss'
import { useVisivel } from '../lib/useVisivel'
import type { LimiteFazenda } from '../logic/limites'
import { COR_NIVEL, nivelCintilacao, ROTULO_NIVEL } from '../logic/niveis'
import {
  diaDentroDoMapa,
  inicioDaJanelaAoVivo,
  passosDoDia,
  passosDoDiaPassado,
  PAUSA_NO_ULTIMO_MS,
  proximoPassoAoVivo,
} from '../logic/passosMapa'
import { dataCurta, horaDe } from '../logic/tempo'
import CamadaIonosfera from '../mapa/CamadaIonosfera'
import ControleFundo from '../mapa/ControleFundo'
import { FUNDOS, gravarFundo, lerFundo, type ChaveFundo } from '../mapa/fundos'
import { precarregarIonosfera } from '../mapa/imagemIonosfera'
import { guardarMemoriaDoMapa, lerMemoriaDoMapa, type MemoriaDoMapa } from '../mapa/memoriaDoMapa'
import TileLayerEsri from '../mapa/TileLayerEsri'
import { useLimitesFazendas } from '../mapa/useLimitesFazendas'
import { useSerieDoDia } from '../mapa/useSerieDoDia'
import type { FazendaGnss, PontoIono } from '../tipos'
import { useVigiaGnss } from '../vigia/vigiaContexto'

type Camada = MemoriaDoMapa['camada']

const CAMADAS: { id: Camada; rotulo: string }[] = [
  { id: 'off', rotulo: 'Off' },
  { id: 'tec', rotulo: 'TEC' },
  { id: 'sci', rotulo: 'Cintilação' },
]
/** Um passo por segundo (no laço do ao vivo também): dá tempo de a imagem chegar e segura o ritmo dos pedidos. */
const INTERVALO_PLAY_MS = 1000
const PRECARREGAR = 3
/** Arrastar a barra passa por dezenas de passos: só pede a imagem do horário em que ela parou. */
const ESPERA_IMAGEM_MS = 250
const ZOOM_INICIAL = 5
/** A camada em grade não tem teto: o limite é enxergar o talhão. */
const ZOOM_MAXIMO = 17
/** Daqui para perto a fazenda aparece pelo contorno dos talhões; antes, pela bolinha. */
const ZOOM_CONTORNO = 9
const ATRIBUICAO = 'Tiles &copy; Esri · Ionosfera &copy; Trimble GNSS Planning'

interface PropsFazenda {
  fazenda: FazendaGnss
  ponto: PontoIono | null
  passo: number
  comData: boolean
  carregando: boolean
  limite: LimiteFazenda | undefined
  contorno: boolean
}

function TextoDoPopup({ fazenda, ponto, passo, comData, carregando }: PropsFazenda) {
  const nivel = nivelCintilacao(ponto?.cintilacao)
  return (
    <>
      <strong>{fazenda.nome}</strong> · {comData ? `${dataCurta(passo)} · ` : ''}{horaDe(passo)}
      <br />
      {carregando ? (
        'Carregando…'
      ) : (
        <>
          Cintilação: {ponto?.cintilacao != null ? `${Math.round(ponto.cintilacao)} de 100 (${ROTULO_NIVEL[nivel]})` : 'sem dado'}
          <br />
          Índice: {ponto ? ponto.indice : '—'} · TEC: {ponto ? `${ponto.tec.toFixed(1)} TECU` : '—'}
        </>
      )}
    </>
  )
}

function FazendaNoMapa(props: PropsFazenda) {
  const { fazenda, ponto, carregando, limite, contorno } = props
  if (fazenda.lat == null || fazenda.lon == null) return null
  const cor = COR_NIVEL[carregando ? 'sem-dado' : nivelCintilacao(ponto?.cintilacao)]
  const popup = (
    <Popup>
      <TextoDoPopup {...props} />
    </Popup>
  )
  if (contorno && limite?.features.length) {
    return (
      // Sem `key` com a cor: o react-leaflet já aplica o estilo novo (`setStyle`) quando a prop muda,
      // e refazer o contorno fecharia o popup aberto.
      <GeoJSON data={limite} style={{ color: cor, weight: 2, fillColor: cor, fillOpacity: 0.15 }}>
        {popup}
      </GeoJSON>
    )
  }
  return (
    <CircleMarker
      center={[fazenda.lat, fazenda.lon]}
      radius={8}
      pathOptions={{ color: '#1b201e', weight: 1.5, fillColor: cor, fillOpacity: 0.95 }}
    >
      {popup}
    </CircleMarker>
  )
}

/** Enquadra as fazendas UMA vez, quando elas chegam. */
function EnquadrarFazendas({ limites }: { limites: L.LatLngBounds | undefined }) {
  const mapa = useMap()
  const feito = useRef(false)
  useEffect(() => {
    if (feito.current || !limites) return
    feito.current = true
    mapa.fitBounds(limites, { padding: [24, 24], maxZoom: 8 })
  }, [mapa, limites])
  return null
}

function AcompanharZoom({ aoMudar }: { aoMudar: (zoom: number) => void }) {
  const mapa = useMapEvents({ zoomend: () => aoMudar(mapa.getZoom()) })
  return null
}

/** O iframe some e volta (outra categoria do COA WEB): o Leaflet precisa refazer o tamanho. */
function RefazerTamanho() {
  const mapa = useMap()
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return
    const observador = new ResizeObserver(() => mapa.invalidateSize())
    observador.observe(mapa.getContainer())
    return () => observador.disconnect()
  }, [mapa])
  return null
}

export default function MapaPage() {
  const { estado } = useVigiaGnss()
  const visivel = useVisivel()
  /** A vista de antes (a tela desmonta ao trocar de rota); o dia que saiu da janela de 30 dias volta ao vivo. */
  const [inicio] = useState(() => {
    const agora = Date.now()
    const lembrada = lerMemoriaDoMapa()
    const dia = diaDentroDoMapa(lembrada.dia, agora)
    const aoVivo = lembrada.dia != null ? dia == null : lembrada.aoVivo
    return { agora, camada: lembrada.camada, dia, aoVivo, escolhido: aoVivo || dia !== lembrada.dia ? null : lembrada.escolhido }
  })
  const [camada, setCamada] = useState<Camada>(inicio.camada)
  const [fundo, setFundo] = useState<ChaveFundo>(() => lerFundo())
  const [zoom, setZoom] = useState(ZOOM_INICIAL)
  /** `null` = hoje; senão, 00:00 local do dia passado escolhido. */
  const [dia, setDia] = useState<number | null>(inicio.dia)
  /** Hoje seguindo o passo mais novo; só com `dia` nulo. */
  const [aoVivo, setAoVivo] = useState(inicio.aoVivo)
  const [agora, setAgora] = useState(inicio.agora)
  useEffect(() => {
    const t = window.setInterval(() => setAgora(Date.now()), 60_000)
    return () => window.clearInterval(t)
  }, [])

  const passos = useMemo(() => (dia == null ? passosDoDia(agora) : passosDoDiaPassado(dia)), [dia, agora])
  /** Passo escolhido à mão (ou onde o laço está); `null` = o último. */
  const [escolhido, setEscolhido] = useState<number | null>(inicio.escolhido)
  const [tocando, setTocando] = useState(false)
  const ultimo = passos.length - 1
  // Ao vivo parado acompanha o passo mais novo; só o laço (play) anda por `escolhido`.
  const indice = (aoVivo && !tocando) || escolhido == null ? ultimo : Math.min(escolhido, ultimo)
  const passo = passos[indice]
  /** O passo da imagem com a barra: segue `passo` 250 ms depois de ela parar. */
  const [passoImagem, setPassoImagem] = useState(passo)
  /** Falhas por camada + passo: a de uma camada não marca a outra, e some quando a imagem carrega. */
  const [falhas, setFalhas] = useState<ReadonlySet<string>>(() => new Set())

  useEffect(() => {
    const t = window.setTimeout(() => setPassoImagem(passo), ESPERA_IMAGEM_MS)
    return () => window.clearTimeout(t)
  }, [passo])
  /** No play, sem espera: cada passo já fica 1 s na tela. */
  const passoOverlay = tocando ? passo : passoImagem

  // Escondido (outra categoria do COA WEB) o play para: ninguém está vendo, e cada passo é um pedido.
  const tocandoDeFato = tocando && visivel
  useEffect(() => {
    if (!tocandoDeFato || aoVivo) return
    const t = window.setInterval(() => {
      setEscolhido((v) => {
        const i = v ?? passos.length - 1
        return i >= passos.length - 1 ? 0 : i + 1
      })
    }, INTERVALO_PLAY_MS)
    return () => window.clearInterval(t)
  }, [tocandoDeFato, aoVivo, passos.length])

  /* Ao vivo, o play é um laço das últimas 3 h: um passo por segundo até o mais novo, onde segura
     alguns segundos antes de recomeçar. Cada passo reagenda o próximo, e a janela desliza sozinha
     quando sai um passo novo. */
  useEffect(() => {
    if (!tocandoDeFato || !aoVivo) return
    const { indice: proximo, segurar } = proximoPassoAoVivo(passos.length, indice)
    const t = window.setTimeout(() => setEscolhido(proximo), segurar ? PAUSA_NO_ULTIMO_MS : INTERVALO_PLAY_MS)
    return () => window.clearTimeout(t)
  }, [tocandoDeFato, aoVivo, indice, passos.length])

  // Escondido, o laço ao vivo larga o passo em que estava: ao voltar mostra o mais novo e segue dali.
  useEffect(() => {
    if (aoVivo && tocando && !visivel) setEscolhido(null)
  }, [aoVivo, tocando, visivel])

  /* Pré-carrega os passos seguintes ao horário PARADO: dar play dali não pisca. Durante o
     play, não — cada passo já pede a sua imagem. */
  useEffect(() => {
    if (camada === 'off' || tocando) return
    const i = passos.indexOf(passoOverlay)
    if (i < 0) return
    for (const p of passos.slice(i + 1, i + 1 + PRECARREGAR)) precarregarIonosfera(camada, p)
  }, [camada, tocando, passoOverlay, passos])

  const celulas = useMemo(() => celulasDasFazendas(estado.fazendas), [estado.fazendas])
  const serieDoDia = useSerieDoDia(dia, celulas)
  const limites = useLimitesFazendas()

  const limitesFazendas = useMemo(() => {
    const pontos = estado.fazendas.flatMap((f) =>
      f.lat != null && f.lon != null ? [[f.lat, f.lon] as [number, number]] : [])
    return pontos.length ? L.latLngBounds(pontos).pad(0.8) : undefined
  }, [estado.fazendas])

  const trocarFundo = (c: ChaveFundo) => {
    setFundo(c)
    gravarFundo(c)
  }
  const escolherCamada = (c: Camada) => {
    setCamada(c)
    guardarMemoriaDoMapa({ camada: c })
  }
  /** Mexer na barra tira do ao vivo: vira Hoje, no passo escolhido. */
  const escolherPasso = (i: number) => {
    setTocando(false)
    setAoVivo(false)
    setEscolhido(i)
    guardarMemoriaDoMapa({ escolhido: i, aoVivo: false })
  }
  const trocarModo = (modo: ModoDia) => {
    setTocando(false)
    if (modo === 'ao-vivo') {
      setDia(null)
      setAoVivo(true)
      setEscolhido(null)
      guardarMemoriaDoMapa({ dia: null, aoVivo: true, escolhido: null })
    } else if (modo === 'hoje') {
      // De ao vivo (ou de um dia passado) fica no passo que está na tela; de um dia passado, no mais novo de hoje.
      const passoHoje = dia == null ? indice : passosDoDia(agora).length - 1
      setDia(null)
      setAoVivo(false)
      setEscolhido(passoHoje)
      guardarMemoriaDoMapa({ dia: null, aoVivo: false, escolhido: passoHoje })
    } else {
      // Dia passado abre em 00:00.
      setDia(modo)
      setAoVivo(false)
      setEscolhido(0)
      guardarMemoriaDoMapa({ dia: modo, aoVivo: false, escolhido: 0 })
    }
  }
  const alternarPlay = () => {
    if (!tocando) {
      // O laço do ao vivo começa 3 h atrás; os outros seguem de onde estão.
      if (aoVivo) setEscolhido(inicioDaJanelaAoVivo(passos.length))
      setTocando(true)
      return
    }
    // Pausar congela a imagem no passo do play — sem voltar ao anterior enquanto a espera da barra
    // não venceu. Ao vivo, pausar no passo mais novo segue ao vivo; em outro passo vira Hoje nele.
    setPassoImagem(passo)
    setTocando(false)
    if (aoVivo && indice === ultimo) {
      setEscolhido(null)
    } else if (aoVivo) {
      setAoVivo(false)
      setEscolhido(indice)
      guardarMemoriaDoMapa({ aoVivo: false, escolhido: indice })
    } else {
      guardarMemoriaDoMapa({ escolhido: indice })
    }
  }
  const serieDa = (f: FazendaGnss): PontoIono[] | undefined => {
    if (!f.celulaId) return undefined
    return dia == null ? estado.celulas[f.celulaId]?.serie : serieDoDia.series[f.celulaId]
  }
  const chaveFalha = `${camada}:${passoOverlay}`
  const fundoAtual = FUNDOS[fundo]

  return (
    <div className="gnss-pagina">
      <header className="gnss-cabecalho">
        <div>
          <span className="gnss-sobre">Locks SAT</span>
          <h1>Mapa da ionosfera</h1>
          <p>
            Imagem da Trimble a cada 10 min, nas cores das fazendas: amarelo é cintilação média, vermelho é
            forte e a mínima fica sem cor. De perto, a fazenda aparece pelo contorno dos talhões.
          </p>
        </div>
        <div className="gnss-acoes">
          <div className="gnss-camadas" role="group" aria-label="Camada do mapa">
            {CAMADAS.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`gnss-chip${camada === c.id ? ' ativo' : ''}`}
                aria-pressed={camada === c.id}
                onClick={() => escolherCamada(c.id)}
              >
                {c.rotulo}
              </button>
            ))}
            <AjudaGnss tema={camada === 'tec' ? 'tec' : 'cintilacao'} />
          </div>
          <GuiaRtk />
        </div>
      </header>

      <div className="gnss-mapa-caixa">
        <MapContainer
          className="gnss-mapa"
          center={[-14, -56]}
          zoom={ZOOM_INICIAL}
          minZoom={2}
          maxZoom={ZOOM_MAXIMO}
          scrollWheelZoom
          preferCanvas
        >
          <EnquadrarFazendas limites={limitesFazendas} />
          <AcompanharZoom aoMudar={setZoom} />
          <RefazerTamanho />
          <TileLayerEsri url={fundoAtual.url} maxZoom={19} maxNativeZoom={fundoAtual.maxNativeZoom} noWrap zIndex={1} attribution={ATRIBUICAO} />
          {fundoAtual.rotulos && <TileLayerEsri url={fundoAtual.rotulos} maxZoom={19} noWrap zIndex={3} opacity={0.9} />}
          {camada !== 'off' && (
            <CamadaIonosfera
              camada={camada}
              instante={passoOverlay}
              atenuada={zoom >= ZOOM_CONTORNO}
              aoFalhar={() => setFalhas((s) => new Set(s).add(chaveFalha))}
              aoCarregar={() =>
                setFalhas((s) => {
                  if (!s.has(chaveFalha)) return s
                  const resto = new Set(s)
                  resto.delete(chaveFalha)
                  return resto
                })
              }
            />
          )}
          {estado.fazendas.map((f) => (
            <FazendaNoMapa
              key={f.id}
              fazenda={f}
              passo={passo}
              comData={dia != null}
              carregando={dia != null && serieDoDia.carregando && !serieDoDia.series[f.celulaId ?? '']}
              ponto={serieDa(f)?.find((p) => p.instante === passo) ?? null}
              limite={limites[f.id]}
              contorno={zoom >= ZOOM_CONTORNO}
            />
          ))}
        </MapContainer>
        {camada !== 'off' && <LegendaGnss camada={camada} />}
        <ControleFundo valor={fundo} aoMudar={trocarFundo} />
        {dia != null && serieDoDia.erro && (
          <div className="gnss-mapa-aviso" role="status">
            Sem dados da Trimble para {dataCurta(dia)}.
          </div>
        )}
      </div>

      <div className="gnss-controles-tempo">
        <SeletorDia modo={aoVivo ? 'ao-vivo' : (dia ?? 'hoje')} agora={agora} aoMudar={trocarModo} />
        <BarraHorario
          passos={passos}
          indice={indice}
          tocando={tocando}
          comData={dia != null}
          aoVivo={aoVivo}
          indisponivel={camada !== 'off' && falhas.has(`${camada}:${passo}`)}
          aoMudar={escolherPasso}
          aoAlternar={alternarPlay}
        />
      </div>
    </div>
  )
}
