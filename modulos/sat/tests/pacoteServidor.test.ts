// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * O pacote que a VM baixa do repositório PÚBLICO (modulos/sat/servidor/): versões fixadas, a biblioteca
 * do WhatsApp fora do arquivo gerado, e nada de chave ou telefone real em nenhum arquivo.
 */
const PASTA = resolve(dirname(fileURLToPath(import.meta.url)), '../servidor')
const ler = (nome: string) => readFileSync(join(PASTA, nome), 'utf8')
const arquivos = () => readdirSync(PASTA).filter((n) => statSync(join(PASTA, n)).isFile())

const TELEFONES_DE_TESTE = new Set(Array.from({ length: 9 }, (_, i) => `556599999000${i + 1}`))

describe('pacote do serviço da VM', () => {
  it('o package.json tem exatamente as duas dependências, em versão exata', () => {
    const pacote = JSON.parse(ler('package.json'))
    expect(pacote.dependencies).toEqual({ baileys: '7.0.0-rc14', 'qrcode-terminal': '0.12.0' })
    expect(pacote.devDependencies).toBeUndefined()
  })

  it('o package-lock.json existe e cita as duas', () => {
    const trava = JSON.parse(ler('package-lock.json'))
    expect(trava.packages['node_modules/baileys'].version).toBe('7.0.0-rc14')
    expect(trava.packages['node_modules/qrcode-terminal'].version).toBe('0.12.0')
  })

  it('o locks-sat-whatsapp.mjs importa baileys por nome, sem embutir a biblioteca', () => {
    const codigo = ler('locks-sat-whatsapp.mjs')
    expect(codigo).toMatch(/from ["']baileys["']/)
    // se a biblioteca tivesse sido embutida, o makeWASocket dela estaria definido aqui dentro
    expect((codigo.match(/makeWASocket = /g) ?? []).length).toBe(0)
  })

  it('nenhum arquivo traz começo de chave JWT', () => {
    for (const nome of arquivos()) expect(ler(nome), nome).not.toContain('eyJ')
  })

  it('nenhum arquivo cita service_role, fora o guia que ensina onde achar a chave', () => {
    // o LEIA-ME tem de nomear a chave para o usuário saber qual copiar; o valor dela nunca aparece (teste acima)
    for (const nome of arquivos().filter((n) => n !== 'LEIA-ME.md')) expect(ler(nome), nome).not.toContain('service_role')
  })

  it('nenhum arquivo (menos o package-lock) traz telefone que não seja um dos de teste', () => {
    for (const nome of arquivos().filter((n) => n !== 'package-lock.json')) {
      // 55 + DDD + 8 ou 9 dígitos = 12 ou 13 dígitos seguidos
      const achados = ler(nome).match(/(?<!\d)55\d{10,11}(?!\d)/g) ?? []
      const reais = achados.filter((n) => !TELEFONES_DE_TESTE.has(n))
      expect(reais, nome).toEqual([])
    }
  })

  it('a verificação de telefone enxerga um número real (a regra não é vazia)', () => {
    expect('ligue 5511912345678 agora'.match(/(?<!\d)55\d{10,11}(?!\d)/g)).toEqual(['5511912345678'])
    expect('ligue 551191234567 agora'.match(/(?<!\d)55\d{10,11}(?!\d)/g)).toEqual(['551191234567'])
  })

  it('o pacote tem os arquivos que o instalar.sh e o atualizar.sh baixam', () => {
    const presentes = arquivos()
    for (const f of ['locks-sat-whatsapp.mjs', 'package.json', 'package-lock.json', 'atualizar.sh', 'instalar.sh',
      'locks-sat-whatsapp.service', 'locks-sat-whatsapp-atualizar.service', 'locks-sat-whatsapp-atualizar.timer', 'LEIA-ME.md']) {
      expect(presentes, f).toContain(f)
    }
  })

  it('o serviço de atualização reinicia como root e o timer dispara no minuto 23', () => {
    expect(ler('locks-sat-whatsapp-atualizar.service')).toMatch(/^User=locks-sat$/m)
    expect(ler('locks-sat-whatsapp-atualizar.service')).toMatch(/^ExecStartPost=\+\/bin\/sh -c /m)
    expect(ler('locks-sat-whatsapp-atualizar.timer')).toMatch(/^OnCalendar=\*:23$/m)
    expect(ler('locks-sat-whatsapp-atualizar.timer')).toMatch(/^Persistent=true$/m)
  })

  it('o serviço roda no fuso de Cuiabá', () => {
    expect(ler('locks-sat-whatsapp.service')).toMatch(/^Environment=TZ=America\/Cuiaba$/m)
  })
})
