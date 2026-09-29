import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import { HashRouter, Link, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { lerConfig } from './data/config';
import { onAuthChange, sair, sessaoAtual } from './data/auth';
import Shell from './components/Shell';
import Carregando from './components/Carregando';
import Aviso, { mensagemDeErro, type TipoAviso } from './components/Aviso';
import { repo } from './data';
import { carregarSeed, seedJaCarregado } from './lib/seed';
import Configuracoes from './pages/Configuracoes';
import Login from './pages/Login';

// Telas carregadas sob demanda (o mapa Leaflet, o leitor de shapes e o editor ficam fora do pacote inicial)
const Mapas = lazy(() => import('./pages/Mapas'));
const NovoMapa = lazy(() => import('./pages/NovoMapa'));
const Fazendas = lazy(() => import('./pages/Fazendas'));
const FazendaNova = lazy(() => import('./pages/FazendaNova'));
const FazendaEditar = lazy(() => import('./pages/FazendaEditar'));
const Safras = lazy(() => import('./pages/Safras'));
const Plantio = lazy(() => import('./pages/Plantio'));
const AreasCultura = lazy(() => import('./pages/AreasCultura'));

type AvisoSeed = { tipo: TipoAviso; texto: string; configuracoes?: true } | null;
let seedInicial: Promise<AvisoSeed> | null = null;

/**
 * Modo local, primeira abertura (nenhuma fazenda e nenhuma vinculada ao PIMS): carrega o cadastro
 * padrão do COA. Uma vez por página (o StrictMode roda os efeitos duas vezes). O download tem tempo
 * limite (carregarSeed); a falha vira aviso com o caminho para tentar de novo em Configurações.
 */
function garantirSeedInicial(): Promise<AvisoSeed> {
  seedInicial ??= (async (): Promise<AvisoSeed> => {
    try {
      const r = repo();
      if ((await r.listarFazendas()).length > 0 || (await seedJaCarregado(r))) return null;
      const res = await carregarSeed(r);
      return { tipo: 'sucesso', texto: `Cadastro padrão do COA carregado (${res.fazendas} unidades, safra SOJA 26/27)` };
    } catch (e) {
      return { tipo: 'erro', texto: `Não foi possível carregar o cadastro padrão do COA: ${mensagemDeErro(e)}`, configuracoes: true };
    }
  })();
  return seedInicial;
}

/** Faixa fixa no topo com o andamento do cadastro padrão (as telas continuam usáveis por baixo). */
function FaixaSeed({ preparando, aviso, onFechar }: { preparando: boolean; aviso: AvisoSeed; onFechar: () => void }) {
  if (!preparando && !aviso) return null;
  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(560px, calc(100% - 24px))',
        zIndex: 2000,
        boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
      }}
    >
      {preparando ? (
        <Aviso tipo="info">Preparando o cadastro padrão do COA (sete unidades e áreas de soja)… As listas se atualizam ao terminar.</Aviso>
      ) : (
        aviso && (
          <Aviso tipo={aviso.tipo} onFechar={onFechar}>
            {aviso.texto}
            {aviso.configuracoes && (
              <>
                {' '}
                <Link to="/config" onClick={onFechar}>
                  Tentar de novo em Configurações
                </Link>
              </>
            )}
          </Aviso>
        )
      )}
    </div>
  );
}

function Tela({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Carregando texto="Abrindo…" />}>{children}</Suspense>;
}

/** No modo Supabase, as rotas internas exigem sessão; sem ela, vai para o login. */
function RequerSessao({ permitido, carregando }: { permitido: boolean; carregando: boolean }) {
  const loc = useLocation();
  if (carregando) return <Carregando texto="Verificando a sessão…" />;
  if (!permitido) return <Navigate to="/login" replace state={{ de: loc.pathname }} />;
  return <Outlet />;
}

export default function App() {
  const [modo] = useState(() => lerConfig().modo);
  const [sessao, setSessao] = useState<Session | null>(null);
  const [carregando, setCarregando] = useState(modo === 'supabase');
  const [erroSessao, setErroSessao] = useState<string | null>(null);
  const [preparandoSeed, setPreparandoSeed] = useState(modo === 'local');
  const [avisoSeed, setAvisoSeed] = useState<AvisoSeed>(null);
  /** muda quando o cadastro padrão termina de carregar: remonta a tela aberta para ela reler os dados */
  const [versaoDados, setVersaoDados] = useState(0);

  useEffect(() => {
    if (modo !== 'local') return;
    let ativo = true;
    garantirSeedInicial().then((a) => {
      if (!ativo) return;
      setAvisoSeed(a);
      setPreparandoSeed(false);
      if (a?.tipo === 'sucesso') setVersaoDados((v) => v + 1);
    });
    return () => {
      ativo = false;
    };
  }, [modo]);

  useEffect(() => {
    if (modo !== 'supabase') return;
    let ativo = true;
    sessaoAtual()
      .then((s) => {
        if (ativo) setSessao(s);
      })
      .catch((e: unknown) => {
        if (ativo) setErroSessao(`Não foi possível verificar a sessão: ${mensagemDeErro(e)}`);
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });
    let cancelar: (() => void) | null = null;
    try {
      cancelar = onAuthChange((s) => {
        if (ativo) setSessao(s);
      });
    } catch (e) {
      setErroSessao(mensagemDeErro(e));
    }
    return () => {
      ativo = false;
      cancelar?.();
    };
  }, [modo]);

  const aoEntrar = useCallback(async () => {
    setErroSessao(null);
    setSessao(await sessaoAtual());
  }, []);

  const aoSair = useCallback(() => {
    sair()
      .catch(() => undefined)
      .finally(() => setSessao(null));
  }, []);

  const permitido = modo === 'local' || sessao !== null;

  return (
    <HashRouter>
      <FaixaSeed preparando={preparandoSeed} aviso={avisoSeed} onFechar={() => setAvisoSeed(null)} />
      <Routes key={versaoDados}>
        <Route
          path="/login"
          element={<Login modo={modo} logado={sessao !== null} erroInicial={erroSessao} onEntrou={aoEntrar} />}
        />
        <Route element={<Shell modo={modo} email={sessao?.user.email ?? null} onSair={aoSair} />}>
          <Route path="/config" element={<Configuracoes acessoDados={permitido} />} />
          <Route element={<RequerSessao permitido={permitido} carregando={carregando} />}>
            <Route path="/" element={<Navigate to="/mapas" replace />} />
            <Route path="/mapas" element={<Tela><Mapas /></Tela>} />
            <Route path="/mapas/novo" element={<Tela><NovoMapa key="novo" /></Tela>} />
            <Route path="/mapas/:id" element={<Tela><NovoMapa key="salvo" /></Tela>} />
            <Route path="/fazendas" element={<Tela><Fazendas /></Tela>} />
            <Route path="/fazendas/nova" element={<Tela><FazendaNova /></Tela>} />
            <Route path="/fazendas/:id" element={<Tela><FazendaEditar /></Tela>} />
            <Route path="/safras" element={<Tela><Safras /></Tela>} />
            <Route path="/safras/:safraId/plantio/:fazendaId" element={<Tela><Plantio /></Tela>} />
            <Route path="/safras/:safraId/areas/:fazendaId" element={<Tela><AreasCultura /></Tela>} />
            <Route path="*" element={<Navigate to="/mapas" replace />} />
          </Route>
        </Route>
      </Routes>
    </HashRouter>
  );
}
