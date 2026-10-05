import { useState } from 'react'
import type { Severidade, TipoAlerta } from '../tipos'
import { useVigiaGnss } from '../vigia/vigiaContexto'

type Filtro = 'todos' | Severidade

const FILTROS: { chave: Filtro; rotulo: string }[] = [
  { chave: 'todos', rotulo: 'Todos' },
  { chave: 'critico', rotulo: 'Críticos' },
  { chave: 'aviso', rotulo: 'Avisos' },
]

const ROTULO_TIPO: Record<TipoAlerta, string> = {
  cintilacao: 'Cintilação medida',
  previsao: 'Previsão do índice',
  janela: 'Janela de risco',
}

function quando(ms: number): string {
  return new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function AlertasPage() {
  const { alertas } = useVigiaGnss()
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const lista = filtro === 'todos' ? alertas : alertas.filter((a) => a.severidade === filtro)

  return (
    <div className="gnss-pagina">
      <header className="gnss-cabecalho">
        <div>
          <span className="gnss-sobre">Locks SAT</span>
          <h1>Alertas</h1>
          <p>Últimos 7 dias, guardados neste navegador.</p>
        </div>
      </header>

      <div className="gnss-filtros" role="group" aria-label="Filtrar por severidade">
        {FILTROS.map((f) => (
          <button
            key={f.chave}
            type="button"
            className={`gnss-chip${filtro === f.chave ? ' ativo' : ''}`}
            aria-pressed={filtro === f.chave}
            onClick={() => setFiltro(f.chave)}
          >
            {f.rotulo}
          </button>
        ))}
      </div>

      {lista.length ? (
        <div className="tabela-rolavel">
          <table className="gnss-tabela">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Tipo</th>
                <th>Severidade</th>
                <th>Fazendas</th>
                <th>Detalhe</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((a) => (
                <tr key={a.id}>
                  <td className="num">{quando(a.instante)}</td>
                  <td>{ROTULO_TIPO[a.tipo]}</td>
                  <td>
                    <span className={`gnss-badge ${a.severidade}`}>{a.severidade === 'critico' ? 'Crítico' : 'Aviso'}</span>
                  </td>
                  <td>{a.fazendas.join(', ') || '—'}</td>
                  <td>{a.texto}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="gnss-vazio">
          {alertas.length ? 'Nenhum alerta com esse filtro.' : 'Nenhum alerta nos últimos 7 dias.'}
        </div>
      )}
    </div>
  )
}
