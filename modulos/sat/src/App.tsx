/**
 * Casca do Locks SAT. Dentro do COA WEB o iframe é carregado depois do login e fica vivo o
 * tempo todo: o vigia roda mesmo escondido, e as telas só montam quando o iframe aparece
 * pela primeira vez.
 */
import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import LimiteDeErro from './componentes/LimiteDeErro'
import Topo from './componentes/Topo'
import { carregarFazendasSat, limparLimitesDaSessao } from './dados/cadastro'
import { garantirDonoDosDados } from './dados/donoDosDados'
import { clienteSupabase } from './dados/supabase'
import { useSessao } from './dados/useSessao'
import { avisarRota } from './lib/embed'
import { useVisivel } from './lib/useVisivel'
import { limparMemoriaDoMapa } from './mapa/memoriaDoMapa'
import VigiaGnssProvider from './vigia/VigiaGnss'

/* As telas só descem quando abrem: o módulo é carregado escondido para todo usuário logo depois do
   login, e o pacote principal fica com a casca e o vigia (o recharts vai com a Hoje; o Leaflet, com o mapa). */
const HojePage = lazy(() => import('./pages/HojePage'))
const MapaPage = lazy(() => import('./pages/MapaPage'))
const AlertasPage = lazy(() => import('./pages/AlertasPage'))

const AVISO_TELA = 'Não foi possível abrir a tela.'
const AVISO_MAPA = 'Não foi possível abrir o mapa.'

/** Uma tela sob demanda: o limite segura a queda (pacote que não baixa, erro ao desenhar) sem derrubar a casca. */
function Tela({ children, aviso = AVISO_TELA }: { children: ReactNode; aviso?: string }) {
  return (
    <LimiteDeErro mensagem={aviso}>
      <Suspense fallback={null}>{children}</Suspense>
    </LimiteDeErro>
  )
}

function AvisarRota() {
  const { pathname } = useLocation()
  useEffect(() => avisarRota(pathname), [pathname])
  return null
}

function EntrePeloCoa() {
  return (
    <p className="sat-recado">
      O Locks SAT abre por dentro do COA WEB. <a href="../index.html" target="_top">Entre pelo COA WEB</a>.
    </p>
  )
}

/** O vigia e as telas de quem está logado. Quem manda no `key` é o App: outro usuário, outro vigia. */
function ComSessao({ usuarioId, abriu }: { usuarioId: string; abriu: boolean }) {
  // Roda uma vez por montagem (e o `key` remonta a cada usuário), antes de qualquer filho: o vigia lê o
  // localStorage no primeiro render, então o que era de outro usuário sai antes dele — do navegador e da memória
  // (contornos e a vista do mapa).
  useState(() => {
    limparLimitesDaSessao()
    limparMemoriaDoMapa()
    garantirDonoDosDados(usuarioId)
    return true
  })

  const carregarFazendas = useCallback(() => {
    const cliente = clienteSupabase()
    if (!cliente) return Promise.resolve([])
    return carregarFazendasSat({ cliente, armazenamento: window.localStorage, agora: Date.now })
  }, [])

  return (
    <HashRouter>
      <VigiaGnssProvider ativo carregarFazendas={carregarFazendas}>
        <AvisarRota />
        <Topo />
        {abriu && (
          <Routes>
            {/* o `key` por rota: sem ele o React reaproveita o mesmo limite entre as rotas e o erro de uma tela ficaria nas outras */}
            <Route path="/hoje" element={<Tela key="hoje"><HojePage /></Tela>} />
            <Route path="/mapa" element={<Tela key="mapa" aviso={AVISO_MAPA}><MapaPage /></Tela>} />
            <Route path="/alertas" element={<Tela key="alertas"><AlertasPage /></Tela>} />
            <Route path="*" element={<Navigate to="/hoje" replace />} />
          </Routes>
        )}
      </VigiaGnssProvider>
    </HashRouter>
  )
}

export default function App() {
  const sessao = useSessao()
  const visivel = useVisivel()
  // Uma vez visível, as telas ficam montadas: voltar de outra categoria mantém o que estava aberto.
  const [abriu, setAbriu] = useState(visivel)
  if (visivel && !abriu) setAbriu(true)

  if (sessao.fase === 'carregando') return null
  if (sessao.fase === 'sem') return <EntrePeloCoa />
  return <ComSessao key={sessao.usuarioId} usuarioId={sessao.usuarioId} abriu={abriu} />
}
