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
const ordem = (os, eq, opn, atras, pl, ex) => ({
  os, eq, op: 45, opn, s: 'A', ab: dia(atras), enc: null, pl, ex, nt: 3, ult: ex ? dia(Math.max(0, atras - 1)) : null,
  ev: ex ? [[dia(Math.max(0, atras - 2)), Math.round(ex * 0.4 * 10) / 10], [dia(Math.max(0, atras - 1)), Math.round(ex * 0.6 * 10) / 10]] : [],
});
const fechada = (os, eq, opn, atras, pl, ex) => ({ os, eq, op: 91, opn, s: 'F', ab: dia(atras + 6), enc: dia(atras), pl, ex, nt: 2, ult: dia(atras) });

/** Retrato FICTÍCIO (nenhuma ordem, nome ou saldo real entra no repositório). */
function dadosFicticios() {
  return {
    admin: true,
    fazendas: [{ unidade_pims: 'TESTE NORTE', coa_fazenda_id: 1 }, { unidade_pims: 'TESTE SUL', coa_fazenda_id: 2 }],
    vinculos: [{ unidade: 'TESTE NORTE', equipe: 'COORDENADOR UM', deposito: '9001', deposito_origem: '9003' }],
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
        estoque: {
          9001: [{ c: '000001', n: 'HERBICIDA TESTE', q: 40, u: 'LT' }, { c: '000002', n: 'ADJUVANTE TESTE', q: 12.5, u: 'LT' }],
          9003: [{ c: '000001', n: 'HERBICIDA TESTE', q: 1200, u: 'LT' }],
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
        if (v.deposito || v.deposito_origem) {
          DADOS.vinculos.push({ unidade: String(v.unidade), equipe: String(v.equipe), deposito: v.deposito || null, deposito_origem: v.deposito_origem || null });
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
