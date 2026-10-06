// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { chaveDoNumero, lerComando, mascarar, mesmoNumero } from './comandos'

describe('comandos', () => {
  it('ATIVAR e SAIR, sem acento, sem maiúscula, com espaço e ponto em volta', () => {
    expect(lerComando('ATIVAR')).toBe('ativar')
    expect(lerComando('  ativar. ')).toBe('ativar')
    expect(lerComando('Sair')).toBe('sair')
    expect(lerComando('PARAR!')).toBe('sair')
  })
  it('qualquer outra coisa não é comando', () => {
    for (const t of ['', 'oi', 'ativar o trator', 'quero sair mais cedo', 'ativar\nsair']) expect(lerComando(t)).toBeNull()
  })
  it('compara número com e sem o nono dígito, e a partir do jid', () => {
    expect(chaveDoNumero('5565999990001')).toBe('6599990001')
    expect(chaveDoNumero('556599990001@s.whatsapp.net')).toBe('6599990001')
    expect(chaveDoNumero('5565999990001:12@s.whatsapp.net')).toBe('6599990001')
    expect(mesmoNumero('5565999990001', '556599990001@s.whatsapp.net')).toBe(true)
    expect(mesmoNumero('5565999990001', '5566999990001')).toBe(false)
    expect(chaveDoNumero('123456789012345@lid')).toBeNull()
    expect(chaveDoNumero('14155550100@s.whatsapp.net')).toBeNull()
  })
  it('mascara o número nos registros', () => {
    expect(mascarar('5565999990001')).toBe('…0001')
  })
})
