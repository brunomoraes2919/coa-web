/**
 * Segura a queda de UMA tela (as telas carregadas sob demanda): sem isto, um pacote que não
 * baixa — o iframe fica dias aberto e uma publicação nova apaga os pacotes antigos — ou um erro ao
 * desenhar desmonta a árvore inteira, vigia incluído. O erro fica no console. Serve a qualquer tela
 * carregada sob demanda: quem usa diz, na `mensagem`, o que não abriu.
 */
import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** O que não abriu, dito ao usuário (ex.: "Não foi possível abrir o mapa."). */
  mensagem: string
  /** Padrão: recarrega a página. */
  aoRecarregar?: () => void
}

export default class LimiteDeErro extends Component<Props, { falhou: boolean }> {
  state = { falhou: false }

  static getDerivedStateFromError(): { falhou: boolean } {
    return { falhou: true }
  }

  componentDidCatch(erro: unknown): void {
    console.error('[locks-sat] falha ao mostrar a tela', erro)
  }

  render(): ReactNode {
    if (!this.state.falhou) return this.props.children
    return (
      <div className="gnss-vazio" role="alert">
        {this.props.mensagem}{' '}
        <button type="button" className="gnss-btn" onClick={this.props.aoRecarregar ?? (() => window.location.reload())}>
          Recarregar
        </button>
      </div>
    )
  }
}
