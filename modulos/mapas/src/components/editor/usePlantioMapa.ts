import { useEffect, useMemo, useState } from 'react';
import { repo, type Repositorio } from '../../data';
import { filtrarAreasPorSetor, plantadosSemArea, talhoesParaInterpolacao } from '../../lib/mascaraCultura';
import { casarPlantio, combinarPlantios } from '../../lib/plantioPims';
import { situacaoDoMapa, type SituacaoMapa } from '../../lib/situacaoPlantio';
import type { AreaCultura, Fazenda, Plantio, PlantioPimsTalhao, Safra, Talhao } from '../../lib/types';
import { mensagemDeErro } from '../Aviso';
import { usePlantioPims } from '../usePlantioPims';

const SEM_AREAS: AreaCultura[] = [];

/**
 * Plantio manual e áreas da cultura da safra × fazenda, independentes: se as áreas falharem (ex.:
 * Supabase sem a tabela mapas_areas_cultura, rede, permissão), o plantio manual continua valendo e o
 * erro vem traduzido em `erro`; e vice-versa.
 */
export async function carregarPlantioEAreas(
  r: Pick<Repositorio, 'listarPlantios' | 'listarAreasCultura'>,
  safraId: string,
  fazendaId: string,
): Promise<{ plantios: Plantio[]; areas: AreaCultura[]; erro: string | null }> {
  const [ps, as] = await Promise.allSettled([r.listarPlantios(safraId), r.listarAreasCultura(safraId, fazendaId)]);
  const erros: string[] = [];
  if (ps.status === 'rejected') erros.push(`Não foi possível carregar o plantio: ${mensagemDeErro(ps.reason)}`);
  if (as.status === 'rejected') erros.push(`Não foi possível carregar as áreas da cultura: ${mensagemDeErro(as.reason)}`);
  return {
    plantios: ps.status === 'fulfilled' ? ps.value : [],
    areas: as.status === 'fulfilled' ? as.value : [],
    erro: erros.length ? erros.join(' ') : null,
  };
}

export interface PlantioEditor {
  /** todos os talhões base da fazenda */
  talhoes: Talhao[];
  /** áreas da cultura da safra × fazenda ([] = o mapa pinta os talhões base) */
  areas: AreaCultura[];
  /** plantio efetivo dos talhões base (PIMS prevalece; manual nos talhões sem PIMS) */
  efetivos: Plantio[];
  /** código normalizado → registro do PIMS; null sem plantio do PIMS para a fazenda/safra */
  pims: Map<string, PlantioPimsTalhao> | null;
  /** data/hora do plantio.json quando a fazenda e a safra foram encontradas nele; null = só plantio manual */
  geradoEm: string | null;
  /** plantados/plantando no PIMS sem polígono (nem talhão base nem área da cultura) */
  semPoligono: PlantioPimsTalhao[];
  /** com áreas da cultura: plantados/plantando no PIMS com talhão base mas sem área da cultura */
  semArea: PlantioPimsTalhao[];
  carregando: boolean;
  erro: string | null;
}

/**
 * Talhões da fazenda, áreas da cultura e plantio da safra: o do PIMS (plantio.json, casado pelo
 * código) prevalece; o manual vale nos talhões sem registro no PIMS.
 */
