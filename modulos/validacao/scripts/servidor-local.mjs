// COA WEB no computador, para testar a Validação PIMS sem login: serve a raiz do repositório, troca
// validacao/config.js por { modo: 'local' } e responde /api/validacao-teste com um retrato FICTÍCIO
// (nenhuma ordem, nome ou saldo real entra no repositório). Com VALID_DADOS=<arquivo .json fora do
// repositório> abre um retrato de verdade, só neste computador.
// Uso (na raiz): node modulos/validacao/scripts/servidor-local.mjs  → http://localhost:8793/validacao/
import { createReadStream, readFileSync, realpathSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const RAIZ_REAL = realpathSync.native(RAIZ);
const PORTA = Number(process.env.PORT || 8793);
// só pelo endereço local: um site de fora que aponte um nome qualquer para 127.0.0.1 não lê isto
const HOSTS = [`localhost:${PORTA}`, `127.0.0.1:${PORTA}`];

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** Dias atrás → 'YYYY-MM-DD' (as ordens de mentira ficam sempre "recentes"). */
const dia = (atras) => {
  const d = new Date(Date.now() - atras * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const r1 = (v) => Math.round(v * 10) / 10;
/** Talhões planejados e apontamentos de mentira de uma ordem (o segundo apontamento cai num talhão fora da ordem). */
const detalhe = (os, atras, pl, ex) => ({
  tl: [['T01', r1(pl * 0.6)], ['T02', r1(pl * 0.4)]],
  ap: ex ? [
    [dia(Math.max(0, atras - 2)), 900000 + os * 10, 'T01', r1(ex * 0.4), `${dia(Math.max(0, atras - 2))} 18:20`, 'usuario.teste'],
    [dia(Math.max(0, atras - 1)), 900001 + os * 10, os % 2 ? 'T02' : 'T09', r1(ex * 0.6), null, 'outro.usuario'],
  ] : [],
});
const ordem = (os, eq, opn, atras, pl, ex) => ({
  os, eq, op: 45, opn, s: 'A', ab: dia(atras), enc: null, pl, ex, nt: 2, ult: ex ? dia(Math.max(0, atras - 1)) : null,
  ev: ex ? [[dia(Math.max(0, atras - 2)), r1(ex * 0.4)], [dia(Math.max(0, atras - 1)), r1(ex * 0.6)]] : [],
  ...detalhe(os, atras, pl, ex),
});
const fechada = (os, eq, opn, atras, pl, ex) => ({ os, eq, op: 91, opn, s: 'F', ab: dia(atras + 6), enc: dia(atras), pl, ex, nt: 2, ult: dia(atras), ...detalhe(os, atras + 1, pl, ex) });

/** Retrato FICTÍCIO (nenhuma ordem, nome ou saldo real entra no repositório). */
function dadosFicticios() {
  return {
    admin: true,
    fazendas: [{ unidade_pims: 'TESTE NORTE', coa_fazenda_id: 1 }, { unidade_pims: 'TESTE SUL', coa_fazenda_id: 2 }],
    vinculos: [{ unidade: 'TESTE NORTE', equipe: 'COORDENADOR UM', deposito: '9001' }],
    linhas: [
      {
        unidade: 'TESTE NORTE', gerado_em: new Date().toISOString(), avisos: [],
        ordens: [
          ordem(101, 'COORDENADOR UM', 'APLIC HERBICIDA PRE-EME. AUTOP', 0, 320, 0),
          ordem(102, 'COORDENADOR UM', 'PLANTIO DB', 4, 146.75, 162.5),
          ordem(103, 'COORDENADOR UM', 'APLIC DESSECACAO PLANTIO AUTOP', 9, 500, 310),
          ordem(104, 'COORDENADOR DOIS', 'PLANTIO DB', 2, 210, 180),
          ordem(90, 'COORDENADOR DOIS', 'GRADAGEM 36', 400, 80, 20),
          fechada(80, 'COORDENADOR UM', 'PLANTIO DB', 3, 200, 172.4),
          fechada(81, 'COORDENADOR DOIS', 'COLHEITA', 12, 150, 163),
        ],
        coordenadores: [{ eq: 'COORDENADOR UM', ab: 3, n: 20 }, { eq: 'COORDENADOR DOIS', ab: 2, n: 14 }, { eq: 'COORDENADOR TRES', ab: 0, n: 5 }],
        depositos: [{ c: '9001', n: 'APLICACAO TERRESTRE' }, { c: '9002', n: 'PLANTIO EQUIPE 1' }, { c: '9003', n: 'DEFENSIVOS - TESTE NORTE' }, { c: '9004', n: 'DEPOSITO ANTIGO', i: 1 }],
        boletins: [
          { o: 'P', n: '700101', d: dia(4), os: 102, eq: 'COORDENADOR UM', sit: 'F', em: `${dia(3)} 16:57`, t: 6, p1: dia(3), ul: dia(0),
            m: ['Error -10 - Quantity falls into negative inventory [IGE1.ItemCode][line: 2]'],
            it: [{ c: '000011', nm: 'SEMENTE TESTE', q: 8322, u: 'KG', dp: '9003', s: 1200, pr: ['sem-estoque'] }, { c: '000012', nm: 'INOCULANTE TESTE', q: 46, u: 'LT', dp: '9003', s: 300 }] },
          { o: 'I', n: '700102', d: dia(9), os: 103, eq: 'COORDENADOR UM', sit: 'F', em: `${dia(8)} 09:10`, t: 14, p1: dia(8), ul: dia(0),
            m: ['Error -5002 - (1) Centro de custo não definido para a Fazenda Teste Norte'], it: [{ c: '000001', nm: 'HERBICIDA TESTE', q: 120, u: 'LT', dp: '9001', s: 40, pr: ['sem-estoque'] }] },
          { o: 'I', n: '700103', d: dia(2), os: 101, eq: 'COORDENADOR UM', sit: 'P', em: `${dia(1)} 07:15`,
            it: [{ c: '000002', nm: 'ADJUVANTE TESTE', q: 30, u: 'LT', dp: '9001', s: 12.5, pr: ['sem-estoque'] }, { c: '000013', nm: 'PRODUTO NOVO', q: 5, u: 'KG', dp: '9004', pr: ['deposito-inativo', 'item-fora-deposito'] }] },
          { o: 'P', n: '700104', d: dia(1), os: 104, eq: 'COORDENADOR DOIS', sit: 'P', em: null, it: [{ c: '000011', nm: 'SEMENTE TESTE', q: 100, u: 'KG', dp: '9003', s: 1200, ant: 8322, pr: ['sem-estoque'] }] },
          { o: 'I', n: '700105', d: dia(20), os: null, eq: null, sit: 'P', em: `${dia(19)} 06:40`, si: 1, it: [] },
          { o: 'T', n: '700106', d: dia(0), os: null, eq: null, sit: 'P', em: `${dia(0)} 10:30`, it: [{ c: '000014', nm: 'TRATAMENTO TESTE', q: 8, u: 'LT', dp: '9003', s: 90 }] },
        ],
        estoque: {
          9001: [
            { c: '000001', n: 'HERBICIDA TESTE', q: 40, u: 'LT', o: '9003', on: 'DEFENSIVOS - TESTE NORTE', oq: 1200, od: '2026-10-02' },
            { c: '000002', n: 'ADJUVANTE TESTE', q: 12.5, u: 'LT', o: '9005', on: 'OLEO MINERAL - TESTE NORTE', oq: 0, od: '2026-09-20' },
            { c: '000003', n: 'PRODUTO SEM TRANSFERENCIA', q: 3, u: 'KG' },
          ],
        },
      },
      {
        unidade: 'TESTE SUL', gerado_em: new Date().toISOString(), avisos: [],
        ordens: [ordem(201, 'COORDENADOR QUATRO', 'APLIC ADUBO LANCO AUTOPROPELID', 1, 389, 120)],
        coordenadores: [{ eq: 'COORDENADOR QUATRO', ab: 1, n: 9 }],
        depositos: [{ c: '9101', n: 'ADUBACAO' }, { c: '9102', n: 'ADUBOS E FERTILIZANTES - TESTE SUL' }],
        estoque: {},
      },
    ],
  };
}

// VALID_DADOS=<arquivo .json fora do repositório>: retrato de verdade (saída de sincronizarValidacao: { linhas })
let DADOS = dadosFicticios();
if (process.env.VALID_DADOS) {
  const real = JSON.parse(readFileSync(process.env.VALID_DADOS, 'utf8'));
  DADOS = {
    admin: process.env.VALID_ADMIN !== '0',
    fazendas: real.linhas.map((l, i) => ({ unidade_pims: l.unidade, coa_fazenda_id: i + 1 })),
    vinculos: real.vinculos ?? [],
    linhas: real.linhas,
  };
}

function lerCorpo(req) {
  return new Promise((ok, falha) => {
    const partes = [];
    req.on('data', (p) => partes.push(p));
    req.on('end', () => {
      try {
        ok(JSON.parse(Buffer.concat(partes).toString('utf8') || '{}'));
      } catch (e) {
        falha(e);
      }
    });
    req.on('error', falha);
  });
}

/** Caminho real do arquivo pedido, ou null: só arquivos de dentro da raiz do repositório e nunca a pasta .git. */
function arquivoServivel(caminho) {
  // ':', '\' e NUL não existem nos endereços do site e abrem brechas no Windows (fluxos NTFS, ..\)
  if (/[:\\\0]/.test(caminho)) return null;
  let real;
  try {
    real = realpathSync.native(join(RAIZ, caminho));
    if (!statSync(real).isFile()) return null;
  } catch {
    return null;
  }
  const rel = relative(RAIZ_REAL, real);
  if (rel === '' || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) return null;
  if (rel.split(sep).some((parte) => parte.toLowerCase() === '.git')) return null;
  return real;
}

function responder(res, status, tipo, texto) {
  res.statusCode = status;
  res.setHeader('Content-Type', tipo);
  res.setHeader('Cache-Control', 'no-store');
  res.end(texto);
}

createServer((req, res) => {
  if (!HOSTS.includes(String(req.headers.host || '').toLowerCase())) {
    responder(res, 400, 'text/plain; charset=utf-8', 'host não aceito');
    return;
  }
  let caminho;
  try {
    caminho = decodeURIComponent(new URL(req.url, 'http://local').pathname);
  } catch {
    responder(res, 400, 'text/plain; charset=utf-8', 'endereço inválido');
    return;
  }
  if (caminho === '/api/validacao-teste') {
    responder(res, 200, TIPOS['.json'], JSON.stringify(DADOS));
    return;
  }
  // os vínculos ficam só na memória deste servidor
  if (caminho === '/api/validacao-teste/vinculo' && req.method === 'PUT') {
    lerCorpo(req)
      .then((v) => {
        DADOS.vinculos = DADOS.vinculos.filter((x) => !(x.unidade === v.unidade && x.equipe === v.equipe));
        if (v.deposito) {
          DADOS.vinculos.push({ unidade: String(v.unidade), equipe: String(v.equipe), deposito: v.deposito });
        }
        responder(res, 200, TIPOS['.json'], '{"ok":true}');
      })
      .catch(() => responder(res, 400, 'text/plain; charset=utf-8', 'corpo inválido'));
    return;
  }
  if (caminho === '/api/validacao-teste/pedido' && req.method === 'POST') {
    responder(res, 200, TIPOS['.json'], '{"id":1}');
    return;
  }
  if (caminho === '/validacao/config.js') {
    responder(res, 200, TIPOS['.js'], "window.VALIDACAO_CONFIG = { modo: 'local' };\n");
    return;
  }
  if (caminho.endsWith('/')) caminho += 'index.html';
  const arquivo = arquivoServivel(caminho);
  if (!arquivo) {
    responder(res, 404, 'text/plain; charset=utf-8', 'não encontrado');
    return;
  }
  res.setHeader('Content-Type', TIPOS[extname(arquivo).toLowerCase()] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  const leitura = createReadStream(arquivo);
  leitura.on('error', () => res.destroy());
  leitura.pipe(res);
}).listen(PORTA, '127.0.0.1', () => {
  console.log(`COA WEB local em http://localhost:${PORTA}/validacao/ (${process.env.VALID_DADOS ? 'retrato de verdade, só neste computador' : 'dados fictícios'})`);
});
