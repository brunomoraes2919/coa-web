import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { repo } from '../data';
import { mensagemDeErro } from '../lib/erros';
import type { AcessoUsuario, PerfilUsuario } from '../lib/types';

/** Perfil do usuário para as telas: undefined = carregando; null = sem sessão, sem perfil ou erro na leitura. */
export type PerfilCarregado = PerfilUsuario | null | undefined;

export interface EstadoPerfil {
  perfil: PerfilCarregado;
  /**
   * administrador sem restrição de fazendas (ou ADMINISTRADOR+): o único que o banco deixa criar, alterar e
   * excluir fazendas de mapa. false enquanto o perfil carrega, sem perfil e para o administrador restrito.
   */
  adminSemRestricao: boolean;
  /** falha ao ler o perfil (rede, banco): a tela avisa em vez de tratar como colaborador em silêncio */
  erro: string | null;
}

/** Fornecido pelo App (um único carregamento por usuário). */
export const PerfilContexto = createContext<EstadoPerfil>({ perfil: undefined, adminSemRestricao: false, erro: null });

/**
 * Perfil do usuário no COA WEB (perfis.perfil). Só esconde o que o colaborador não usa (cadastros,
 * links de edição); quem garante o acesso é o RLS do banco.
 */
export function usePerfil(): PerfilCarregado {
  return useContext(PerfilContexto).perfil;
}

/**
 * Se a conta cadastra fazendas de mapa (criar, editar, excluir, importar o cadastro padrão): só o
 * administrador que vê todas as fazendas. Para o administrador restrito a tela esconde esses caminhos, que
 * o banco recusaria ao salvar (mapas_fazendas, script 0019 do COA WEB).
 */
export function useAdminSemRestricao(): boolean {
  return useContext(PerfilContexto).adminSemRestricao;
}

/** Mensagem da falha ao ler o perfil; null se leu (ou ainda está lendo). */
export function useErroPerfil(): string | null {
  return useContext(PerfilContexto).erro;
}

/** Resultado da leitura do perfil de um usuário (acesso null = sem linha em perfis, ou a leitura falhou). */
export interface LeituraPerfil {
  usuarioId: string;
  acesso: AcessoUsuario | null;
  erro: string | null;
}

/**
 * Estado do perfil para as telas, a partir da última leitura (pura, para os testes). Modo local: admin
 * sem restrição. Sessão carregando ou perfil ainda não lido para este usuário: perfil undefined.
 */
export function estadoDoPerfil(modo: 'local' | 'supabase', usuarioId: string | null, carregandoSessao: boolean, lido: LeituraPerfil | null): EstadoPerfil {
  if (modo === 'local') return { perfil: 'admin', adminSemRestricao: true, erro: null };
  if (carregandoSessao) return { perfil: undefined, adminSemRestricao: false, erro: null };
  if (!usuarioId) return { perfil: null, adminSemRestricao: false, erro: null };
  const atual = lido && lido.usuarioId === usuarioId ? lido : null;
  if (!atual) return { perfil: undefined, adminSemRestricao: false, erro: null };
  return { perfil: atual.acesso?.perfil ?? null, adminSemRestricao: atual.acesso?.adminSemRestricao === true, erro: atual.erro };
}

/**
 * Lê o perfil uma vez por usuário da sessão. Modo local: sempre 'admin' (sem login). Sem linha em
 * perfis → perfil null; falha na leitura → perfil null e `erro` com a mensagem.
 */
export function useCarregarPerfil(modo: 'local' | 'supabase', usuarioId: string | null, carregandoSessao: boolean): EstadoPerfil {
  const [lido, setLido] = useState<LeituraPerfil | null>(null);

  useEffect(() => {
    if (modo === 'local' || !usuarioId) return;
    let ativo = true;
    Promise.resolve()
      .then(() => repo().acesso())
      .then(
        (acesso): LeituraPerfil => ({ usuarioId, acesso, erro: null }),
        (e: unknown): LeituraPerfil => ({ usuarioId, acesso: null, erro: `Não foi possível ler o seu perfil: ${mensagemDeErro(e)}` }),
      )
      .then((l) => {
        if (ativo) setLido(l);
      });
    return () => {
      ativo = false;
    };
  }, [modo, usuarioId]);

  const { perfil, adminSemRestricao, erro } = estadoDoPerfil(modo, usuarioId, carregandoSessao, lido);
  return useMemo(() => ({ perfil, adminSemRestricao, erro }), [perfil, adminSemRestricao, erro]);
}