export function useTalhoesEPlantio(fazendaId: string, safraId: string, fazenda: Fazenda | null, safra: Safra | null): PlantioEditor {
  const [talhoes, setTalhoes] = useState<Talhao[]>([]);
  const [manuais, setManuais] = useState<Plantio[]>([]);
  const [areas, setAreas] = useState<AreaCultura[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const arquivo = usePlantioPims();

  useEffect(() => {
    let ativo = true;
    setErro(null);
    // nunca mostrar os talhões da fazenda anterior enquanto carrega (ou se falhar)
    setTalhoes((t) => (t.length ? [] : t));
    if (!fazendaId) {
      setCarregando(false);
      return;
    }
    setCarregando(true);
    repo()
      .obterTalhoes(fazendaId)
      .then((t) => ativo && setTalhoes(t))
      .catch((e) => ativo && setErro(`Não foi possível carregar os talhões: ${mensagemDeErro(e)}`))
      .finally(() => ativo && setCarregando(false));
    return () => {
      ativo = false;
    };
  }, [fazendaId]);

  useEffect(() => {
    let ativo = true;
    // como nos talhões: nada da safra anterior fica valendo enquanto carrega (ou se falhar)
    setManuais((p) => (p.length ? [] : p));
    setAreas((a) => (a.length ? [] : a));
    if (!safraId || !fazendaId) return;
    carregarPlantioEAreas(repo(), safraId, fazendaId).then((r) => {
      if (!ativo) return;
      setManuais(r.plantios);
      setAreas(r.areas);
      if (r.erro) setErro(r.erro);
    });
    return () => {
      ativo = false;
    };
  }, [safraId, fazendaId]);

  const areasSafra = safraId ? areas : SEM_AREAS;
  const casado = useMemo(
    () => (arquivo && safra && fazenda && safra.id === safraId && fazenda.id === fazendaId ? casarPlantio(arquivo, safra, fazenda, talhoes, areas) : null),
    [arquivo, safra, fazenda, safraId, fazendaId, talhoes, areas],
  );
  const efetivos = useMemo(
    () => (safraId ? combinarPlantios(casado?.porCodigo ?? null, manuais, talhoes, safraId) : []),
    [casado, manuais, talhoes, safraId],
  );
  const pims = casado?.porCodigo ?? null;
  const semArea = useMemo(() => plantadosSemArea(pims, talhoes, areasSafra), [pims, talhoes, areasSafra]);

  return {
    talhoes,
    areas: areasSafra,
    efetivos,
    pims,
    geradoEm: casado?.geradoEm ?? null,
    semPoligono: casado?.semPoligono ?? [],
    semArea,
    carregando,
    erro,
  };
}

export interface MapaPlantio {
  setoresDisponiveis: string[];
  /** talhões base dos setores escolhidos (desenhados no mapa) */
  talhoesUsados: Talhao[];
  /** áreas da cultura dos setores escolhidos (pintadas no mapa) */
  areasUsadas: AreaCultura[];
  /** máscara da interpolação: talhões usados ∪ áreas usadas sem talhão base (entradas sintéticas) */
  talhoesInterp: Talhao[];
  /** situação calculada DEPOIS do filtro de setores (contadores e pintura batem) */
  situacao: SituacaoMapa;
}

/** Aplica o filtro de setores e monta a situação do mapa e a lista de talhões da interpolação. */
export function useMapaPlantio(p: PlantioEditor, setores: string[] | null): MapaPlantio {
  const { talhoes, areas, efetivos, pims } = p;
  const setoresDisponiveis = useMemo(
    () => [...new Set(talhoes.map((t) => t.setor).filter((s): s is string => !!s))].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })),
    [talhoes],
  );
  const talhoesUsados = useMemo(
    () => (setores && setores.length ? talhoes.filter((t) => t.setor && setores.includes(t.setor)) : talhoes),
    [talhoes, setores],
  );
  const areasUsadas = useMemo(() => filtrarAreasPorSetor(areas, talhoesUsados, talhoes, setores, pims), [areas, talhoesUsados, talhoes, setores, pims]);
  const talhoesInterp = useMemo(() => talhoesParaInterpolacao(talhoesUsados, areasUsadas), [talhoesUsados, areasUsadas]);
  const situacao = useMemo(() => situacaoDoMapa(talhoesUsados, areasUsadas, efetivos, pims), [talhoesUsados, areasUsadas, efetivos, pims]);
  return { setoresDisponiveis, talhoesUsados, areasUsadas, talhoesInterp, situacao };
}
