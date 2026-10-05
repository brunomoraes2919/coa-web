/**
 * Faixa do topo do módulo: a marca e o selo de conexão com a Trimble. Dentro do COA WEB o
 * menu é o do site; fora dele (aberto direto), a faixa ganha os três links.
 */
import { NavLink } from 'react-router-dom'
import logo from '../assets/logo-locks-sat-verde.png'
import { emEmbed } from '../lib/embed'
import { horaDe } from '../logic/tempo'
import { useVigiaGnss } from '../vigia/vigiaContexto'

const LINKS = [
  { to: '/hoje', rotulo: 'Hoje' },
  { to: '/mapa', rotulo: 'Mapa' },
  { to: '/alertas', rotulo: 'Alertas' },
]

export default function Topo() {
  const { estado } = useVigiaGnss()
  // Em erro, a hora do último dado: "sem dados" há 5 min e há 5 h pedem reações diferentes.
  const selo = estado.erro
    ? {
        classe: 'erro',
        texto: estado.ultimoSucesso ? `SEM DADOS DA TRIMBLE DESDE ${horaDe(estado.ultimoSucesso)}` : 'SEM DADOS DA TRIMBLE',
      }
    : estado.ultimoSucesso
      ? { classe: 'ok', texto: `ATUALIZADO ${horaDe(estado.ultimoSucesso)}` }
      : { classe: '', texto: 'AGUARDANDO DADOS' }

  return (
    <header className="sat-topo">
      <img className="sat-topo-logo" src={logo} alt="Locks SAT" />
      {!emEmbed() && (
        <nav className="sat-topo-nav" aria-label="Telas do Locks SAT">
          {LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} className={({ isActive }) => (isActive ? 'ativo' : '')}>
              {l.rotulo}
            </NavLink>
          ))}
        </nav>
      )}
      <span className={`gnss-selo-conexao ${selo.classe}`} aria-live="polite">{selo.texto}</span>
    </header>
  )
}
