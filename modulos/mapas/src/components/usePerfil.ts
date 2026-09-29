import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { repo } from '../data';
import { mensagemDeErro } from '../lib/erros';
import type { PerfilUsuario } from '../lib/types';

/** Perfil do usuário para as telas: undefined = carregando; null = sem sessão, sem perfil ou erro na leitura. */
export type PerfilCarregado = PerfilUsuario | null | undefined;

export interface EstadoPerfil {
  perfil: PerfilCarregado;
  /** falha ao ler o perfil (rede, banco): a tela avisa em vez de tratar como colaborador em silêncio */
  erro: string | null;
}

/** Fornecido pelo App (um único carregamento por usuário). */
export const PerfilContexto = createContext<EstadoPerfil>({ perfil: undefined, erro: null });

/**
 * Perfil do usuário no COA WEB (perfis.perfil). Só esconde o que o colaborador não usa (cadastros,
 * links de edição); quem garante o acesso é o RLS do banco.
 */
export function usePerfil(): PerfilCarregado {
  return useContext(PerfilContexto).perfil;
}

/** Mensagem da falha ao ler o perfil; null se leu (ou ainda está lendo). */
export function useErroPerfil(): string | null {
  return useContext(PerfilContexto).erro;
}

interface Leitura {
  usuarioId: string;
  perfil: PerfilUsuario | null;
  erro: string | null;
}

/**
 * Lê o perfil uma vez por usuário da sessão. Modo local: sempre 'admin' (sem login). Sem linha em
 * perfis → perfil null; falha na leitura → perfil null e `erro` com a mensagem.
 */
export function useCarregarPerfil(modo: 'local' | 'supabase', usuarioId: string | null, carregandoSessao: boolean): EstadoPerfil {
  const [lido, setLido] = useState<Leitura | null>(null);

  useEffect(() => {
    if (modo === 'local' || !usuarioId) return;
    let ativo = true;
    Promise.resolve()
      .then(() => repo().perfil())
      .then(
        (perfil): Leitura => ({ usuarioId, perfil, erro: null }),
        (e: unknown): Leitura => ({ usuarioId, perfil: null, erro: `Não foi possível ler o seu perfil: ${mensagemDeErro(e)}` }),
      )
      .then((l) => {
        if (ativo) setLido(l);
      });
    return () => {
      ativo = false;
    };
  }, [modo, usuarioId]);

  const atual = lido && lido.usuarioId === usuarioId ? lido : null;
  const perfil: PerfilCarregado =
    modo === 'local' ? 'admin' : carregandoSessao ? undefined : !usuarioId ? null : atual ? atual.perfil : undefined;
  const erro = modo === 'supabase' && !carregandoSessao && atual ? atual.erro : null;
  return useMemo(() => ({ perfil, erro }), [perfil, erro]);
}
