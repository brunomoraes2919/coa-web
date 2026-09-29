import { useEffect, useRef, useState, type FormEvent } from 'react';
import { repo } from '../data/index';
import type { Fazenda, Safra } from '../lib/types';
import Aviso, { mensagemDeErro } from '../components/Aviso';
import AtualizarPlantio from '../components/AtualizarPlantio';
import Carregando from '../components/Carregando';
import Modal from '../components/Modal';
import CartaoSafra from '../components/safras/CartaoSafra';
import { useResumoSafras } from '../components/safras/useResumoSafras';

const CULTURAS = ['SOJA', 'MILHO', 'ALGODÃO', 'FEIJÃO', 'SORGO'];
const OUTRA = 'OUTRA';

/** Ano agrícola atual: de julho em diante "26/27", antes "25/26". */
function anoSafraPadrao(hoje = new Date()): { ano: string; inicio: string; fim: string } {
  const a = hoje.getMonth() >= 6 ? hoje.getFullYear() : hoje.getFullYear() - 1;
  const yy = (n: number) => String(n % 100).padStart(2, '0');
  return { ano: `${yy(a)}/${yy(a + 1)}`, inicio: `${a}-09-01`, fim: `${a + 1}-08-31` };
}

interface Form {
  id: string | null;
  cultura: string;
  culturaOutra: string;
  anoSafra: string;
  inicio: string;
  fim: string;
  nome: string;
  nomeManual: boolean;
  /** nome no PIMS; vazio = igual ao nome da safra */
  nomePims: string;
}

function formNovo(): Form {
  const p = anoSafraPadrao();
  return { id: null, cultura: 'SOJA', culturaOutra: '', anoSafra: p.ano, inicio: p.inicio, fim: p.fim, nome: '', nomeManual: false, nomePims: '' };
}

function formDe(s: Safra): Form {
  const conhecida = CULTURAS.includes(s.cultura);
  return {
    id: s.id,
    cultura: conhecida ? s.cultura : OUTRA,
    culturaOutra: conhecida ? '' : s.cultura,
    anoSafra: s.anoSafra,
    inicio: s.inicio,
    fim: s.fim,
    nome: s.nome,
    nomeManual: s.nome !== `${s.cultura} ${s.anoSafra}`,
    nomePims: s.nomePims && s.nomePims !== s.nome ? s.nomePims : '',
  };
}

const culturaDe = (f: Form) => (f.cultura === OUTRA ? f.culturaOutra.trim().toUpperCase() : f.cultura);
const nomeAuto = (f: Form) => `${culturaDe(f)} ${f.anoSafra.trim()}`.trim();

