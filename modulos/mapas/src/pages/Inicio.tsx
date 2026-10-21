import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { repo } from '../data';
import { usePerfil } from '../components/usePerfil';
import { resumoHistorico, textoHistorico, textoVariedades } from '../lib/inicio';
import type { MapaSalvo, VariedadePims } from '../lib/types';

/** Ícones de traço, os mesmos do menu do COA WEB. */
const icone = (conteudo: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {conteudo}
  </svg>
);
const ICONES = {
  novo: icone(
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M12 8v8M8 12h8" />
    </>,
  ),
  salvos: icone(
    <>
      <path d="M9 4 3 6.5V20l6-2.5 6 2.5 6-2.5V4l-6 2.5L9 4Z" />
      <path d="M9 4v13.5M15 6.5V20" />
    </>,
  ),
  fazenda: icone(<path d="M12 3 21 9.5 17.5 20h-11L3 9.5Z" />),
  safra: icone(
    <>
      <path d="M12 21v-9" />
      <path d="M12 12C12 8 9 6 5 6c0 4 3 6 7 6Z" />
      <path d="M12 12c0-4 3-7 7-7 0 4-3 7-7 7Z" />
    </>,
  ),
  cores: icone(
    <>
      <circle cx="13.5" cy="6.5" r="1.5" />
      <circle cx="17.5" cy="10.5" r="1.5" />
      <circle cx="8.5" cy="7.5" r="1.5" />
      <path d="M12 2a10 10 0 0 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.4A5.6 5.6 0 0 0 22 10c0-4.4-4.5-8-10-8Z" />
    </>,
  ),
  etiqueta: icone(
    <>
      <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" />
      <circle cx="7.5" cy="7.5" r="1.5" />
    </>,
  ),
};

interface Card {
  para: string;
  titulo: string;
  texto: string;
  icone: ReactNode;
  /** linha de rodapé (contagem, situação); null = sem rodapé; undefined = lendo */
  rodape?: string | null;
}

function CardPagina({ c }: { c: Card }) {
  return (
    <Link to={c.para} className="inicio-card">
      <span className="inicio-card-icone">{c.icone}</span>
      <span className="inicio-card-corpo">
        <span className="inicio-card-titulo">{c.titulo}</span>
        <span className="inicio-card-texto">{c.texto}</span>
        {c.rodape !== null ? <span className="inicio-card-rodape">{c.rodape ?? ' '}</span> : null}
      </span>
      <svg className="inicio-card-seta" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m9 6 6 6-6 6" />
      </svg>
    </Link>
  );
}

function Grupo({ titulo, cards }: { titulo: string; cards: Card[] }) {
  return (
    <section className="inicio-grupo" aria-label={titulo}>
      <h2 className="inicio-grupo-titulo">{titulo}</h2>
      <div className="inicio-grade">
        {cards.map((c) => (
          <CardPagina key={c.para} c={c} />
        ))}
      </div>
    </section>
  );
}

/** Tela inicial do módulo: um card por página, agrupados como no menu, com a contagem do que já existe. */
export default function Inicio() {
  const admin = usePerfil() === 'admin';
  const [mapas, setMapas] = useState<MapaSalvo[] | null>(null);
  const [variedades, setVariedades] = useState<VariedadePims[] | null>(null);

  useEffect(() => {
    let ativo = true;
    repo()
      .listarMapas()
      .then((l) => ativo && setMapas(l))
      .catch(() => ativo && setMapas([]));
    return () => {
      ativo = false;
    };
  }, []);
  useEffect(() => {
    if (!admin) return;
    let ativo = true;
    repo()
      .listarVariedadesPims()
      .then((l) => ativo && setVariedades(l))
      .catch(() => ativo && setVariedades([]));
    return () => {
      ativo = false;
    };
  }, [admin]);

  const historico = (tipo: 'chuva' | 'variedade') => (mapas ? textoHistorico(resumoHistorico(mapas, tipo)) : undefined);

  const chuva: Card[] = [
    {
      para: '/mapas/novo',
      titulo: 'Novo mapa de chuva',
      texto: 'Chuva acumulada no período, interpolada dos pluviômetros da ZEUS sobre os talhões, com a situação do plantio.',
      icone: ICONES.novo,
      rodape: null,
    },
    {
      para: '/mapas',
      titulo: 'Mapas de chuva salvos',
      texto: 'Abrir, atualizar, baixar a imagem ou salvar uma cópia dos mapas de chuva já gerados.',
      icone: ICONES.salvos,
      rodape: historico('chuva'),
    },
  ];
  const variedade: Card[] = [
    {
      para: '/variedades/novo',
      titulo: 'Novo mapa de variedade',
      texto: 'Talhões pela variedade plantada no PIMS, com área, nome comercial, sementes por metro e população.',
      icone: ICONES.novo,
      rodape: null,
    },
    {
      para: '/variedades',
      titulo: 'Mapas de variedade salvos',
      texto: 'Abrir, baixar a imagem ou salvar uma cópia dos mapas de variedade já gerados.',
      icone: ICONES.salvos,
      rodape: historico('variedade'),
    },
  ];
  const cadastros: Card[] = [
    {
      para: '/fazendas',
      titulo: 'Fazendas e shapes',
      texto: 'Limites dos talhões de cada fazenda e o vínculo com a unidade do PIMS.',
      icone: ICONES.fazenda,
      rodape: null,
    },
    {
      para: '/safras',
      titulo: 'Safras e plantio',
      texto: 'Safras, áreas da cultura de cada fazenda e o plantio talhão a talhão.',
      icone: ICONES.safra,
      rodape: null,
    },
    {
      para: '/variedades/cores',
      titulo: 'Cores das variedades',
      texto: 'A cor fixa de cada variedade, a mesma em todos os mapas.',
      icone: ICONES.cores,
      rodape: null,
    },
    {
      para: '/variedades/nomes',
      titulo: 'Variedades',
      texto: 'Cadastro de variedades lido do PIMS, com o nome comercial de cada uma.',
      icone: ICONES.etiqueta,
      rodape: variedades ? textoVariedades(variedades) : undefined,
    },
  ];

  return (
    <div className="pagina inicio">
      <div className="pagina-cabecalho">
        <div>
          <h1>Mapas</h1>
          <p className="subtitulo">Mapas das fazendas gerados a partir da ZEUS e do PIMS, e os cadastros que eles usam.</p>
        </div>
      </div>
      <Grupo titulo="Mapa de chuva" cards={chuva} />
      <Grupo titulo="Mapa de variedade" cards={variedade} />
      {admin ? <Grupo titulo="Cadastros" cards={cadastros} /> : null}
    </div>
  );
}
