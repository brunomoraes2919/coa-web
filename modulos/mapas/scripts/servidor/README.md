# Rotinas do PIMS na VM: arquivos de referência

Esta pasta guarda **cópias de referência** do que está instalado na VM do Google Cloud para as rotinas do plantio e dos pedidos. A VM **não baixa estes arquivos sozinha**: mudar um arquivo aqui não muda nada na VM até alguém levá-lo para lá, à mão, pelos passos deste guia.

| Arquivo daqui | Onde fica na VM | O que faz |
|---|---|---|
| `atualizar-e-rodar.sh` | `~/plantio-pims/atualizar-e-rodar.sh` | Rotina de hora em hora (minuto 17): baixa os scripts e roda o plantio |
| `atender-pedidos.sh` | `~/plantio-pims/atender-pedidos.sh` | A cada ~30 s: atende os pedidos feitos pelas telas |
| `plantio-pims.service` e `.timer` | `/etc/systemd/system/` | Agenda a rotina de hora em hora |
| `plantio-pims-pedidos.service` e `.timer` | `/etc/systemd/system/` | Agenda a verificação dos pedidos |

O que a VM **baixa sozinha**, a cada hora, são outros três arquivos, da pasta `modulos/mapas/scripts` do `main`: `sincronizar-plantio.mjs`, `atender-pedidos.mjs` e `plantio.config.json`. Isso continua igual.

As chaves ficam só na VM, no arquivo `~/.plantio-pims.env`. **Nenhum comando deste guia mostra chave na tela**, e nenhuma chave deve ser colada em conversa, e-mail ou no repositório.

Os comandos são rodados no terminal SSH da VM (botão **SSH** no console do Google Cloud; para colar, **Ctrl + Shift + V**). Cada bloco cinza é **um passo**: cole o bloco inteiro, aperte Enter e confira o que apareceu. Se aparecer algo diferente do que está escrito, pare e avise antes de seguir.

## O que esta versão de referência tem de diferente

Comparada com a versão anterior desta pasta (a que está na VM hoje):

- **Download com prazo e só por https.** O `curl` ganhou limite de tempo (2 minutos por arquivo) e só aceita https com TLS 1.2 ou mais novo. Antes, um download pendurado podia segurar a trava, e os botões "Atualizar" das telas ficariam sem resposta até alguém encerrar a rotina na VM.
- **Os três arquivos são trocados juntos, depois de conferidos.** Eles vão para uma pasta à parte; só se os três chegaram inteiros e os dois programas passam na conferência do Node é que entram no lugar dos antigos. Se qualquer coisa falhar, nada é trocado e a rotina roda com a versão que já estava na VM. Antes, cada arquivo era trocado sozinho, e uma falha no meio podia deixar um programa novo ao lado de um antigo.
- **Prazo nos serviços** (`TimeoutStartSec`): uma rodada pendurada é encerrada pelo sistema (30 minutos na de hora em hora, 20 na dos pedidos) em vez de ficar parada para sempre.
- **Opção de fixar a versão** (arquivo `versao`): opcional, explicada no fim deste guia. Sem esse arquivo, a rotina baixa do `main`, como sempre.

## Antes de publicar os programas novos: um endereço para conferir

Os programas (`sincronizar-plantio.mjs` e `atender-pedidos.mjs`) passaram a **recusar** enviar o token do Agrovex para qualquer endereço que não seja `https://mcp.agrovex.com.br`. O endereço que está no `plantio.config.json` é esse, então nada muda. A única situação em que a rotina pararia é se o arquivo de chaves da VM tiver uma linha `AGROVEX_URL` apontando para outro lugar. Confira (o comando mostra só essa linha, que é um endereço, não uma chave). O esperado é **não aparecer nada**:

```bash
grep '^AGROVEX_URL=' ~/.plantio-pims.env
```

Se aparecer uma linha com um endereço diferente de `https://mcp.agrovex.com.br/...`, pare e avise.

