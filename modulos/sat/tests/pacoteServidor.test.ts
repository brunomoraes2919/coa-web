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
// Três partes separadas por ponto, a primeira começando por eyJ: o formato de uma chave JWT (um hash que só contenha "eyJ" não casa).
const CHAVE_JWT = /eyJ[\w-]{10,}\.[\w-]{10,}\./
/** O começo das chaves secretas novas do Supabase. */
const CHAVE_SECRETA = 'sb_secret_'
// 55 + DDD + 8 ou 9 dígitos = 12 ou 13 dígitos seguidos
const TELEFONE_SEGUIDO = /(?<!\d)55\d{10,11}(?!\d)/g
// celular escrito para gente ler: "+55 dd 9dddd-dddd" ou "(dd) 9dddd-dddd"
const TELEFONE_FORMATADO = /(?:\+55[\s.-]*\(?\d{2}\)?|\(\d{2}\))[\s.-]*9\d{4}[\s.-]?\d{4}(?!\d)/g

/** Todo telefone que aparece no texto, só dígitos e com 55 na frente. */
function telefonesEm(texto: string): string[] {
  const formatados = (texto.match(TELEFONE_FORMATADO) ?? []).map((t) => {
    const digitos = t.replace(/\D/g, '')
    return digitos.length === 11 ? `55${digitos}` : digitos
  })
  return [...(texto.match(TELEFONE_SEGUIDO) ?? []), ...formatados]
}