export default function Safras() {
  const [safras, setSafras] = useState<Safra[] | null>(null);
  const [fazendas, setFazendas] = useState<Fazenda[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [excluir, setExcluir] = useState<Safra | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const chaveForm = form ? (form.id ?? 'nova') : null;
  const { linhas, erro: erroResumo } = useResumoSafras(safras, fazendas);

  // em telas estreitas o formulário fica abaixo da lista: traz para a vista ao abrir
  useEffect(() => {
    if (chaveForm) formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [chaveForm]);

  async function carregar() {
    try {
      const r = repo();
      const [ss, fs] = await Promise.all([r.listarSafras(), r.listarFazendas()]);
      ss.sort((a, b) => b.inicio.localeCompare(a.inicio) || a.nome.localeCompare(b.nome, 'pt-BR'));
      fs.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
      setSafras(ss);
      setFazendas(fs);
    } catch (e) {
      setErro(`Não foi possível carregar as safras: ${mensagemDeErro(e)}`);
      setSafras([]);
    }
  }

  useEffect(() => {
    void carregar();
  }, []);

  const alterar = (p: Partial<Form>) => setForm((f) => (f ? { ...f, ...p } : f));
  const nomeExibido = form ? (form.nomeManual ? form.nome : nomeAuto(form)) : '';

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    const cultura = culturaDe(form);
    const anoSafra = form.anoSafra.trim();
    const nome = nomeExibido.trim();
    if (!cultura) return setErroForm('Informe a cultura.');
    if (!anoSafra) return setErroForm('Informe o ano safra (ex.: 26/27).');
    if (!form.inicio || !form.fim) return setErroForm('Informe o início e o fim do período da safra.');
    if (form.fim < form.inicio) return setErroForm('O fim da safra deve ser depois do início.');
    if (!nome) return setErroForm('Informe o nome da safra.');
    if ((safras ?? []).some((s) => s.id !== form.id && s.nome.toLowerCase() === nome.toLowerCase())) {
      return setErroForm(`Já existe uma safra chamada "${nome}".`);
    }
    setErroForm(null);
    setSalvando(true);
    try {
      const nomePims = form.nomePims.trim().toUpperCase() || nome;
      const safra: Safra = { id: form.id ?? crypto.randomUUID(), nome, cultura, anoSafra, inicio: form.inicio, fim: form.fim, nomePims };
      await repo().salvarSafra(safra);
      setSucesso(form.id ? `Safra "${nome}" atualizada.` : `Safra "${nome}" criada. Agora marque os talhões plantados.`);
      setForm(null);
      await carregar();
    } catch (err) {
      setErroForm(`Não foi possível salvar: ${mensagemDeErro(err)}`);
    } finally {
      setSalvando(false);
    }
  }

  async function confirmarExclusao() {
    if (!excluir) return;
    setExcluindo(true);
    try {
      await repo().excluirSafra(excluir.id);
      setSucesso(`Safra "${excluir.nome}" excluída.`);
      if (form?.id === excluir.id) setForm(null);
      await carregar();
    } catch (e) {
      setErro(`Não foi possível excluir: ${mensagemDeErro(e)}`);
    } finally {
      setExcluindo(false);
      setExcluir(null);
    }
  }

  return (
    <div className="pagina">
      <AtualizarPlantio />
      <div className="pagina-cabecalho">
        <div>
          <h1>Safras</h1>
          <p className="subtitulo">Cultura, ano e período de cada safra, o plantio e as áreas da cultura por fazenda.</p>
        </div>
        <button
          type="button"
          className="botao botao-primario"
          onClick={() => {
            setErroForm(null);
            setForm(formNovo());
          }}
        >
          + Nova safra
        </button>
      </div>

      {sucesso && (
        <Aviso tipo="sucesso" onFechar={() => setSucesso(null)}>
          {sucesso}
        </Aviso>
      )}
      {erro && (
        <Aviso tipo="erro" onFechar={() => setErro(null)}>
          {erro}
        </Aviso>
      )}

      <div className={form ? 'grade-lado' : 'pilha'}>
        <div className="pilha safras-lista">
          {safras === null ? (
            <div className="cartao">
              <Carregando texto="Carregando safras…" />
            </div>
          ) : safras.length === 0 ? (
            <div className="cartao vazio">
              <p>Nenhuma safra cadastrada. Crie a primeira, por exemplo "SOJA {anoSafraPadrao().ano}".</p>
            </div>
          ) : (
            <>
              {erroResumo && <Aviso tipo="alerta">{erroResumo}</Aviso>}
              {safras.map((s) => (
                <CartaoSafra
                  key={s.id}
                  safra={s}
                  fazendas={fazendas}
                  linhas={linhas}
                  onEditar={() => {
                    setErroForm(null);
                    setForm(formDe(s));
                  }}
                  onExcluir={() => setExcluir(s)}
                />
              ))}
            </>
          )}
        </div>

        {form && (
          <form ref={formRef} className="cartao pilha fixo" onSubmit={salvar}>
            <h2>{form.id ? 'Editar safra' : 'Nova safra'}</h2>
            <div className="grade-2">
              <label className="campo">
                <span>Cultura</span>
                <select value={form.cultura} onChange={(e) => alterar({ cultura: e.target.value })}>
                  {CULTURAS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                  <option value={OUTRA}>OUTRA…</option>
                </select>
              </label>
              <label className="campo">
                <span>Ano safra</span>
                <input
                  type="text"
                  value={form.anoSafra}
                  placeholder="26/27"
                  onChange={(e) => alterar({ anoSafra: e.target.value })}
                />
              </label>
            </div>
            {form.cultura === OUTRA && (
              <label className="campo">
                <span>Nome da cultura</span>
                <input
                  type="text"
                  value={form.culturaOutra}
                  placeholder="Ex.: TRIGO"
                  onChange={(e) => alterar({ culturaOutra: e.target.value })}
                />
              </label>
            )}
            <div className="grade-2">
              <label className="campo">
                <span>Início</span>
                <input type="date" value={form.inicio} onChange={(e) => alterar({ inicio: e.target.value })} />
              </label>
              <label className="campo">
                <span>Fim</span>
                <input type="date" value={form.fim} onChange={(e) => alterar({ fim: e.target.value })} />
              </label>
            </div>
            <label className="campo">
              <span>Nome da safra</span>
              <input
                type="text"
                value={nomeExibido}
                onChange={(e) => alterar({ nome: e.target.value, nomeManual: e.target.value.trim() !== '' })}
              />
              <small>
                {form.nomeManual ? (
                  <button type="button" className="botao-link" onClick={() => alterar({ nomeManual: false, nome: '' })}>
                    Usar o nome automático ({nomeAuto(form)})
                  </button>
                ) : (
                  'Preenchido automaticamente com a cultura e o ano; pode ser editado.'
                )}
              </small>
            </label>
            <label className="campo">
              <span>Nome no PIMS</span>
              <input
                type="text"
                value={form.nomePims}
                placeholder={nomeExibido || 'SOJA 26/27'}
                onChange={(e) => alterar({ nomePims: e.target.value })}
              />
              <small>Como a safra se chama no PIMS (PERIODOSAFRA). Vazio = igual ao nome da safra.</small>
            </label>
            {erroForm && <Aviso tipo="erro">{erroForm}</Aviso>}
            <div className="linha linha-fim">
              <button type="button" className="botao" onClick={() => setForm(null)} disabled={salvando}>
                Cancelar
              </button>
              <button type="submit" className="botao botao-primario" disabled={salvando}>
                {salvando ? 'Salvando…' : 'Salvar safra'}
              </button>
            </div>
          </form>
        )}
      </div>

      <Modal
        aberto={excluir !== null}
        titulo="Excluir safra"
        onFechar={() => !excluindo && setExcluir(null)}
        acoes={
          <>
            <button type="button" className="botao" onClick={() => setExcluir(null)} disabled={excluindo}>
              Cancelar
            </button>
            <button type="button" className="botao botao-perigo-cheio" onClick={confirmarExclusao} disabled={excluindo}>
              {excluindo ? 'Excluindo…' : 'Excluir'}
            </button>
          </>
        }
      >
        <p>
          Excluir a safra <strong>{excluir?.nome}</strong>?
        </p>
        <p className="suave">Os talhões marcados como plantados nesta safra também serão desmarcados.</p>
      </Modal>
    </div>
  );
}
