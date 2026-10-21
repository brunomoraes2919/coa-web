import { useCallback, useEffect, useMemo, useState } from 'react';
import { repo } from '../../data';
import { populacaoPorChave } from '../../lib/variedades';
import type { PopulacaoVariedade } from '../../lib/types';

/**
 * Sementes por metro e população da fazenda e safra do mapa (unidade e safra do PIMS; null = sem vínculo).
 * Sem conseguir ler (tabela ainda não criada, sem acesso, rede), segue sem valores: o mapa sai sem as colunas.
 */
export function usePopulacao(chaves: { unidade: string; safra: string } | null): {
  mapa: Map<string, PopulacaoVariedade>;
  erro: string | null;
  recarregar: () => void;
} {
  const [linhas, setLinhas] = useState<PopulacaoVariedade[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);
  const unidade = chaves?.unidade ?? '';
  const safra = chaves?.safra ?? '';
  useEffect(() => {
    let ativo = true;
    setLinhas([]);
    setErro(null);
    if (!unidade || !safra) return;
    repo()
      .listarPopulacao(unidade, safra)
      .then((l) => ativo && setLinhas(l))
      .catch((e) => {
        console.warn('Mapas: sementes e população indisponíveis', e);
        if (ativo) setErro(e instanceof Error ? e.message : String(e));
      });
    return () => {
      ativo = false;
    };
  }, [unidade, safra, versao]);
  const mapa = useMemo(() => populacaoPorChave(linhas), [linhas]);
  const recarregar = useCallback(() => setVersao((v) => v + 1), []);
  return { mapa, erro, recarregar };
}
