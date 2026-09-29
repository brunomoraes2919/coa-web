import { useRef, useState } from 'react';
import { lerConfig, salvarConfig, testarConexao, type AppConfig } from '../data/config';
import { repo, type BackupJson } from '../data/index';
import Aviso, { mensagemDeErro, type TipoAviso } from '../components/Aviso';
import Modal from '../components/Modal';
import CadastroPadrao from '../components/CadastroPadrao';
import { isoData } from '../lib/format';

interface Mensagem {
  tipo: TipoAviso;
  texto: string;
}


/** "1 fazenda", "2 fazendas" */
const qtd = (n: number, singular: string, plural: string) => `${n} ${n === 1 ? singular : plural}`;

function validarBackup(x: unknown): BackupJson {
  const b = x as Partial<BackupJson> | null;
  const listas = ['fazendas', 'talhoes', 'safras', 'plantios', 'mapas'] as const;
  if (!b || typeof b !== 'object' || b.versao !== 1 || listas.some((k) => !Array.isArray(b[k]))) {
    throw new Error('Arquivo de backup inválido: esperado um JSON exportado por este aplicativo (versão 1).');
  }
  return b as BackupJson;
}

interface Props {
  /** false no modo Supabase sem login: o backup precisa de acesso aos dados */
  acessoDados?: boolean;
}

