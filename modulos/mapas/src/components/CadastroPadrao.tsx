import { useState } from 'react';
import { repo } from '../data/index';
import { carregarSeed } from '../lib/seed';
import Aviso, { mensagemDeErro, type TipoAviso } from './Aviso';
import { resumoCadastroPadrao } from './ImportarCadastroPadrao';
import Modal from './Modal';

interface Props {
  modo: 'local' | 'supabase';
  /** false no modo Supabase sem login */
  acessoDados: boolean;
}

/**
 * Configurações → "Recarregar cadastro padrão" (local) / "Importar cadastro padrão" (Supabase): as sete
 * unidades do COA, a safra SOJA 26/27 e as áreas de soja. Faz upsert: não apaga dados nem plantios.
 * Lê de public/dados/seed/ (só no desenvolvimento); no COA WEB o admin importa o zip em Fazendas.
 */
export default function CadastroPadrao({ modo, acessoDados }: Props) {
  const [confirmar, setConfirmar] = useState(false);
  const [rodando, setRodando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: TipoAviso; texto: string } | null>(null);
  const rotulo = modo === 'local' ? 'Recarregar cadastro padrão' : 'Importar cadastro padrão';

  async function executar() {
    setRodando(true);
    setMsg(null);
    try {
      const r = repo();
      setMsg(resumoCadastroPadrao(await carregarSeed(r), r.modo));
    } catch (e) {
      setMsg({ tipo: 'erro', texto: `Não foi possível carregar o cadastro padrão: ${mensagemDeErro(e)}` });
    } finally {
      setRodando(false);
      setConfirmar(false);
    }
  }

  return (
    <div className="cartao pilha">
      <h2>Cadastro padrão do COA</h2>
      <p className="suave">
        As sete unidades (limites dos talhões com o código do PIMS), a safra SOJA 26/27 e as áreas de soja. Reaproveita o que já existe:
        fazendas renomeadas, nomes de talhões e plantios marcados são mantidos; as áreas da cultura do cadastro padrão são substituídas.
      </p>
      {!acessoDados && <Aviso tipo="info">Entre com o seu e-mail para importar o cadastro padrão.</Aviso>}
      {msg && (
        <Aviso tipo={msg.tipo} onFechar={() => setMsg(null)}>
          {msg.texto}
          {msg.tipo === 'erro' && acessoDados && (
            <div className="linha" style={{ marginTop: 6 }}>
              <button type="button" className="botao botao-pequeno" onClick={() => void executar()} disabled={rodando}>
                {rodando ? 'Carregando…' : 'Tentar de novo'}
              </button>
            </div>
          )}
        </Aviso>
      )}
      <div className="linha">
        <button type="button" className="botao" onClick={() => setConfirmar(true)} disabled={rodando || !acessoDados}>
          {rodando ? 'Carregando…' : rotulo}
        </button>
      </div>
      <Modal
        aberto={confirmar}
        titulo={rotulo}
        onFechar={() => !rodando && setConfirmar(false)}
        acoes={
          <>
            <button type="button" className="botao" onClick={() => setConfirmar(false)} disabled={rodando}>
              Cancelar
            </button>
            <button type="button" className="botao botao-primario" onClick={() => void executar()} disabled={rodando}>
              {rodando ? 'Carregando…' : 'Carregar'}
            </button>
          </>
        }
      >
        <p>
          Carregar o cadastro padrão do COA {modo === 'local' ? 'neste navegador' : 'no Supabase (para toda a equipe)'}?
        </p>
        <p className="suave">
          As unidades, os talhões e a safra SOJA 26/27 são atualizados pelo cadastro padrão sem apagar os seus dados. As áreas da cultura
          dessas unidades na SOJA 26/27 são substituídas pelas do cadastro padrão.
        </p>
      </Modal>
    </div>
  );
}
