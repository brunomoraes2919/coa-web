import { useEffect, useMemo, useRef, useState } from 'react';
import { repo } from '../../data';
import { coresNovas, juntarCores, variedadesSemCor, type FeicaoVariedade } from '../../lib/variedades';
import { mensagemDeErro } from '../Aviso';

/**
 * Cores das variedades do mapa: lê o cadastro (mapas_variedade_cores) uma vez e, para as variedades do mapa sem
 * cor, calcula a cor automática e grava (só cria; se outra pessoa gravou antes, vale a dela). `fixas` = cores de
 * um mapa salvo (prevalecem). Sem o cadastro (erro de leitura ou de gravação), as cores calculadas valem só neste
 * mapa e `aviso` explica. `cores` null = ainda lendo o cadastro.
 */
export function useCoresVariedade(feicoes: FeicaoVariedade[], fixas: Record<string, string> | null): { cores: Map<string, string> | null; aviso: string | null } {
  const [cadastro, setCadastro] = useState<Map<string, string> | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  /** chaves já pedidas ao banco nesta tela (não pede duas vezes) */
  const pedidas = useRef(new Set<string>());

  useEffect(() => {
    let ativo = true;
    repo()
      .listarCoresVariedade()
      .then((lista) => ativo && setCadastro(new Map(lista.map((c) => [c.variedade, c.cor]))))
      .catch((e) => {
        if (!ativo) return;
        setCadastro(new Map());
        setAviso(`Não foi possível ler as cores das variedades (${mensagemDeErro(e)}): as cores deste mapa são provisórias.`);
      });
    return () => {
      ativo = false;
    };
  }, []);

  const cores = useMemo(() => (cadastro ? juntarCores(cadastro, fixas) : null), [cadastro, fixas]);

  useEffect(() => {
    if (!cores) return;
    const faltam = variedadesSemCor(feicoes, cores).filter((k) => !pedidas.current.has(k));
    if (!faltam.length) return;
    const novas = coresNovas(faltam, cores);
    faltam.forEach((k) => pedidas.current.add(k));
    // a cor calculada vale na hora; a gravada (ou a de quem gravou antes) substitui quando o banco responder
    setCadastro((c) => new Map([...(c ?? []), ...novas]));
    for (const [variedade, cor] of novas) {
      repo()
        .criarCorVariedade(variedade, cor)
        .then((salva) => {
          if (salva.cor !== cor) setCadastro((c) => new Map(c ?? []).set(variedade, salva.cor));
        })
        .catch((e) => setAviso(`Não foi possível gravar a cor de ${variedade} (${mensagemDeErro(e)}): a cor vale só neste mapa.`));
    }
  }, [cores, feicoes]);

  return { cores, aviso };
}
