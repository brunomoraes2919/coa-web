import type { ReactNode } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { usePerfil } from './usePerfil';

interface Props {
  modo: 'local' | 'supabase';
  /** build do COA WEB (Supabase fixo): link "← COA WEB" e sem Configurações */
  fixo: boolean;
  /** dentro do iframe do COA WEB: sem cabeçalho nem navegação (o menu é o do COA WEB) */
  embed: boolean;
  /** e-mail do usuário logado (modo Supabase) */
  email: string | null;
  /** sem ele (modo fixo: a sessão é do COA WEB), não há botão "Sair" */
  onSair?: () => void;
}

interface ItemNav {
  para: string;
  texto: string;
  icone: ReactNode;
  ativo(caminho: string): boolean;
  /** cadastro: só para admin */
  admin?: true;
  /** tela de configuração: não existe no modo fixo */
  config?: true;
}

const svg = (conteudo: ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {conteudo}
  </svg>
);

const ITENS: ItemNav[] = [
  {
    para: '/mapas',
    texto: 'Mapas',
    icone: svg(
      <>
        <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
        <line x1="8" y1="2" x2="8" y2="18" />
        <line x1="16" y1="6" x2="16" y2="22" />
      </>,
    ),
    ativo: (c) => c === '/mapas' || (c.startsWith('/mapas/') && c !== '/mapas/novo'),
  },
  {
    para: '/mapas/novo',
    texto: 'Novo mapa',
    icone: svg(
      <>
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="16" />
        <line x1="8" y1="12" x2="16" y2="12" />
      </>,
    ),
    ativo: (c) => c === '/mapas/novo',
  },
  {
    para: '/fazendas',
    texto: 'Fazendas',
    icone: svg(
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
      </>,
    ),
    ativo: (c) => c.startsWith('/fazendas'),
    admin: true,
  },
  {
    para: '/safras',
    texto: 'Safras',
    icone: svg(
      <>
        <path d="M12 22V11" />
        <path d="M12 11C12 6.5 8.5 3.5 3.5 3.5c0 4.5 3.5 7.5 8.5 7.5z" />
        <path d="M12 14c0-4 3-7 8.5-7 0 4-3.5 7-8.5 7z" />
      </>,
    ),
    ativo: (c) => c.startsWith('/safras'),
    admin: true,
  },
  {
    para: '/config',
    texto: 'Configurações',
    icone: svg(
      <>
        <line x1="4" y1="21" x2="4" y2="14" />
        <line x1="4" y1="10" x2="4" y2="3" />
        <line x1="12" y1="21" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12" y2="3" />
        <line x1="20" y1="21" x2="20" y2="16" />
        <line x1="20" y1="12" x2="20" y2="3" />
        <line x1="1" y1="14" x2="7" y2="14" />
        <line x1="9" y1="8" x2="15" y2="8" />
        <line x1="17" y1="16" x2="23" y2="16" />
      </>,
    ),
    ativo: (c) => c.startsWith('/config'),
    config: true,
  },
];

const ICONE_SAIR = svg(
  <>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </>,
);

export default function Shell({ modo, fixo, embed, email, onSair }: Props) {
  const { pathname } = useLocation();
  const perfil = usePerfil();

  if (embed) {
    return (
      <div className="app app-embed">
        <main className="conteudo">
          <Outlet />
        </main>
      </div>
    );
  }

  // enquanto o perfil carrega, os cadastros ficam escondidos (evita mostrar e sumir)
  const itens = ITENS.filter((i) => !(i.admin && perfil !== 'admin') && !(i.config && fixo));

  return (
    <div className="app">
      <aside className="lateral">
        <Link to="/mapas" className="lateral-logo" title="Mapa de Chuva COA">
          <img src="./logo-coa.png" alt="COA — Centro de Operações Agrícolas" />
        </Link>
        {fixo && (
          <a href="../index.html" className="lateral-voltar" title="Voltar ao COA WEB">
            ← COA WEB
          </a>
        )}
        <nav className="lateral-nav" aria-label="Navegação principal">
          {itens.map((item) => {
            const ativo = item.ativo(pathname);
            return (
              <Link
                key={item.para}
                to={item.para}
                className={ativo ? 'nav-item ativo' : 'nav-item'}
                aria-current={ativo ? 'page' : undefined}
                title={item.texto}
              >
                {item.icone}
                <span className="nav-texto">{item.texto}</span>
              </Link>
            );
          })}
        </nav>
        <div className="lateral-rodape">
          {modo === 'local' ? (
            <span className="modo-selo" title="Os dados ficam salvos neste navegador">
              Modo local
            </span>
          ) : (
            <>
              <span className="modo-selo supabase">Supabase</span>
              {email && <div className="lateral-email">{email}</div>}
              {email && onSair && (
                <button type="button" className="lateral-sair" onClick={onSair}>
                  {ICONE_SAIR}
                  Sair
                </button>
              )}
            </>
          )}
        </div>
      </aside>
      <main className="conteudo">
        <Outlet />
      </main>
    </div>
  );
}