## Como levar esta versão para a VM

Faça depois que esta pasta estiver publicada no `main`. São cinco passos e leva uns cinco minutos. Nada aqui mexe nas chaves.

### 1. Guardar a versão atual

Faz uma cópia do arquivo que está em uso, para poder voltar atrás. Não aparece nada na tela:

```bash
cp -p ~/plantio-pims/atualizar-e-rodar.sh ~/plantio-pims/atualizar-e-rodar.sh.antes
```

### 2. Baixar a versão nova e conferir

Baixa o arquivo para um nome provisório e confere se chegou inteiro, sem trocar nada ainda. Deve aparecer **Arquivo conferido.**:

```bash
curl -fsS --proto '=https' --tlsv1.2 --max-time 60 https://raw.githubusercontent.com/brunomoraes2919/coa-web/main/modulos/mapas/scripts/servidor/atualizar-e-rodar.sh -o ~/plantio-pims/atualizar-e-rodar.sh.novo && bash -n ~/plantio-pims/atualizar-e-rodar.sh.novo && grep -q 'scripts/.novo' ~/plantio-pims/atualizar-e-rodar.sh.novo && echo "Arquivo conferido."
```

### 3. Pôr a versão nova no lugar

Troca o arquivo e deixa só a sua conta com permissão sobre ele. Não aparece nada na tela:

```bash
chmod 700 ~/plantio-pims/atualizar-e-rodar.sh.novo && mv ~/plantio-pims/atualizar-e-rodar.sh.novo ~/plantio-pims/atualizar-e-rodar.sh
```

### 4. Pôr o prazo nos dois serviços

Em vez de trocar os arquivos de serviço (que na VM têm o nome da sua conta no lugar de `USUARIO`), este passo acrescenta só o prazo, num arquivo à parte de cada serviço. Deve aparecer **Prazos gravados.**:

```bash
sudo mkdir -p /etc/systemd/system/plantio-pims.service.d /etc/systemd/system/plantio-pims-pedidos.service.d && printf '[Service]\nTimeoutStartSec=30min\n' | sudo tee /etc/systemd/system/plantio-pims.service.d/prazo.conf > /dev/null && printf '[Service]\nTimeoutStartSec=20min\n' | sudo tee /etc/systemd/system/plantio-pims-pedidos.service.d/prazo.conf > /dev/null && sudo systemctl daemon-reload && echo "Prazos gravados."
```

Confira. Devem aparecer duas linhas, `TimeoutStartUSec=30min` e `TimeoutStartUSec=20min`:

```bash
systemctl show plantio-pims.service plantio-pims-pedidos.service -p TimeoutStartUSec
```

### 5. Rodar agora e conferir

Roda a rotina de hora em hora uma vez (leva de 1 a 3 minutos) e mostra o fim do registro:

```bash
sudo systemctl start plantio-pims.service; tail -n 6 ~/plantio-pims/rotina.log
```

No registro tem de aparecer uma linha terminando em **`scripts: main`** e, depois dela, as linhas de sempre (a quantidade de linhas e talhões gravados). Se aparecer **`scripts: nada foi trocado`**, o download falhou (o motivo está na linha de cima) e a rotina rodou com a versão que já estava na VM: não é grave, mas avise se se repetir na hora seguinte.

Aproveite e confira as permissões do arquivo de chaves e da pasta. Devem aparecer `600` e `700`:

```bash
stat -c '%a %n' ~/.plantio-pims.env ~/plantio-pims
```

Se aparecer outro número, corrija com o comando abaixo (não aparece nada na tela) e confira de novo:

```bash
chmod 600 ~/.plantio-pims.env && chmod 700 ~/plantio-pims
```

### Como voltar atrás

Põe de volta o arquivo guardado no passo 1 e tira os prazos. Deve aparecer **Desfeito.**:

