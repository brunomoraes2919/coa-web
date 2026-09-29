import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { lerConfig } from './config';

/** Singleton do client Supabase; recriado se a config (URL/chave/modo) mudar. */
let clienteCache: SupabaseClient | null = null;
let assinaturaCache = '';

/** Client Supabase singleton; retorna null no modo local. */
export function clienteSupabase(): SupabaseClient | null {
  const config = lerConfig();
  if (config.modo !== 'supabase') {
    clienteCache = null;
    assinaturaCache = '';
    return null;
  }
  const assinatura = `${config.supabaseUrl}::${config.supabaseKey}`;
  if (!clienteCache || assinaturaCache !== assinatura) {
    clienteCache = createClient(config.supabaseUrl, config.supabaseKey);
    assinaturaCache = assinatura;
  }
  return clienteCache;
}

/** Sessão atual; null no modo local ou sem login. */
export async function sessaoAtual(): Promise<Session | null> {
  const client = clienteSupabase();
  if (!client) return null;
  const { data, error } = await client.auth.getSession();
  if (error) {
    throw new Error(`Não foi possível obter a sessão: ${error.message}`);
  }
  return data.session;
}

/** Entra com e-mail e senha; lança Error('E-mail ou senha inválidos') se as credenciais forem rejeitadas. */
export async function entrar(email: string, senha: string): Promise<void> {
  const client = clienteSupabase();
  if (!client) {
    throw new Error('Configure o Supabase em Configurações antes de entrar.');
  }
  const { error } = await client.auth.signInWithPassword({ email, password: senha });
  if (!error) return;
  const credenciaisInvalidas = error.status === 400 || /invalid/i.test(error.message);
  if (credenciaisInvalidas) {
    throw new Error('E-mail ou senha inválidos');
  }
  throw new Error(`Não foi possível entrar: ${error.message}`);
}

/** Encerra a sessão atual; não faz nada no modo local. */
export async function sair(): Promise<void> {
  const client = clienteSupabase();
  if (!client) return;
  const { error } = await client.auth.signOut();
  if (error) {
    throw new Error(`Não foi possível sair: ${error.message}`);
  }
}

/** Assina mudanças de autenticação; retorna função para cancelar a assinatura. */
export function onAuthChange(cb: (s: Session | null) => void): () => void {
  const client = clienteSupabase();
  if (!client) {
    return () => {};
  }
  const {
    data: { subscription },
  } = client.auth.onAuthStateChange((_evento, session) => cb(session));
  return () => subscription.unsubscribe();
}
