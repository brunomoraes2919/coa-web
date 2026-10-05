import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import AjudaGnss from '../componentes/AjudaGnss'
import BotaoNotificacao from '../componentes/BotaoNotificacao'
import GuiaRtk from '../componentes/GuiaRtk'
import LinhaDoTempo from '../componentes/LinhaDoTempo'
import { janelaAindaPorVir, textoJanela } from '../logic/janelaRisco'
import { COR_NIVEL, corDoIndice, picoPrevisto, ROTULO_NIVEL } from '../logic/niveis'
import { horaDe, minutoDoDia } from '../logic/tempo'
import type { NivelCintilacao } from '../tipos'
import { nivelAtual, type NivelAtual } from '../vigia/avaliar'
import { useVigiaGnss } from '../vigia/vigiaContexto'

const ORDEM: Record<NivelCintilacao, number> = { forte: 0, media: 1, minima: 2, 'sem-dado': 3 }

function textoAtual(atual: NivelAtual): string {
  if (atual.valor == null || atual.instante == null) return 'Sem medida recente'
  return `${Math.round(atual.valor)} de 100 · ${horaDe(atual.instante)}`
}

export default function HojePage() {
  const { estado, lider, atualizar } = useVigiaGnss()
  const [agora, setAgora] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setAgora(Date.now()), 60_000)
    return () => window.clearInterval(t)
  }, [])

  const cards = useMemo(() => {
    const minuto = minutoDoDia(agora)
    return estado.fazendas
      .map((fazenda) => {
        const dados = fazenda.celulaId ? estado.celulas[fazenda.celulaId] : undefined
        return {
          fazenda,
          dados,
          atual: nivelAtual(estado, fazenda.celulaId, agora),
          pico: dados ? picoPrevisto(dados.serie, agora) : null,
          janelas: (dados?.janelas ?? []).filter((j) => janelaAindaPorVir(j, minuto)),
        }
      })
      .sort((a, b) =>
        Number(!a.fazenda.celulaId) - Number(!b.fazenda.celulaId) ||
        ORDEM[a.atual.nivel] - ORDEM[b.atual.nivel] ||
        a.fazenda.nome.localeCompare(b.fazenda.nome, 'pt-BR'))
  }, [estado, agora])

  return (
    <div className="gnss-pagina">
      <header className="gnss-cabecalho">
        <div>
          <span className="gnss-sobre">Locks SAT</span>
          <h1>Hoje</h1>
          <p>
            Cintilação medida a cada 10 min, previsão do índice ionosférico e janelas de risco pelos últimos
            7 dias, em todas as fazendas.
          </p>
        </div>
        <div className="gnss-acoes">
          <GuiaRtk />
          <BotaoNotificacao />
          <button
            type="button"
            className="gnss-btn gnss-atualizar"
            onClick={atualizar}
            disabled={!lider}
            title={lider ? 'Consultar a Trimble agora' : 'Outra aba aberta é quem consulta a Trimble'}
          >
            Atualizar
          </button>
        </div>
      </header>

      {estado.erro && (
        <div className="gnss-faixa-erro" role="status">
          {/* Não "alertas pausados": janelas e a previsão já baixada seguem avisando. */}
          Sem dados da Trimble {estado.ultimoSucesso ? `desde ${horaDe(estado.ultimoSucesso)}` : 'ainda'} — sem medida
          nova até a conexão voltar. Nova tentativa em alguns minutos.
        </div>
      )}

      <div className="gnss-temas">
        <span>Cintilação <AjudaGnss tema="cintilacao" /></span>
        <span>Índice ionosférico <AjudaGnss tema="indice" /></span>
        <span>Janela de risco <AjudaGnss tema="janela" /></span>
        <span>TEC <AjudaGnss tema="tec" /></span>
      </div>

      {/* A lista vem do cadastro do COA WEB: se vier vazia, "carregando" ficaria para sempre sem dizer o porquê. */}
      {!estado.fazendas.length && (
        <div className="gnss-vazio">
          Carregando as fazendas… Se não aparecerem, confira se há fazendas liberadas para o seu usuário no COA WEB.
        </div>
      )}

      <div className="gnss-cards">
        {cards.map(({ fazenda, dados, atual, pico, janelas }) => (
          <article key={fazenda.id} className="gnss-card">
            <header>
              <h2>{fazenda.nome}</h2>
              <span
                className="gnss-selo"
                style={{ '--cor': COR_NIVEL[fazenda.celulaId ? atual.nivel : 'sem-dado'] } as CSSProperties}
              >
                {fazenda.celulaId ? ROTULO_NIVEL[atual.nivel] : 'Sem localização'}
              </span>
            </header>
            {fazenda.celulaId ? (
              <>
                <dl className="gnss-kv">
                  <div>
                    <dt>Cintilação agora <AjudaGnss tema="cintilacao" /></dt>
                    <dd>{textoAtual(atual)}</dd>
                  </div>
                  <div>
                    <dt>Índice previsto (3 h) <AjudaGnss tema="indice" /></dt>
                    <dd>
                      {pico ? (
                        <>
                          <i className="gnss-bolinha" style={{ background: corDoIndice(pico.indice) }} />
                          {pico.indice} às {horaDe(pico.instante)}
                        </>
                      ) : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt>Janela de risco hoje <AjudaGnss tema="janela" /></dt>
                    <dd>{janelas.length ? janelas.map((j) => textoJanela(j)).join(' · ') : 'Nenhuma'}</dd>
                  </div>
                </dl>
                {dados && <LinhaDoTempo serie={dados.serie} janelas={dados.janelas} agora={agora} />}
              </>
            ) : (
              <p className="gnss-nota">
                Cadastre os talhões desta fazenda em Mapas › Fazendas e shapes para ela ser vigiada.
              </p>
            )}
          </article>
        ))}
      </div>
    </div>
  )
}
