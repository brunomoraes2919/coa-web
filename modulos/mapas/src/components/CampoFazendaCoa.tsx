import type { FazendaCoa } from '../lib/types';

interface Props {
  /** fazendas do COA WEB (repo.listarFazendasCoa()); vazia → o campo não aparece (modo local) */
  fazendas: FazendaCoa[];
  valor: number | null;
  onValor(id: number | null): void;
}

/**
 * "Fazenda no COA WEB": define quem vê esta fazenda de mapa (quem tem acesso à fazenda no COA WEB);
 * sem vínculo, só administradores veem. Um vínculo que não está na lista (fazenda removida ou fora do
 * alcance) continua como opção, para não se perder ao salvar outras alterações.
 */
export default function CampoFazendaCoa({ fazendas, valor, onValor }: Props) {
  if (fazendas.length === 0) return null;
  const naLista = valor === null || fazendas.some((f) => f.id === valor);
  return (
    <label className="campo">
      <span>Fazenda no COA WEB</span>
      <select value={valor === null ? '' : String(valor)} onChange={(e) => onValor(e.target.value === '' ? null : Number(e.target.value))}>
        <option value="">Sem vínculo — só administradores veem</option>
        {!naLista && <option value={String(valor)}>Fazenda nº {valor} (não encontrada no COA WEB)</option>}
        {fazendas.map((f) => (
          <option key={f.id} value={String(f.id)}>
            {f.nome}
          </option>
        ))}
      </select>
      <small>Quem tem acesso a essa fazenda no COA WEB vê esta fazenda e os mapas dela.</small>
    </label>
  );
}
