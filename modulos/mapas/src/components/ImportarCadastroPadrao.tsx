import { useRef, useState, type ReactNode } from 'react';
import { repo } from '../data/index';
import { carregarSeed, leitorDeZip } from '../lib/seed';
import type { ResultadoSeed } from '../lib/types';
import Aviso, { mensagemDeErro, type TipoAviso } from './Aviso';
import Carregando from './Carregando';

const fmt = (n: number) => n.toLocaleString('pt-BR');
const contagem = (n: number, um: string, varios: string) => `${fmt(n)} ${n === 1 ? um : varios}`;

/** Aviso com o resultado do cadastro padrão (Fazendas → importar o zip; Configurações → recarregar). */
export function resumoCadastroPadrao(r: ResultadoSeed, modo: 'local' | 'supabase'): { tipo: TipoAviso; texto: string } {
  const importadas = contagem(r.fazendas, 'unidade importada', 'unidades importadas');
  const detalhes = `${contagem(r.talhoes, 'talhão', 'talhões')} e ${contagem(r.areas, 'área', 'áreas')} da cultura`;
  if (modo === 'local') {
    return { tipo: 'sucesso', texto: `${importadas} (${detalhes}). Modo local: não há fazendas do COA WEB para ligar.` };
  }
  const ligadas = `${fmt(r.ligadas)} ${r.ligadas === 1 ? 'ligada' : 'ligadas'} ao COA WEB`;
  if (r.semVinculo.length === 0) return { tipo: 'sucesso', texto: `${importadas}, ${ligadas} (${detalhes}).` };
  return {
    tipo: 'alerta',
    texto:
      `${importadas}, ${ligadas} (${detalhes}). Sem vínculo (só administradores veem): ${r.semVinculo.join(', ')}. ` +
      'Escolha a fazenda do COA WEB em Editar → "Fazenda no COA WEB".',
  };
}

/**
 * Fazendas → "Importar cadastro padrão": o admin escolhe o cadastro-padrao-mapas.zip (npm run
 * pacote-seed) e tudo é gravado pelo repositório atual (no Supabase, com a sessão dele e o RLS).
 * Devolve o botão (para o cabeçalho) e o aviso de andamento/resultado (para o corpo da tela).
 * `onTerminar` roda ao fim, com sucesso ou não (uma falha no meio pode ter gravado parte do cadastro).
 */
export function useImportarCadastroPadrao(onTerminar: () => void): { botao: ReactNode; aviso: ReactNode } {
  const entrada = useRef<HTMLInputElement>(null);
  const [andamento, setAndamento] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tipo: TipoAviso; texto: string } | null>(null);

  async function importar(arquivo: File) {
    setMsg(null);
    setAndamento('Abrindo o arquivo…');
    try {
      const r = repo();
      const resultado = await carregarSeed(r, await leitorDeZip(arquivo), { aoAvancar: setAndamento });
      setMsg(resumoCadastroPadrao(resultado, r.modo));
    } catch (e) {
      setMsg({ tipo: 'erro', texto: `Não foi possível importar o cadastro padrão: ${mensagemDeErro(e)}` });
    } finally {
      setAndamento(null);
      onTerminar();
    }
  }

  const botao = (
    <>
      <button
        type="button"
        className="botao"
        onClick={() => entrada.current?.click()}
        disabled={andamento !== null}
        title="Escolha o cadastro-padrao-mapas.zip: as sete unidades, a safra SOJA 26/27 e as áreas de soja. Não apaga dados; liga cada unidade à fazenda do COA WEB de mesmo nome."
      >
        {andamento !== null ? 'Importando…' : 'Importar cadastro padrão'}
      </button>
      <input
        ref={entrada}
        type="file"
        accept=".zip,application/zip,application/x-zip-compressed"
        hidden
        onChange={(e) => {
          const arquivo = e.target.files?.[0];
          e.target.value = ''; // permite escolher o mesmo arquivo de novo
          if (arquivo) void importar(arquivo);
        }}
      />
    </>
  );

  const aviso =
    andamento !== null ? (
      <Aviso tipo="info" titulo="Importando o cadastro padrão">
        <Carregando inline texto={`${andamento} Não feche esta página até terminar.`} />
      </Aviso>
    ) : msg ? (
      <Aviso tipo={msg.tipo} onFechar={() => setMsg(null)}>
        {msg.texto}
      </Aviso>
    ) : null;

  return { botao, aviso };
}
