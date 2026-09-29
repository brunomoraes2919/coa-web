import type { LayoutTextos } from '../../lib/types';

interface Props {
  textos: LayoutTextos;
  /** campos que o usuário alterou (os demais seguem o preenchimento automático) */
  editados: Partial<LayoutTextos>;
  onChange(campo: keyof LayoutTextos, valor: string): void;
  onRestaurar(): void;
}

const CAMPOS: { id: keyof LayoutTextos; rotulo: string; dica?: string }[] = [
  { id: 'titulo', rotulo: 'Título', dica: 'Use Enter para quebrar a linha' },
  { id: 'fazenda', rotulo: 'Fazenda' },
  { id: 'safra', rotulo: 'Safra' },
  { id: 'periodo', rotulo: 'Período' },
  { id: 'fonte', rotulo: 'Fonte de informação' },
  { id: 'talhoes', rotulo: 'Talhões' },
  { id: 'setor', rotulo: 'Setor' },
  { id: 'observacao', rotulo: 'Observação (opcional)' },
  { id: 'data', rotulo: 'Data' },
];

/** Textos do painel lateral do layout. Preenchidos sozinhos; qualquer campo pode ser editado. */
export default function PainelTextos({ textos, editados, onChange, onRestaurar }: Props) {
  const algumEditado = Object.keys(editados).length > 0;
  return (
    <div className="pilha">
      <div className="grade-textos">
        {CAMPOS.map((c) => (
          <label key={c.id} className={`campo${c.id === 'titulo' || c.id === 'observacao' ? ' campo-largo' : ''}`}>
            <span>
              {c.rotulo}
              {editados[c.id] !== undefined && <em className="editado"> · editado</em>}
            </span>
            {c.id === 'titulo' || c.id === 'observacao' ? (
              <textarea rows={2} value={textos[c.id]} onChange={(e) => onChange(c.id, e.target.value)} />
            ) : (
              <input type="text" value={textos[c.id]} onChange={(e) => onChange(c.id, e.target.value)} />
            )}
            {c.dica && <small>{c.dica}</small>}
          </label>
        ))}
      </div>
      {algumEditado && (
        <div>
          <button type="button" className="botao botao-pequeno" onClick={onRestaurar}>
            Restaurar textos automáticos
          </button>
        </div>
      )}
    </div>
  );
}
