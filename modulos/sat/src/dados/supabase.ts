/**
 * Cliente do Supabase do COA WEB. Dentro do COA WEB (mesma origem) a sessão é a
 * do site, guardada no localStorage; quem renova o token é o site.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { emEmbed } from '../lib/embed'

let cliente: SupabaseClient | null | undefined

/** `null` quando o build não traz a URL e a chave (testes, build local sem .env.coa-web). */
export function clienteSupabase(): SupabaseClient | null {
  if (cliente !== undefined) return cliente
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
  const chave = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()
  cliente = url && chave
    ? createClient(url, chave, emEmbed() ? { auth: { autoRefreshToken: false } } : undefined)
    : null
  return cliente
}

/** Token da sessão atual, para a ponte da Trimble; `null` sem login. */
export async function tokenDaSessao(): Promise<string | null> {
  const c = clienteSupabase()
  if (!c) return null
  const { data } = await c.auth.getSession()
  return data.session?.access_token ?? null
}
