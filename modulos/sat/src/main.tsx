import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './estilos/tokens.css'
import './estilos/casca.css'
import './gnss.css'
import App from './App'
import { definirFonteDoToken } from './api/gnssApi'
import { tokenDaSessao } from './dados/supabase'
import { emEmbed } from './lib/embed'

if (emEmbed()) document.documentElement.classList.add('embed')
// A ponte da Trimble só atende quem está logado: o token sai da sessão do COA WEB a cada pedido.
definirFonteDoToken(tokenDaSessao)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
