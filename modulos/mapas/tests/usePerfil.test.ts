import { describe, expect, it, vi } from 'vitest';
import type { AcessoUsuario } from '../src/lib/types';

// o módulo importa o repositório (IndexedDB/Supabase) só para o efeito de leitura; aqui testamos a parte pura
vi.mock('../src/data', () => ({ repo: () => ({}) }));

const { estadoDoPerfil } = await import('../src/components/usePerfil');

const lido = (usuarioId: string, acesso: AcessoUsuario | null, erro: string | null = null) => ({ usuarioId, acesso, erro });

describe('estadoDoPerfil (o que as telas sabem do usuário)', () => {
  it('modo local: admin sem restrição, sem ler nada', () => {
    expect(estadoDoPerfil('local', null, false, null)).toEqual({ perfil: 'admin', adminSemRestricao: true, super: true, erro: null });
  });

  it('sessão carregando ou perfil ainda não lido: perfil undefined e nada de cadastro', () => {
    expect(estadoDoPerfil('supabase', 'u1', true, null)).toEqual({ perfil: undefined, adminSemRestricao: false, super: false, erro: null });
    expect(estadoDoPerfil('supabase', 'u1', false, null)).toEqual({ perfil: undefined, adminSemRestricao: false, super: false, erro: null });
  });

  it('sem sessão: perfil null', () => {
    expect(estadoDoPerfil('supabase', null, false, null)).toEqual({ perfil: null, adminSemRestricao: false, super: false, erro: null });
  });

  it('administrador que vê todas as fazendas: cadastra fazendas de mapa', () => {
    const e = estadoDoPerfil('supabase', 'u1', false, lido('u1', { perfil: 'admin', adminSemRestricao: true, super: false }));
    expect(e).toEqual({ perfil: 'admin', adminSemRestricao: true, super: false, erro: null });
  });

  it('administrador restrito: continua admin (safras, plantio), mas sem o cadastro de fazendas', () => {
    const e = estadoDoPerfil('supabase', 'u1', false, lido('u1', { perfil: 'admin', adminSemRestricao: false, super: false }));
    expect(e).toEqual({ perfil: 'admin', adminSemRestricao: false, super: false, erro: null });
  });

  it('colaborador e usuário sem linha em perfis', () => {
    expect(estadoDoPerfil('supabase', 'u1', false, lido('u1', { perfil: 'colaborador', adminSemRestricao: false, super: false })).perfil).toBe('colaborador');
    expect(estadoDoPerfil('supabase', 'u1', false, lido('u1', null))).toEqual({ perfil: null, adminSemRestricao: false, super: false, erro: null });
  });

  it('leitura de outro usuário (troca de login) não vale para o atual', () => {
    const e = estadoDoPerfil('supabase', 'u2', false, lido('u1', { perfil: 'admin', adminSemRestricao: true, super: false }));
    expect(e).toEqual({ perfil: undefined, adminSemRestricao: false, super: false, erro: null });
  });

  it('ADMINISTRADOR+: super true (Mapa de CAR e Matrícula)', () => {
    const e = estadoDoPerfil('supabase', 'u1', false, lido('u1', { perfil: 'admin', adminSemRestricao: true, super: true }));
    expect(e).toEqual({ perfil: 'admin', adminSemRestricao: true, super: true, erro: null });
  });

  it('falha na leitura: perfil null, sem cadastro, com a mensagem', () => {
    const e = estadoDoPerfil('supabase', 'u1', false, lido('u1', null, 'Não foi possível ler o seu perfil: falha'));
    expect(e).toEqual({ perfil: null, adminSemRestricao: false, super: false, erro: 'Não foi possível ler o seu perfil: falha' });
  });
});
