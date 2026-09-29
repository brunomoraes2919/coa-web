// Gera src/lib/palettes.data.json a partir dos estilos .qml do COA (QGIS, colorRampType DISCRETE).
// Uso: node scripts/gerar-paletas.mjs ["caminho/para/Estilos mapa de chuva"]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const base = process.argv[2] ?? join(homedir(), 'OneDrive - Locks (1)', '09.COA', 'Estilos', 'Estilos mapa de chuva');
const antigos = 'ESTILOS ANTIGOS';
const novos = '(NÃO USAR AINDA) NOVOS ESTILOS PADRÃO';

const fontes = [
  ['locks_0_160', 'Período curto (1 a 160 mm)', antigos, 'Precipitacao_Locks.qml'],
  ['acum_atual', 'Acumulado (50 a 2.000 mm)', antigos, 'Precipitacao_Acumulado_ATUAL.qml'],
  ['acum_v2', 'Acumulado V2 (50 a 2.000 mm)', antigos, 'Precipitacao_Acumulado_V2.qml'],
  ['acum_anual', 'Acumulado anual (500 a 2.500 mm)', antigos, 'Precipitacao_Acumulado_ANUAL.qml'],
  ['acum_2000', 'Acumulado acima de 2.000 mm', antigos, 'Precipitacao_Acumulado_acima_2000mm.qml'],
  ['novo_0_160', 'Novo padrão (em teste) 0 a 160 mm', novos, 'Precipitacao_0_160_mm.qml'],
  ['novo_50_500', 'Novo padrão (em teste) 50 a 500 mm', novos, 'Precipitacao_50_500_mm.qml'],
  ['novo_80_600', 'Novo padrão (em teste) 80 a 600 mm', novos, 'Precipitacao_80_600_mm.qml'],
  ['novo_160_800', 'Novo padrão (em teste) 160 a 800 mm', novos, 'Precipitacao_160_800_mm.qml'],
  ['novo_300_1200', 'Novo padrão (em teste) 300 a 1.200 mm', novos, 'Precipitacao_300_1200_mm.qml'],
  ['novo_500_2000', 'Novo padrão (em teste) 500 a 2.000 mm', novos, 'Precipitacao_500_2000_mm.qml'],
  ['novo_800_2500', 'Novo padrão (em teste) 800 a 2.500 mm', novos, 'Precipitacao_800_2500_mm.qml'],
  ['novo_800_2500_v2', 'Novo padrão (em teste) 800 a 2.500 mm v2', novos, 'Precipitacao_800_2500_mm_v2.qml'],
];

const ent = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const attr = (tag, nome) => {
  const m = new RegExp(' ' + nome + '="([^"]*)"').exec(tag);
  return m ? ent(m[1]) : null;
};

const paletas = fontes.map(([id, nome, pasta, arquivo]) => {
  const xml = readFileSync(join(base, pasta, arquivo), 'utf8');
  const tags = xml.match(/<item\s[^>]*\/>/g) ?? [];
  const classes = tags.map((t) => ({
    max: Number(attr(t, 'value')),
    color: attr(t, 'color'),
    label: attr(t, 'label'),
  }));
  if (!classes.length || classes.some((c) => !Number.isFinite(c.max) || !c.color)) {
    throw new Error(`Paleta inválida em ${arquivo}`);
  }
  return { id, nome, origem: `${pasta}/${arquivo}`, classes };
});

writeFileSync(new URL('../src/lib/palettes.data.json', import.meta.url), JSON.stringify(paletas, null, 1) + '\n');
for (const p of paletas) {
  const u = p.classes.at(-1);
  console.log(`${p.id.padEnd(18)} ${String(p.classes.length).padStart(2)} classes  ${p.classes[0].label} … ${u.label}`);
}
