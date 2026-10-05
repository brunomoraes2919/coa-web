// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * O módulo é carregado escondido para todo usuário logo depois do login: o pacote principal
 * (o que main.tsx alcança por `import` estático) tem de ser só a casca e o vigia. As telas e
 * o que elas pesam (recharts, Leaflet) entram por `import()` dinâmico.
 */
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src')
const EXTENSOES = ['.ts', '.tsx', '/index.ts', '/index.tsx']

/** Alvos de `import ... from '...'` e `import '...'` — o `import('...')` dinâmico não entra. */
function importsEstaticos(codigo: string): string[] {
  const alvos: string[] = []
  const re = /^\s*(?:import|export)\s[^'"()]*?from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm
  for (let m = re.exec(codigo); m; m = re.exec(codigo)) alvos.push(m[1] ?? m[2])
  return alvos
}

function resolverArquivo(de: string, alvo: string): string | null {
  const base = resolve(dirname(de), alvo)
  if (existsSync(base) && /\.(ts|tsx)$/.test(base)) return base
  for (const ext of EXTENSOES) if (existsSync(base + ext)) return base + ext
  return null
}

/** Tudo que o pacote principal junta, a partir de main.tsx: arquivos do módulo e pacotes de fora. */
function alcancado() {
  const arquivos = new Set<string>()
  const pacotes = new Set<string>()
  const fila = [resolve(SRC, 'main.tsx')]
  while (fila.length) {
    const arquivo = fila.pop()!
    if (arquivos.has(arquivo)) continue
    arquivos.add(arquivo)
    for (const alvo of importsEstaticos(readFileSync(arquivo, 'utf8'))) {
      if (alvo.startsWith('.')) {
        const destino = resolverArquivo(arquivo, alvo)
        if (destino) fila.push(destino)
      } else {
        pacotes.add(alvo.startsWith('@') ? alvo.split('/').slice(0, 2).join('/') : alvo.split('/')[0])
      }
    }
  }
  return { arquivos: [...arquivos].map((a) => relative(SRC, a).split(sep).join('/')), pacotes: [...pacotes] }
}

describe('pacote principal (o que todo usuário baixa no login)', () => {
  const { arquivos, pacotes } = alcancado()

  it('enxerga a casca e o vigia (a conta do teste está certa)', () => {
    expect(arquivos).toEqual(expect.arrayContaining(['App.tsx', 'vigia/VigiaGnss.tsx', 'componentes/Topo.tsx']))
  })

  it('não junta as telas: Hoje, Mapa e Alertas vêm por import dinâmico', () => {
    expect(arquivos.filter((a) => a.startsWith('pages/'))).toEqual([])
  })

  it('não junta a linha do tempo nem o recharts, nem o Leaflet', () => {
    expect(arquivos).not.toContain('componentes/LinhaDoTempo.tsx')
    expect(pacotes).not.toContain('recharts')
    expect(pacotes).not.toContain('leaflet')
    expect(pacotes).not.toContain('react-leaflet')
  })
})
