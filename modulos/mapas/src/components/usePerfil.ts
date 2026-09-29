import { createContext, useContext, useEffect, useState } from 'react';
import { repo } from '../data';
import type { PerfilUsuario } from '../lib/types';

/** Perfil do usuário para as telas: undefined = carregando; null = sem sessão ou sem perfil no COA WEB. */
export type PerfilCarregado = PerfilUsuario | null | undefined;

/** Fornecido pelo App (um único carregamento por usuário). */
export const PerfilContexto = createContext<PerfilCarregado>(undefined);

/**
 * Perfil do usuário no COA WEB (perfis.perfil). Só esconde o que o colaborador não usa (cadastros,
 * links de edição); quem garante o acesso é o RLS do banco.
 */
export function usePerfil(): PerfilCarregado {
  return useContext(PerfilContexto);
}

/**
 * Lê o perfil uma vez por usuário da sessão. Modo local: sempre 'admin' (sem login). Falha ao ler
 * (rede, RLS) conta como sem perfil: a tela esconde as ações de admin.
 */
export function useCarregarPerfil(modo: 'local' | 'supabase', usuarioId: string | null, carregandoSessao: boolean): PerfilCarregado {
  const [lido, setLido] = useState<{ usuarioId: string; perfil: PerfilUsuario | null } | null>(null);

  useEffect(() => {
    if (modo === 'local' || !usuarioId) return;
    let ativo = true;
    Promise.resolve()
      .then(() => repo().perfil())
      .catch((): PerfilUsuario | null => null)
      .then((perfil) => {
        if (ativo) setLido({ usuarioId, perfil });
      });
    return () => {
      ativo = false;
    };
  }, [modo, usuarioId]);

  if (modo === 'local') return 'admin';
  if (carregandoSessao) return undefined;
  if (!usuarioId) return null;
  return lido?.usuarioId === usuarioId ? lido.perfil : undefined;
}
