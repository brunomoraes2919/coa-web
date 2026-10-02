import { describe, expect, it } from 'vitest';
import { editarChuva, foiEditado, lerChuvaDigitada, restaurarChuva } from '../src/components/editor/TabelaPics';
import { reviverPics, serializarPics } from '../src/data/supabaseLinhas';
import type { Pic } from '../src/lib/types';

const pic = (o: Partial<Pic> = {}): Pic => ({
  id: '1', nome: 'PIC 27 SM3', lat: -14, lon: -56, chuva: 0.2, inativo: false, inicio: null, fim: null, incluir: true, ...o,
});

describe('edição da chuva de um PIC', () => {
  it('lê o valor digitado (vírgula, vazio e inválidos)', () => {
    expect(lerChuvaDigitada('12,5')).toBe(12.5);
    expect(lerChuvaDigitada(' 3 ')).toBe(3);
    expect(lerChuvaDigitada('0,04')).toBe(0);
    expect(lerChuvaDigitada('')).toBeNull();
    expect(lerChuvaDigitada('-1')).toBe('invalido');
    expect(lerChuvaDigitada('abc')).toBe('invalido');
    expect(lerChuvaDigitada('2000')).toBe('invalido');
  });

  it('guarda o valor do CSV na primeira edição e marca como editado', () => {
    const a = editarChuva(pic(), 15);
    expect(a).toMatchObject({ chuva: 15, chuvaOriginal: 0.2, incluir: true });
    expect(foiEditado(a)).toBe(true);
    // segunda edição mantém o original do CSV
    expect(editarChuva(a, 20)).toMatchObject({ chuva: 20, chuvaOriginal: 0.2 });
    // editar de volta ao valor do CSV deixa de contar como editado
    expect(foiEditado(editarChuva(a, 0.2))).toBe(false);
  });

  it('PIC sem leitura passa a entrar na interpolação; zerar a leitura tira', () => {
    expect(editarChuva(pic({ chuva: null, incluir: false }), 8)).toMatchObject({ chuva: 8, incluir: true, chuvaOriginal: null });
    expect(editarChuva(pic({ chuva: null, incluir: false, inativo: true }), 8).incluir).toBe(false);
    expect(editarChuva(pic(), null)).toMatchObject({ chuva: null, incluir: false });
    // um PIC desmarcado pelo usuário continua desmarcado
    expect(editarChuva(pic({ incluir: false }), 5).incluir).toBe(false);
  });

  it('restaurar volta ao valor do CSV sem a marca de editado', () => {
    const r = restaurarChuva(editarChuva(pic(), 15));
    expect(r.chuva).toBe(0.2);
    expect('chuvaOriginal' in r).toBe(false);
    expect(restaurarChuva(pic())).toEqual(pic());
  });

  it('o valor do CSV fica salvo com o mapa (e mapas antigos seguem sem o campo)', () => {
    const [ida] = reviverPics(JSON.parse(JSON.stringify(serializarPics([editarChuva(pic(), 15)]))));
    expect(ida).toMatchObject({ chuva: 15, chuvaOriginal: 0.2 });
    const [antigo] = reviverPics(JSON.parse(JSON.stringify(serializarPics([pic()]))));
    expect('chuvaOriginal' in antigo).toBe(false);
  });
});
