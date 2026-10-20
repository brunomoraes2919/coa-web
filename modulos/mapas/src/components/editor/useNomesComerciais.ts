import { useEffect, useMemo, useState } from 'react';
import { repo } from '../../data';
import { comerciaisDe } from '../../lib/variedades';
import type { VariedadePims } from '../../lib/types';

/**
 * Cadastro de variedades do PIMS com o nome comercial (Mapas → Cadastros → Variedades), lido uma vez por tela.
 * `lista` null = lendo; sem conseguir ler (tabela ainda não criada, sem acesso, rede), lista vazia: o mapa segue
 * com os nomes do PIMS e sem o aviso de nome comercial.
 */
export function useNomesComerciais(): { lista: VariedadePims[] | null; comerciais: Map<string, string> } {
  const [lista, setLista] = useState<VariedadePims[] | null>(null);
  useEffect(() => {
    let ativo = true;
    repo()
      .listarVariedadesPims()
      .then((l) => ativo && setLista(l))
      .catch((e) => {
        console.warn('Mapas: cadastro de variedades indisponível', e);
        if (ativo) setLista([]);
      });
    return () => {
      ativo = false;
    };
  }, []);
  const comerciais = useMemo(() => comerciaisDe(lista ?? []), [lista]);
  return { lista, comerciais };
}
