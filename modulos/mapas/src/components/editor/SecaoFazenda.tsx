import { Link } from 'react-router-dom';
import Aviso from '../Aviso';
import Carregando from '../Carregando';
import { usePerfil } from '../usePerfil';
import type { Fazenda, PlantioPimsTalhao, Safra, StatusPlantio } from '../../lib/types';
import SecaoPlantioPims from './SecaoPlantioPims';

export interface ResumoPlantio {
  contagem: Record<StatusPlantio, number>;
  geradoEm: string | null;
  usaAreas: boolean;
  semPoligono: PlantioPimsTalhao[];
  /** com áreas da cultura: plantados/plantando no PIMS com talhão base mas sem área da cultura */
  semArea: PlantioPimsTalhao[];
}

interface Props {
  fazendas: Fazenda[];
  safras: Safra[];
  fazendaId: string;
  safraId: string;
  onFazenda(id: string): void;
  onSafra(id: string): void;
  carregando: boolean;
  totalTalhoes: number;
  plantio: ResumoPlantio;
  setoresDisponiveis: string[];
  /** null = todos os setores */
  setores: string[] | null;
  onSetores(setores: string[] | null): void;
}

/** Seção "1. Fazenda e safra" do editor: fazenda, safra (define os plantados) e setores no mapa. */
export default function SecaoFazenda(p: Props) {
  const fazenda = p.fazendas.find((f) => f.id === p.fazendaId) ?? null;
  const safra = p.safras.find((s) => s.id === p.safraId) ?? null;
  const admin = usePerfil() === 'admin';

  const alternarSetor = (s: string, ativo: boolean) => {
    const atual = p.setores ?? p.setoresDisponiveis;
    const novo = ativo ? atual.filter((x) => x !== s) : [...atual, s];
    p.onSetores(novo.length === p.setoresDisponiveis.length || novo.length === 0 ? null : novo);
  };

  return (
    <section className="cartao pilha">
      <h2>1. Fazenda e safra</h2>
      {p.fazendas.length === 0 ? (
        <Aviso tipo="info">
          {admin ? (
            <>
              Nenhuma fazenda cadastrada. <Link to="/fazendas/nova">Cadastre a primeira fazenda</Link>.
            </>
          ) : (
            'Nenhuma fazenda de mapa liberada para você. Peça a um administrador do COA WEB.'
          )}
        </Aviso>
      ) : (
        <label className="campo">
          <span>Fazenda</span>
          <select value={p.fazendaId} onChange={(e) => p.onFazenda(e.target.value)}>
            <option value="">Escolha…</option>
            {p.fazendas.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="campo">
        <span>Safra (define a situação do plantio)</span>
        <select value={p.safraId} onChange={(e) => p.onSafra(e.target.value)}>
          <option value="">Sem safra</option>
          {p.safras.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nome}
            </option>
          ))}
        </select>
      </label>
      {p.carregando && <Carregando inline texto="Carregando talhões…" />}
      {fazenda && safra && !p.carregando && (
        <SecaoPlantioPims
          safraId={safra.id}
          fazendaId={fazenda.id}
          nomeSafra={safra.nome}
          totalTalhoes={p.totalTalhoes}
          contagem={p.plantio.contagem}
          geradoEm={p.plantio.geradoEm}
          usaAreas={p.plantio.usaAreas}
          semPoligono={p.plantio.semPoligono}
          semArea={p.plantio.semArea}
        />
      )}
      {p.setoresDisponiveis.length > 1 && (
        <div className="campo">
          <span>Setores no mapa</span>
          <div className="chips">
            {p.setoresDisponiveis.map((s) => {
              const ativo = !p.setores || p.setores.includes(s);
              return (
                <button key={s} type="button" className={`chip${ativo ? ' ativo' : ''}`} aria-pressed={ativo} onClick={() => alternarSetor(s, ativo)}>
                  {s}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