```bash
cp -p ~/plantio-pims/atualizar-e-rodar.sh.antes ~/plantio-pims/atualizar-e-rodar.sh && sudo rm -f /etc/systemd/system/plantio-pims.service.d/prazo.conf /etc/systemd/system/plantio-pims-pedidos.service.d/prazo.conf && sudo systemctl daemon-reload && echo "Desfeito."
```

## Opcional: fixar a versão que a VM roda

**Por que existe.** Do jeito padrão, a VM roda, na hora seguinte, qualquer coisa que entrar no `main` — com as chaves do PIMS e do Supabase no ambiente. Se alguém conseguir publicar no `main` sem você saber (senha do GitHub roubada, por exemplo), o programa dele roda na VM com essas chaves. Fixando a versão, a VM só roda o commit que **você** conferiu e anotou na própria VM; publicar no `main` deixa de ser suficiente.

**O preço.** Uma correção publicada no `main` **não chega mais sozinha** à VM: depois de cada publicação que mexa em `modulos/mapas/scripts`, você precisa repetir o passo "Trocar a versão fixada" abaixo. Enquanto não repetir, a VM continua na versão antiga. Só vale a pena se você topa essa rotina.

Precisa da versão nova do `atualizar-e-rodar.sh` na VM (os cinco passos acima).

### Achar o código do commit

No GitHub, abra o repositório `coa-web`, clique em **Commits** e abra o commit que você quer que a VM rode (normalmente o mais recente, depois de conferir o que mudou). O código dele tem 40 caracteres (números e letras de `a` a `f`); o botão de copiar ao lado do código curto copia o código inteiro.

Para conferir o que mudou entre a versão que a VM roda hoje e a nova, abra no navegador o endereço abaixo, trocando `ANTIGO` e `NOVO` pelos dois códigos, e olhe os arquivos de `modulos/mapas/scripts`:

```
https://github.com/brunomoraes2919/coa-web/compare/ANTIGO...NOVO
```

### Fixar pela primeira vez (ou trocar a versão fixada)

No comando abaixo, antes de apertar Enter, apague `CODIGO_DO_COMMIT` e cole no lugar o código de 40 caracteres. Deve aparecer **Versão fixada.**; se aparecer **NADA FOI GRAVADO**, o código não tinha 40 caracteres válidos e a VM continua como estava:

```bash
V=CODIGO_DO_COMMIT; if printf '%s' "$V" | grep -Eq '^[0-9a-f]{40}$'; then printf '%s\n' "$V" > ~/plantio-pims/versao && echo "Versão fixada."; else echo "NADA FOI GRAVADO: o código precisa ter 40 caracteres (0-9 e a-f)."; fi
```

Rode a rotina e confira. No registro tem de aparecer **`scripts:`** seguido do código que você colou:

```bash
sudo systemctl start plantio-pims.service; tail -n 6 ~/plantio-pims/rotina.log
```

Se aparecer **`scripts: nada foi trocado`**, o código não existe no repositório (foi copiado errado) ou a VM ficou sem internet; a rotina rodou com a versão que já estava lá. Confira o código e repita.

Se o arquivo `versao` existir mas não tiver um código válido, a rotina **não baixa nada** (roda com o que já está na VM) e escreve no registro **o arquivo versao não tem um código de commit de 40 caracteres**.

### Voltar ao automático (baixar do `main`)

Apaga o arquivo; na hora seguinte a VM volta a baixar do `main`. Não aparece nada na tela:

```bash
rm -f ~/plantio-pims/versao
```

## O que estes arquivos não resolvem

Ficaram de fora, de propósito, duas melhorias maiores que pedem uma tarde com calma e teste, e não só copiar um arquivo:

- **Conta própria para as rotinas.** Hoje elas rodam com a sua conta da VM, que tem `sudo`. O ideal é uma conta só para elas, sem `sudo` e sem login, como a do serviço do WhatsApp (`modulos/sat/servidor`).
- **Chave do Supabase mais fraca.** As rotinas usam a chave `service_role`, que abre o banco inteiro. O ideal é um papel só com as tabelas que elas gravam.
