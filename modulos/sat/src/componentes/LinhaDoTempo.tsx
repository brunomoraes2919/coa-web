/**
 * Linha do tempo de hoje de uma fazenda: cintilação medida (linha, 0–100),
 * índice ionosférico (colunas 0–10, esmaecidas quando previstas), janelas de
 * risco do histórico (faixas hachuradas) e a marca de "agora".
 */
import {
  Bar, Cell, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { faixasDasJanelas, linhaDoDia, type PontoLinha } from '../logic/linhaDoTempo'
import { corDoIndice } from '../logic/niveis'
import { MINUTOS_DIA, minutoDoDia, rotuloHora } from '../logic/tempo'
import type { Janela, PontoIono } from '../tipos'

const TICKS = [0, 180, 360, 540, 720, 900, 1080, 1260, 1440]

function Dica({ ativo, ponto }: { ativo?: boolean; ponto?: PontoLinha }) {
  if (!ativo || !ponto) return null
  return (
    <div className="gnss-dica">
      <strong>{rotuloHora(ponto.minuto)}</strong>
      {ponto.cintilacao != null && <span>Cintilação {Math.round(ponto.cintilacao)} de 100</span>}
      {ponto.indice != null && <span>Índice {ponto.indice}{ponto.previsto ? ' (previsto)' : ''}</span>}
    </div>
  )
}

export default function LinhaDoTempo({ serie, janelas, agora }: { serie: PontoIono[]; janelas: Janela[]; agora: number }) {
  const dados = linhaDoDia(serie, agora)
  return (
    <div className="gnss-linha">
      <ResponsiveContainer width="100%" height={170}>
        <ComposedChart data={dados} margin={{ top: 8, right: 0, bottom: 0, left: -20 }}>
          <defs>
            <pattern id="gnss-hachura" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="rgba(139, 144, 138, 0.14)" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(92, 98, 93, 0.55)" strokeWidth="2" />
            </pattern>
          </defs>
          {faixasDasJanelas(janelas).map((f) => (
            <ReferenceArea key={`${f.x1}-${f.x2}`} yAxisId="cin" x1={f.x1} x2={f.x2} fill="url(#gnss-hachura)" fillOpacity={1} ifOverflow="hidden" />
          ))}
          <XAxis
            dataKey="minuto"
            type="number"
            domain={[0, MINUTOS_DIA]}
            ticks={TICKS}
            tickFormatter={(m: number) => rotuloHora(m)}
            tick={{ fontSize: 11 }}
          />
          <YAxis yAxisId="cin" domain={[0, 100]} ticks={[0, 33, 66, 100]} tick={{ fontSize: 11 }} />
          <YAxis yAxisId="ind" orientation="right" domain={[0, 10]} ticks={[0, 5, 8, 10]} tick={{ fontSize: 11 }} width={24} />
          <Bar yAxisId="ind" dataKey="indice" barSize={3} isAnimationActive={false}>
            {dados.map((d) => (
              <Cell
                key={d.minuto}
                fill={d.indice == null ? 'transparent' : corDoIndice(d.indice)}
                fillOpacity={d.previsto ? 0.35 : 0.85}
              />
            ))}
          </Bar>
          <Line yAxisId="cin" dataKey="cintilacao" stroke="#a8321f" strokeWidth={2} dot={false} isAnimationActive={false} />
          <ReferenceLine yAxisId="cin" x={minutoDoDia(agora)} stroke="#1b201e" strokeDasharray="3 3" />
          <Tooltip
            content={({ active, payload }) => (
              <Dica ativo={active} ponto={payload?.[0]?.payload as PontoLinha | undefined} />
            )}
          />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="gnss-linha-legenda">
        <span><i className="gnss-leg-linha" />cintilação medida (0–100)</span>
        <span><i className="gnss-leg-coluna" />índice ionosférico (0–10, à direita)</span>
        <span><i className="gnss-leg-hachura" />janela de risco</span>
      </p>
    </div>
  )
}