export default function Configuracoes({ acessoDados = true }: Props) {
  const [atual] = useState<AppConfig>(() => lerConfig());
  const [cfg, setCfg] = useState<AppConfig>(atual);
  const [msgConexao, setMsgConexao] = useState<Mensagem | null>(null);
  const [testando, setTestando] = useState(false);
  const [msgBackup, setMsgBackup] = useState<Mensagem | null>(null);
  const [exportando, setExportando] = useState(false);
  const [backup, setBackup] = useState<BackupJson | null>(null);
  const [importando, setImportando] = useState(false);
  const arquivoRef = useRef<HTMLInputElement>(null);

  const alterar = (p: Partial<AppConfig>) => {
    setCfg((c) => ({ ...c, ...p }));
    setMsgConexao(null);
  };

  function validarSupabase(): string | null {
    if (cfg.modo !== 'supabase') return null;
    if (!cfg.supabaseUrl.trim() || !cfg.supabaseKey.trim()) return 'Informe a URL do projeto e a chave anon.';
    if (!/^https?:\/\/\S+$/i.test(cfg.supabaseUrl.trim())) return 'A URL deve começar com https://';
    return null;
  }

  const limpa = (): AppConfig => ({ ...cfg, supabaseUrl: cfg.supabaseUrl.trim(), supabaseKey: cfg.supabaseKey.trim() });

  async function testar() {
    const invalido = validarSupabase();
    if (invalido) return setMsgConexao({ tipo: 'erro', texto: invalido });
    setTestando(true);
    setMsgConexao(null);
    try {
      await testarConexao(limpa());
      setMsgConexao({ tipo: 'sucesso', texto: 'Conexão com o Supabase funcionando.' });
    } catch (e) {
      setMsgConexao({ tipo: 'erro', texto: mensagemDeErro(e) });
    } finally {
      setTestando(false);
    }
  }

  function salvar() {
    const invalido = validarSupabase();
    if (invalido) return setMsgConexao({ tipo: 'erro', texto: invalido });
    salvarConfig(limpa());
    // recarrega para recriar o repositório no novo modo
    window.location.hash = cfg.modo === 'supabase' ? '#/login' : '#/config';
    window.location.reload();
  }

  async function exportar() {
    setExportando(true);
    setMsgBackup(null);
    try {
      const b = await repo().exportarBackup();
      const blob = new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup-mapa-chuva-coa-${isoData(new Date())}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMsgBackup({
        tipo: 'sucesso',
        texto: `Backup exportado: ${qtd(b.fazendas.length, 'fazenda', 'fazendas')}, ${qtd(b.safras.length, 'safra', 'safras')} e ${qtd(b.mapas.length, 'mapa', 'mapas')}.`,
      });
    } catch (e) {
      setMsgBackup({ tipo: 'erro', texto: `Não foi possível exportar: ${mensagemDeErro(e)}` });
    } finally {
      setExportando(false);
    }
  }

  async function lerArquivo(f: File | undefined) {
    if (arquivoRef.current) arquivoRef.current.value = '';
    if (!f) return;
    setMsgBackup(null);
    try {
      setBackup(validarBackup(JSON.parse(await f.text())));
    } catch (e) {
      const texto = e instanceof SyntaxError ? 'O arquivo não é um JSON válido.' : mensagemDeErro(e);
      setMsgBackup({ tipo: 'erro', texto });
    }
  }

  async function importar() {
    if (!backup) return;
    setImportando(true);
    try {
      await repo().importarBackup(backup);
      setMsgBackup({ tipo: 'sucesso', texto: 'Backup importado com sucesso.' });
    } catch (e) {
      setMsgBackup({ tipo: 'erro', texto: `Não foi possível importar: ${mensagemDeErro(e)}` });
    } finally {
      setImportando(false);
      setBackup(null);
    }
  }

  const alterado =
    cfg.modo !== atual.modo || cfg.supabaseUrl !== atual.supabaseUrl || cfg.supabaseKey !== atual.supabaseKey;
  const nomeModo = atual.modo === 'local' ? 'Local' : 'Supabase';

  return (
    <div className="pagina">
      <div className="pagina-cabecalho">
        <div>
          <h1>Configurações</h1>
          <p className="subtitulo">
            Modo ativo: <strong>{nomeModo}</strong>
            {atual.modo === 'local' ? ' — os dados ficam salvos neste navegador.' : ` — ${atual.supabaseUrl}`}
          </p>
        </div>
      </div>

      <div className="cartao pilha">
        <h2>Onde guardar os dados</h2>
        <div className="opcoes" role="radiogroup" aria-label="Modo de armazenamento">
          <label className={cfg.modo === 'local' ? 'opcao marcada' : 'opcao'}>
            <input type="radio" name="modo" checked={cfg.modo === 'local'} onChange={() => alterar({ modo: 'local' })} />
            <span>
              <strong>Local</strong>
              <span className="suave">Só neste navegador (IndexedDB). Não precisa de login.</span>
            </span>
          </label>
          <label className={cfg.modo === 'supabase' ? 'opcao marcada' : 'opcao'}>
            <input
              type="radio"
              name="modo"
              checked={cfg.modo === 'supabase'}
              onChange={() => alterar({ modo: 'supabase' })}
            />
            <span>
              <strong>Supabase</strong>
              <span className="suave">Banco na nuvem, compartilhado pela equipe, com login por e-mail e senha.</span>
            </span>
          </label>
        </div>

        {cfg.modo === 'supabase' && (
          <div className="grade-2">
            <label className="campo">
              <span>URL do projeto</span>
              <input
                type="url"
                value={cfg.supabaseUrl}
                placeholder="https://xxxxxxxx.supabase.co"
                onChange={(e) => alterar({ supabaseUrl: e.target.value })}
              />
            </label>
            <label className="campo">
              <span>Chave anon (pública)</span>
              <input
                type="text"
                value={cfg.supabaseKey}
                placeholder="eyJhbGciOi…"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => alterar({ supabaseKey: e.target.value })}
              />
            </label>
          </div>
        )}

        {msgConexao && <Aviso tipo={msgConexao.tipo}>{msgConexao.texto}</Aviso>}

        <div className="linha linha-fim">
          {cfg.modo === 'supabase' && (
            <button type="button" className="botao" onClick={testar} disabled={testando}>
              {testando ? 'Testando…' : 'Testar conexão'}
            </button>
          )}
          <button type="button" className="botao botao-primario" onClick={salvar} disabled={!alterado}>
            Salvar e recarregar
          </button>
        </div>

        {cfg.modo === 'supabase' && (
          <Aviso tipo="info" titulo="Como ligar ao Supabase do COA WEB">
            <ol className="passos">
              <li>
                No <em>SQL Editor</em> do projeto Supabase do COA WEB, rode o conteúdo de{' '}
                <span className="codigo">supabase/coa-web/0001_mapas.sql</span> (cria só objetos novos: as tabelas{' '}
                <span className="codigo">mapas_*</span>, as regras de acesso e o bucket{' '}
                <span className="codigo">mapas-chuva</span>; não altera nada do COA WEB).
              </li>
              <li>
                Em <em>Project Settings → API</em>, copie a <em>Project URL</em> e a chave <em>anon public</em> para os
                campos acima.
              </li>
              <li>Salve e entre com o seu e-mail e senha do COA WEB. O passo a passo completo está no README.</li>
            </ol>
          </Aviso>
        )}
        {cfg.modo === 'supabase' && (
          <Aviso tipo="info" titulo="Quem vê o quê">
            As permissões são as do COA WEB: o admin vê e altera tudo; o colaborador vê as fazendas liberadas para ele
            e nelas salva e exclui mapas de chuva. Fazendas, talhões, safras e plantio só o admin altera. Uma fazenda de
            mapa sem vínculo com uma fazenda do COA WEB só aparece para o admin.
          </Aviso>
        )}
      </div>

      <div className="cartao pilha">
        <h2>Backup</h2>
        <p className="suave">
          O backup em JSON guarda fazendas, talhões, safras, plantios e o histórico de mapas (sem as imagens). Serve
          também para migrar do modo local para o Supabase: exporte no modo local, troque o modo e importe.
        </p>
        {atual.modo === 'local' && (
          <p className="suave">
            No modo local, exporte o backup com frequência: os dados ficam só neste navegador e neste endereço, e podem
            se perder se o navegador limpar os dados do site.
          </p>
        )}
        {!acessoDados && <Aviso tipo="info">Entre com o seu e-mail para exportar ou importar o backup.</Aviso>}
        {msgBackup && (
          <Aviso tipo={msgBackup.tipo} onFechar={() => setMsgBackup(null)}>
            {msgBackup.texto}
          </Aviso>
        )}
        <div className="linha">
          <button type="button" className="botao" onClick={exportar} disabled={exportando || !acessoDados}>
            {exportando ? 'Exportando…' : 'Exportar backup (JSON)'}
          </button>
          <button type="button" className="botao" onClick={() => arquivoRef.current?.click()} disabled={importando || !acessoDados}>
            {importando ? 'Importando…' : 'Importar backup'}
          </button>
          <input
            ref={arquivoRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => void lerArquivo(e.target.files?.[0])}
          />
        </div>
      </div>

      <CadastroPadrao modo={atual.modo} acessoDados={acessoDados} />

      <Modal
        aberto={backup !== null}
        titulo="Importar backup"
        onFechar={() => !importando && setBackup(null)}
        acoes={
          <>
            <button type="button" className="botao" onClick={() => setBackup(null)} disabled={importando}>
              Cancelar
            </button>
            <button type="button" className="botao botao-primario" onClick={importar} disabled={importando}>
              {importando ? 'Importando…' : 'Importar'}
            </button>
          </>
        }
      >
        {backup && (
          <>
            <p>
              Importar para o modo <strong>{nomeModo}</strong>: {qtd(backup.fazendas.length, 'fazenda', 'fazendas')},{' '}
              {qtd(backup.talhoes.length, 'talhão', 'talhões')}, {qtd(backup.safras.length, 'safra', 'safras')},{' '}
              {qtd(backup.plantios.length, 'plantio', 'plantios')} e {qtd(backup.mapas.length, 'mapa', 'mapas')}?
            </p>
            <p className="suave">Registros com o mesmo identificador serão substituídos pelos do arquivo.</p>
          </>
        )}
      </Modal>
    </div>
  );
}