/** As linhas de uma seção de um arquivo de unidade do systemd (`[Unit]`, `[Service]`…). */
function secao(unidade: string, nome: string): string[] {
  const linhas = ler(unidade).split('\n')
  const inicio = linhas.indexOf(`[${nome}]`)
  const resto = linhas.slice(inicio + 1)
  const fim = resto.findIndex((l) => l.startsWith('['))
  return inicio < 0 ? [] : resto.slice(0, fim < 0 ? undefined : fim)
}

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

  it('o locks-sat-whatsapp.mjs importa qrcode-terminal por nome (a VM a instala com o npm)', () => {
    expect(ler('locks-sat-whatsapp.mjs')).toMatch(/import\(["']qrcode-terminal["']\)/)
  })

  it('nenhum arquivo traz chave: nem no formato JWT, nem o começo das chaves secretas novas', () => {
    // compara sem `toMatch`/`toContain`: numa falha eles imprimiriam o arquivo (e a chave) na saída do teste
    for (const nome of arquivos()) {
      expect(CHAVE_JWT.test(ler(nome)), nome).toBe(false)
      expect(ler(nome).includes(CHAVE_SECRETA), nome).toBe(false)
    }
  })

  it('a verificação de chave enxerga uma chave e não se assusta com um hash (a regra não é vazia)', () => {
    const falsa = ['eyJ' + 'a'.repeat(20), 'b'.repeat(30), 'c'.repeat(20)].join('.')
    expect(CHAVE_JWT.test(`SUPABASE_SERVICE_ROLE_KEY=${falsa}`)).toBe(true)
    expect(CHAVE_JWT.test('"integrity": "sha512-abceyJdefghijklmnopqrstuvwxyz0123456789=="')).toBe(false)
  })

  it('nenhum arquivo cita service_role, fora o guia que ensina onde achar a chave', () => {
    // o LEIA-ME tem de nomear a chave para o usuário saber qual copiar; o valor dela nunca aparece (teste acima)
    for (const nome of arquivos().filter((n) => n !== 'LEIA-ME.md')) expect(ler(nome), nome).not.toContain('service_role')
  })

  it('nenhum arquivo (menos o package-lock) traz telefone que não seja um dos de teste', () => {
    for (const nome of arquivos().filter((n) => n !== 'package-lock.json')) {
      const reais = telefonesEm(ler(nome)).filter((n) => !TELEFONES_DE_TESTE.has(n))
      expect(reais, nome).toEqual([])
    }
  })

  it('a verificação de telefone enxerga um número fora da faixa de teste, seguido ou formatado (a regra não é vazia)', () => {
    // DDD 00 não existe: são números impossíveis
    expect(telefonesEm('ligue 5500912345678 agora')).toEqual(['5500912345678'])
    expect(telefonesEm('ligue 550091234567 agora')).toEqual(['550091234567'])
    expect(telefonesEm('ligue +55 00 91234-5678 agora')).toEqual(['5500912345678'])
    expect(telefonesEm('ligue +55 (00) 91234 5678 agora')).toEqual(['5500912345678'])
    expect(telefonesEm('ligue (00) 91234-5678 agora')).toEqual(['5500912345678'])
    expect(telefonesEm('ligue (65) 99999-0001 agora').filter((n) => !TELEFONES_DE_TESTE.has(n))).toEqual([])
  })

  it('o guia usa SEU_NUMERO e NUMERO_DO_COA nos comandos, nunca um número', () => {
    const guia = ler('LEIA-ME.md')
    expect(guia).toContain('--teste SEU_NUMERO')
    expect(guia).toContain('--parear NUMERO_DO_COA')
    expect(guia).toContain('troque pelo número com 55 e DDD, só dígitos')
    expect(guia).not.toMatch(/--(?:teste|parear) \d/)
  })

  it('o pacote tem os arquivos que o instalar.sh e o atualizar.sh baixam', () => {
    const presentes = arquivos()
    for (const f of ['locks-sat-whatsapp.mjs', 'package.json', 'package-lock.json', 'atualizar.sh', 'instalar.sh',
      'locks-sat-whatsapp.service', 'locks-sat-whatsapp-atualizar.service', 'locks-sat-whatsapp-atualizar.timer', 'LEIA-ME.md']) {
      expect(presentes, f).toContain(f)
    }
  })

  it('nenhum arquivo tem fim de linha do Windows (um .sh com CRLF quebra na VM)', () => {
    expect(ler('.gitattributes').trim()).toBe('* text=auto eol=lf')
    for (const nome of arquivos()) expect(ler(nome).includes('\r'), nome).toBe(false)
  })

  it('o serviço de atualização reinicia como root e o timer dispara no minuto 23', () => {
    expect(ler('locks-sat-whatsapp-atualizar.service')).toMatch(/^User=locks-sat$/m)
    expect(ler('locks-sat-whatsapp-atualizar.service')).toMatch(/^ExecStartPost=\+\/bin\/sh -c /m)
    expect(ler('locks-sat-whatsapp-atualizar.timer')).toMatch(/^OnCalendar=\*:23$/m)
    expect(ler('locks-sat-whatsapp-atualizar.timer')).toMatch(/^Persistent=true$/m)
  })

  it('a atualização tem prazo, e o reinício é só o try-restart', () => {
    const servico = secao('locks-sat-whatsapp-atualizar.service', 'Service')
    expect(servico).toContain('TimeoutStartSec=15min')
    const depois = servico.filter((l) => l.startsWith('ExecStartPost='))
    expect(depois).toHaveLength(1)
    expect(depois[0]).toContain('systemctl try-restart locks-sat-whatsapp')
    expect(depois[0]).not.toContain('is-active')
  })

  it('o serviço roda no fuso de Cuiabá', () => {
    expect(ler('locks-sat-whatsapp.service')).toMatch(/^Environment=TZ=America\/Cuiaba$/m)
  })

  it('queda em laço: um minuto entre as tentativas e, depois de 20 em uma hora, o systemd para de tentar', () => {
    expect(secao('locks-sat-whatsapp.service', 'Service')).toContain('RestartSec=60')
    // estes dois só valem na seção [Unit]
    expect(secao('locks-sat-whatsapp.service', 'Unit')).toContain('StartLimitIntervalSec=3600')
    expect(secao('locks-sat-whatsapp.service', 'Unit')).toContain('StartLimitBurst=20')
  })
})

describe('instalar.sh', () => {
  const linhas = () => ler('instalar.sh').split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'))

  it('o corpo todo fica numa função chamada na última linha (download cortado não executa a metade)', () => {
    const codigo = linhas()
    expect(codigo.at(-1)).toBe('principal "$@"')
    const abre = codigo.indexOf('principal() {')
    const fecha = codigo.lastIndexOf('}')
    expect(abre).toBeGreaterThan(0)
    expect(fecha).toBe(codigo.length - 2)
    // fora da função só há atribuições e o `set`
    for (const l of codigo.slice(0, abre)) expect(l, l).toMatch(/^(#!|set -euo pipefail$|[A-Z_]+=)/)
  })

  it('não baixa o programa nem instala as bibliotecas: isso é do atualizar.sh, rodado como locks-sat', () => {
    const texto = linhas().join('\n')
    expect(texto).not.toContain('npm ')
    expect(texto).not.toContain('.mjs')
    expect(texto).not.toContain('package')
    expect(texto).toContain('sudo -H -u locks-sat "$PASTA/atualizar.sh"')
  })

  it('o arquivo da chave só é criado se o locks-sat não o enxerga, já com modo 600 e sem escrever por cima', () => {
    const codigo = linhas()
    const se = codigo.findIndex((l) => l.includes('if ! sudo -u locks-sat test -f "$AMBIENTE"; then'))
    expect(se).toBeGreaterThan(0)
    expect(codigo[se + 1]).toContain('sudo -H -u locks-sat sh -c \'umask 077; set -C; printf "SUPABASE_URL=\\nSUPABASE_SERVICE_ROLE_KEY=\\n" > "$1"\' sh "$AMBIENTE"')
    // é o único lugar do instalador que escreve nesse arquivo
    expect(codigo.filter((l) => l.includes('$AMBIENTE') && !l.startsWith('AMBIENTE='))).toHaveLength(2)
    expect(codigo.join('\n')).not.toContain('tee')
  })

  it('confere o Node como locks-sat, e nada é feito em /home/locks-sat pelo usuário comum', () => {
    const codigo = linhas()
    expect(codigo.some((l) => l.includes('sudo -H -u locks-sat node -e'))).toBe(true)
    for (const l of codigo.filter((x) => /\$(CASA|PASTA|AMBIENTE)/.test(x) && !/^[A-Z_]+=/.test(x))) expect(l, l).toMatch(/^\s*(if ! )?sudo /)
  })

  it('baixa o atualizar.sh e as três unidades para uma pasta temporária e confere antes de instalar', () => {
    const codigo = linhas()
    const baixa = codigo.findIndex((l) => l.includes('curl -fsS') && l.includes('"$TEMP/$f"'))
    const confere = codigo.findIndex((l) => l.includes('[ -s "$TEMP/$f" ]'))
    const instala = codigo.findIndex((l) => l.includes('sudo install -o locks-sat -g locks-sat -m 755 "$TEMP/atualizar.sh" "$PASTA/atualizar.sh"'))
    const unidades = codigo.findIndex((l) => l.includes('sudo install -m 644 "$TEMP/$f" "/etc/systemd/system/$f"'))
    expect(baixa).toBeGreaterThan(0)
    expect(confere).toBeGreaterThan(baixa)
    expect(instala).toBeGreaterThan(confere)
    expect(unidades).toBeGreaterThan(instala)
    expect(codigo.some((l) => l.includes('TEMP=$(mktemp -d)'))).toBe(true)
  })

  it('no fim recarrega o systemd, reinicia o serviço se estava ligado e apaga o aviso .mudou', () => {
    const codigo = linhas()
    const atualiza = codigo.findIndex((l) => l.includes('"$PASTA/atualizar.sh"') && l.includes('sudo -H -u locks-sat'))
    const recarrega = codigo.indexOf('  sudo systemctl daemon-reload')
    const reinicia = codigo.indexOf('  sudo systemctl try-restart locks-sat-whatsapp')
    const apaga = codigo.indexOf('  sudo rm -f "$PASTA/.mudou"')
    expect(recarrega).toBeGreaterThan(atualiza)
    expect(reinicia).toBeGreaterThan(recarrega)
    expect(apaga).toBeGreaterThan(reinicia)
  })
})

describe('atualizar.sh', () => {
  const linhas = () => ler('atualizar.sh').split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'))

  it('instala as bibliotecas sem rodar script de pacote', () => {
    // só as linhas que rodam o npm (a mensagem de erro também diz "npm")
    const npm = linhas().filter((l) => /(^|[\s(])npm (ci|install)\s/.test(l))
    expect(npm).toHaveLength(1)
    expect(npm[0]).toContain('npm ci --omit=dev --ignore-scripts')
  })

  it('grava o aviso .mudou antes de trocar qualquer coisa', () => {
    const codigo = linhas()
    const aviso = codigo.findIndex((l) => l.includes('> "$PASTA/.mudou"'))
    const primeiraTroca = codigo.findIndex((l) => /^\s*(if .*; then )?mv /.test(l))
    expect(aviso).toBeGreaterThan(0)
    expect(primeiraTroca).toBeGreaterThan(aviso)
  })

  it('troca as bibliotecas tirando as antigas do caminho, sem apagá-las antes de as novas entrarem', () => {
    const codigo = linhas().map((l) => l.trim())
    const sai = codigo.findIndex((l) => l.includes('mv "$PASTA/node_modules" "$PASTA/node_modules.velho"'))
    const entra = codigo.indexOf('mv "$NOVO/node_modules" "$PASTA/node_modules"')
    const apaga = codigo.lastIndexOf('rm -rf "$PASTA/node_modules.velho"')
    expect(sai).toBeGreaterThan(0)
    expect(entra).toBeGreaterThan(sai)
    expect(apaga).toBeGreaterThan(entra)
    expect(codigo).not.toContain('rm -rf "$PASTA/node_modules"')
  })

  it('sem a pasta das bibliotecas (primeira vez) instala mesmo que a trava não tenha mudado', () => {
    expect(linhas().some((l) => l.includes('[ -d "$PASTA/node_modules" ] || bibliotecas=sim'))).toBe(true)
  })
})
