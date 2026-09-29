import { clienteSupabase } from './auth';
import { lerConfig } from './config';
import { criarLocalRepo } from './localRepo';
import type { Repositorio } from './repo';
import { criarSupabaseRepo } from './supabaseRepo';

let instancia: Repositorio | null = null;
let chaveInstancia = '';

/**
 * Modo local: pede ao navegador para não apagar o IndexedDB quando faltar espaço (o navegador pode
 * recusar; mesmo assim, recomende backups periódicos). Sem a API (navegador antigo, testes), nada acontece.
 */
function pedirArmazenamentoPersistente(): void {
  try {
    const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    storage?.persist?.().catch(() => undefined);
  } catch {
    // API indisponível: segue sem persistência garantida
  }
}

/**
 * Repositório singleton conforme lerConfig(). Recriado automaticamente se a config mudar em tempo
 * de execução — não só o modo (ex.: usuário troca de Local para Supabase em Configurações), mas
 * também a URL/chave do Supabase (ex.: troca de projeto), para não reter um client antigo.
 */
export function repo(): Repositorio {
  const config = lerConfig();
  const chave = `${config.modo}::${config.supabaseUrl}::${config.supabaseKey}`;
  if (instancia && chaveInstancia === chave) {
    return instancia;
  }
  if (config.modo === 'supabase') {
    const client = clienteSupabase();
    if (!client) {
      throw new Error('Configuração do Supabase inválida ou incompleta.');
    }
    instancia = criarSupabaseRepo(client);
  } else {
    instancia = criarLocalRepo();
    pedirArmazenamentoPersistente();
  }
  chaveInstancia = chave;
  return instancia;
}

export type { BackupJson, Repositorio } from './repo';
