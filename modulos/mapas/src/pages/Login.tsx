import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { entrar } from '../data/auth';
import Aviso, { mensagemDeErro } from '../components/Aviso';

interface Props {
  modo: 'local' | 'supabase';
  logado: boolean;
  /** erro ao verificar a sessão (ex.: Supabase fora do ar) */
  erroInicial?: string | null;
  /** chamado depois de entrar, para o App atualizar a sessão */
  onEntrou(): Promise<void>;
}

function traduzir(e: unknown): string {
  const msg = mensagemDeErro(e);
  if (/invalid login credentials/i.test(msg)) return 'E-mail ou senha inválidos.';
  if (/email not confirmed/i.test(msg)) return 'E-mail ainda não confirmado. Verifique a sua caixa de entrada.';
  if (/rate limit|too many/i.test(msg)) return 'Muitas tentativas. Aguarde alguns minutos e tente de novo.';
  return msg;
}

export default function Login({ modo, logado, erroInicial, onEntrou }: Props) {
  const loc = useLocation();
  const destino = (loc.state as { de?: string } | null)?.de ?? '/mapas';
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);

  if (modo === 'local' || logado) return <Navigate to={destino === '/login' ? '/mapas' : destino} replace />;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !senha) {
      setErro('Informe o e-mail e a senha.');
      return;
    }
    setErro(null);
    setEntrando(true);
    try {
      await entrar(email.trim(), senha);
      await onEntrou();
    } catch (err) {
      setErro(traduzir(err));
    } finally {
      setEntrando(false);
    }
  }

  return (
    <div className="login-fundo">
      <div className="login-cartao">
        <img src="./logo-coa.png" alt="COA — Centro de Operações Agrícolas" />
        <h1>Mapa de Chuva</h1>
        <form onSubmit={enviar} noValidate>
          {erroInicial && !erro && <Aviso tipo="alerta">{erroInicial}</Aviso>}
          <label className="campo">
            <span>E-mail</span>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
          </label>
          <label className="campo">
            <span>Senha</span>
            <input
              type="password"
              autoComplete="current-password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
            />
          </label>
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          <button type="submit" className="botao botao-primario" disabled={entrando}>
            {entrando ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
        <div className="login-rodape">
          <Link to="/config">Configurações</Link>
          <span className="suave"> · peça seu acesso ao administrador do COA</span>
        </div>
      </div>
    </div>
  );
}
