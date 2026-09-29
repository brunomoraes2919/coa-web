import { describe, expect, it } from 'vitest';
import { mensagemDeErro, mensagemErroInterpolacao } from '../src/lib/erros';
import { ErroPipeline } from '../src/lib/pipeline';

describe('mensagemDeErro (erros técnicos em inglês viram português)', () => {
  it('mantém as mensagens já em português e trata vazio/desconhecido', () => {
    expect(mensagemDeErro(new Error('Nenhum talhão para interpolar'))).toBe('Nenhum talhão para interpolar');
    expect(mensagemDeErro('texto solto')).toBe('texto solto');
    expect(mensagemDeErro(null)).toBe('Ocorreu um erro inesperado.');
  });

  it('rede', () => {
    expect(mensagemDeErro(new TypeError('Failed to fetch'))).toMatch(/^Não foi possível conectar ao servidor/);
  });

  it('sessão expirada (JWT)', () => {
    for (const m of ['JWT expired', 'Não foi possível listar as fazendas: JWT expired', 'invalid JWT: unable to parse or verify signature']) {
      expect(mensagemDeErro(new Error(m))).toBe('Sua sessão expirou. Faça login de novo.');
    }
  });

  it('sem permissão (RLS / permission denied)', () => {
    for (const m of ['new row violates row-level security policy for table "mapas"', 'permission denied for table fazendas']) {
      expect(mensagemDeErro(new Error(m))).toMatch(/^Sem permissão para acessar estes dados/);
    }
  });

  it('arquivo grande demais para o Storage', () => {
    for (const m of ['Payload too large', 'The object exceeded the maximum allowed size']) {
      expect(mensagemDeErro(new Error(m))).toMatch(/^Arquivo grande demais para o Storage/);
    }
  });

  it('arquivo não encontrado no Storage', () => {
    expect(mensagemDeErro(new Error('Não foi possível gerar a URL do arquivo: Object not found'))).toBe(
      'Arquivo não encontrado no Storage do Supabase.',
    );
  });

  it('banco sem a migração 0002 (tabela ou coluna inexistente: 42P01, PGRST204/PGRST205)', () => {
    const esperado = 'Banco desatualizado: rode a migração supabase/migrations/0002_plantio_pims.sql';
    for (const m of [
      'Não foi possível listar as áreas da cultura: relation "public.areas_cultura" does not exist',
      "Could not find the table 'public.areas_cultura' in the schema cache",
      "Could not find the 'origem' column of 'plantios' in the schema cache",
    ]) {
      expect(mensagemDeErro(new Error(m))).toBe(esperado);
    }
    // PostgrestError direto (objeto com code)
    expect(mensagemDeErro({ code: '42P01', message: 'x' })).toBe(esperado);
    expect(mensagemDeErro({ code: 'PGRST204', message: 'y' })).toBe(esperado);
  });

  it('falta de memória (RangeError de alocação)', () => {
    for (const e of [new RangeError('Array buffer allocation failed'), new RangeError('Invalid typed array length: 4294967296'), new RangeError('Invalid array length'), new Error('out of memory')]) {
      expect(mensagemDeErro(e)).toMatch(/^Memória insuficiente/);
    }
    expect(mensagemDeErro(new RangeError('Maximum call stack size exceeded'))).toBe('Maximum call stack size exceeded');
  });
});

describe('mensagemErroInterpolacao (o que o worker devolve para a tela)', () => {
  it('mensagens do pipeline (já em português) passam como estão', () => {
    expect(mensagemErroInterpolacao(new ErroPipeline('Mínimo de 3 PICs com precipitação para interpolar'))).toBe(
      'Mínimo de 3 PICs com precipitação para interpolar',
    );
  });

  it('exceções inesperadas não chegam em inglês', () => {
    expect(mensagemErroInterpolacao(new TypeError("Cannot read properties of undefined (reading 'coordinates')"))).toBe(
      'Falha inesperada no cálculo da interpolação. Recarregue a página e tente de novo.',
    );
    expect(mensagemErroInterpolacao(new RangeError('Array buffer allocation failed'))).toMatch(/^Memória insuficiente/);
    expect(mensagemErroInterpolacao('x')).toBe('Falha inesperada no cálculo da interpolação. Recarregue a página e tente de novo.');
  });
});
