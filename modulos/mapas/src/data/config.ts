import { createClient } from '@supabase/supabase-js';
import { TABELAS } from './supabaseLinhas';

/** Configuração de acesso a dados: modo local (IndexedDB) ou Supabase. */
export interface AppConfig {
  modo: 'local' | 'supabase';
  supabaseUrl: string;
  supabaseKey: string;
}

const CHAVE_LOCAL_STORAGE = 'coa-chuva-config';

interface ConfigArmazenada {
  modo?: 'local' | 'supabase';
  supabaseUrl?: string;
  supabaseKey?: string;
}

/** Lê o JSON salvo em localStorage; nunca lança (localStorage pode não existir ou estar bloqueado). */
function lerConfigArmazenada(): ConfigArmazenada {
  try {
    const bruto = localStorage.getItem(CHAVE_LOCAL_STORAGE);
    if (!bruto) return {};
    const dados: unknown = JSON.parse(bruto);
    return dados && typeof dados === 'object' ? (dados as ConfigArmazenada) : {};
  } catch {
    return {};
  }
}

/**
 * Config efetiva: valores salvos em localStorage sobrepõem as variáveis de ambiente
 * VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. O modo só é 'supabase' se URL e chave
 * estiverem preenchidas e o modo salvo não tiver sido explicitamente forçado para 'local'.
 */
export function lerConfig(): AppConfig {
  const armazenada = lerConfigArmazenada();
  const envUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';
  const envKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '';
  const supabaseUrl = (armazenada.supabaseUrl ?? envUrl).trim();
  const supabaseKey = (armazenada.supabaseKey ?? envKey).trim();
  const configuradoParaSupabase = supabaseUrl !== '' && supabaseKey !== '';
  const modo: AppConfig['modo'] = configuradoParaSupabase && armazenada.modo !== 'local' ? 'supabase' : 'local';
  return { modo, supabaseUrl, supabaseKey };
}

/** Salva a config em localStorage; silenciosamente ignora se localStorage não estiver disponível. */
export function salvarConfig(c: AppConfig): void {
  try {
    localStorage.setItem(CHAVE_LOCAL_STORAGE, JSON.stringify(c));
  } catch {
    // Modo privado ou ambiente sem localStorage: config vale só para a sessão atual.
  }
}

/** Cria um client Supabase temporário e faz select de 1 linha de "mapas_safras" para validar a conexão. */
export async function testarConexao(c: AppConfig): Promise<void> {
  if (!c.supabaseUrl.trim() || !c.supabaseKey.trim()) {
    throw new Error('Informe a URL e a chave anon do Supabase.');
  }
  let client;
  try {
    client = createClient(c.supabaseUrl, c.supabaseKey);
  } catch {
    throw new Error('URL do Supabase inválida.');
  }
  const { error } = await client.from(TABELAS.safras).select('id').limit(1);
  if (error) {
    throw new Error(`Não foi possível conectar ao Supabase: ${error.message}`);
  }
}
