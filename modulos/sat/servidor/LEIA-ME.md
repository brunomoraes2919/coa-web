# Locks SAT: alertas de janela de risco pelo WhatsApp (serviço da VM)

Este guia põe o serviço no ar na VM do Google Cloud. Você roda os comandos no terminal SSH da VM (botão **SSH** no console do Google Cloud). Cada bloco cinza abaixo é **um passo**: cole o bloco inteiro, aperte Enter e confira o que apareceu. Se aparecer algo diferente do que está escrito, pare e avise antes de seguir.

No terminal SSH do navegador, colar é **Ctrl + Shift + V**.

## Antes de começar

- O script `supabase/0006_whatsapp_envio.sql` já tem de ter sido rodado, uma vez, no SQL Editor do Supabase.
- A versão nova do código já tem de estar publicada no `main` do repositório (a VM baixa os arquivos de lá).
- A VM precisa do Node 20 ou mais novo, instalado para todos os usuários. Confira:

```bash
node -v
```

Deve aparecer algo como `v20.…` ou `v22.…` (qualquer número 20 ou maior).

## 1. Instalar

Baixa o programa, cria o usuário `locks-sat` e instala as bibliotecas. Leva alguns minutos e termina com a frase **Instalado. Falta: gravar a chave, parear e ligar o serviço**. Pode rodar de novo sem estragar nada.

```bash
curl -fsS https://raw.githubusercontent.com/brunomoraes2919/coa-web/main/modulos/sat/servidor/instalar.sh | bash
```

## 2. Gravar a chave do Supabase

O serviço precisa de duas informações do Supabase. Pegue as duas no painel do Supabase, no projeto do COA:

- **SUPABASE_URL**: Project Settings → API (ou Data API) → **Project URL**. Parece com `https://alguma-coisa.supabase.co`.
- **SUPABASE_SERVICE_ROLE_KEY**: Project Settings → **API keys** → a chave **`service_role`** (na aba das chaves legadas; se o painel só mostrar "Secret keys", use a secret). É um texto longo, sem espaços; use o botão de copiar do painel.

**Atenção:** a chave `service_role` abre o banco inteiro. Não mostre a ninguém, não cole em conversa, e-mail ou chat (nem neste com o Claude), não ponha no repositório. Ela só vai neste arquivo da VM.

Abre o arquivo de ambiente no editor `nano` (a tela vira um editor de texto):

```bash
sudo -u locks-sat nano /home/locks-sat/.locks-sat-whatsapp.env
```

O arquivo tem duas linhas. Complete cada uma colando o valor logo depois do `=`, **sem espaço e sem aspas**:

```
SUPABASE_URL=https://alguma-coisa.supabase.co
SUPABASE_SERVICE_ROLE_KEY=cole-a-chave-aqui
```

Para salvar: **Ctrl + O**, depois **Enter**; para sair: **Ctrl + X**.

Agora confira, sem mostrar a chave, que as duas linhas estão preenchidas. Deve aparecer só o número **2**:

```bash
sudo -u locks-sat grep -c -E '^(SUPABASE_URL=https://|SUPABASE_SERVICE_ROLE_KEY=.)' /home/locks-sat/.locks-sat-whatsapp.env
```

## 3. Parear o número do COA

É a "ligação" do programa com o WhatsApp do número do COA. Só se faz uma vez (a sessão fica guardada na VM). Você vai precisar do **celular do COA** na mão.

Mostra um **QR code** no terminal. Aumente a janela do terminal se ele sair cortado. No celular do COA: WhatsApp → **Aparelhos conectados** → **Conectar um aparelho** e aponte a câmera para o QR. Quando der certo aparece **Pareado.** e o terminal volta ao normal:

```bash
sudo -u locks-sat bash -c 'cd /home/locks-sat/whatsapp && set -a && . /home/locks-sat/.locks-sat-whatsapp.env && set +a && TZ=America/Cuiaba LOCKS_SAT_SESSAO=/home/locks-sat/whatsapp/sessao node locks-sat-whatsapp.mjs --parear'
```

Se o QR não funcionar, use o **código de 8 dígitos**: troque `5565999990001` pelo número do COA (só dígitos, com 55 e DDD). Aparece um código como `ABCD-EFGH`; no celular: Aparelhos conectados → Conectar um aparelho → **Conectar com número de telefone**, e digite o código. No fim também aparece **Pareado.**:

```bash
sudo -u locks-sat bash -c 'cd /home/locks-sat/whatsapp && set -a && . /home/locks-sat/.locks-sat-whatsapp.env && set +a && TZ=America/Cuiaba LOCKS_SAT_SESSAO=/home/locks-sat/whatsapp/sessao node locks-sat-whatsapp.mjs --parear 5565999990001'
```

## 4. Ensaio (não envia nada)

Calcula as janelas de hoje com os dados reais e **mostra o que enviaria** a cada pessoa cadastrada, nos horários de 07:00, 12:00 e 30 minutos antes de cada janela. Não conecta ao WhatsApp, não envia e não grava nada. Pode levar alguns minutos (ele espera entre as consultas à Trimble). Aparecem linhas começando com data e hora e `ensaio:`, com o telefone só pelos 4 últimos dígitos, e no fim **ensaio: fim**. Só aparece mensagem para quem já mandou ATIVAR (ou foi confirmado à mão no COA WEB):

```bash
sudo -u locks-sat bash -c 'cd /home/locks-sat/whatsapp && set -a && . /home/locks-sat/.locks-sat-whatsapp.env && set +a && TZ=America/Cuiaba LOCKS_SAT_SESSAO=/home/locks-sat/whatsapp/sessao node locks-sat-whatsapp.mjs --ensaio'
```

## 5. Teste real (manda uma mensagem só para você)

Manda **uma** mensagem de teste para o número que você indicar. Troque `5565999990001` pelo **seu** número (só dígitos, com 55 e DDD). Em alguns segundos chega no seu WhatsApp o texto "Teste do Locks SAT: o envio pelo WhatsApp está funcionando." e o terminal escreve **Enviado para …** com os 4 últimos dígitos:

```bash
sudo -u locks-sat bash -c 'cd /home/locks-sat/whatsapp && set -a && . /home/locks-sat/.locks-sat-whatsapp.env && set +a && TZ=America/Cuiaba LOCKS_SAT_SESSAO=/home/locks-sat/whatsapp/sessao node locks-sat-whatsapp.mjs --teste 5565999990001'
```

Se o serviço já estiver ligado (passo 6), desligue antes com `sudo systemctl stop locks-sat-whatsapp` e ligue depois com `sudo systemctl start locks-sat-whatsapp`: duas conexões ao mesmo tempo se derrubam.

## 6. Ligar o serviço

Liga o serviço e a conferência automática de atualizações (a cada hora). Também faz os dois ligarem sozinhos quando a VM reiniciar. Não aparece nada na tela:

```bash
sudo systemctl enable --now locks-sat-whatsapp locks-sat-whatsapp-atualizar.timer
```

Confira que está no ar. Deve aparecer **active (running)** em verde (aperte **q** para sair, se a tela ficar parada):

```bash
sudo systemctl status locks-sat-whatsapp --no-pager
```

No COA WEB, em Contatos do WhatsApp, o aviso passa a mostrar **WhatsApp conectado**. A lista só recebe depois que cada pessoa manda **ATIVAR** para o número do COA (ou é confirmada à mão no COA WEB).

## Dia a dia

**Ver o que o serviço fez** (as 50 últimas linhas). Telefones aparecem só pelos 4 últimos dígitos e nenhuma conversa é registrada. Logo depois de ligar devem aparecer **serviço ligado** e **WhatsApp conectado**:

```bash
sudo journalctl -u locks-sat-whatsapp -n 50 --no-pager
```

**Atualizar agora**, sem esperar a hora cheia. O serviço também se atualiza sozinho, a cada hora no minuto 23, e reinicia se algo mudou. Aparece **Sem mudança.** ou **mudou**:

```bash
sudo systemctl start locks-sat-whatsapp-atualizar.service && sudo journalctl -u locks-sat-whatsapp-atualizar -n 5 --no-pager
```

**Desligar** o serviço e as atualizações. Os alertas param até você ligar de novo (passo 6). Não aparece nada na tela:

```bash
sudo systemctl disable --now locks-sat-whatsapp locks-sat-whatsapp-atualizar.timer
```

## Parear de novo

Precisa quando o registro mostra **Sessão encerrada: é preciso parear de novo**, quando o COA WEB mostra "sessão encerrada no celular" (o aparelho foi removido em Aparelhos conectados, ou o celular ficou cerca de 14 dias sem abrir o WhatsApp) ou quando o número do COA mudar.

Primeiro desligue o serviço. Não aparece nada na tela:

```bash
sudo systemctl stop locks-sat-whatsapp
```

Apague a sessão antiga. Não aparece nada na tela:

```bash
sudo -u locks-sat find /home/locks-sat/whatsapp/sessao -mindepth 1 -delete
```

Pareie como no passo 3 (QR ou código) e espere o **Pareado.**. Depois ligue o serviço de novo. Não aparece nada na tela:

```bash
sudo systemctl start locks-sat-whatsapp
```

## Se algo der errado

- **Falta SUPABASE_URL** (ou **Falta SUPABASE_SERVICE_ROLE_KEY**): a linha correspondente do arquivo do passo 2 está vazia. Rode o `nano` de novo e complete.
- **O fuso do processo precisa ser America/Cuiaba**: o comando foi rodado sem o `TZ=America/Cuiaba`. Use os blocos deste guia exatamente como estão.
- **Não conectei ao WhatsApp em 90 segundos**: o número ainda não foi pareado (passo 3) ou a VM está sem internet.
- **Supabase recusou … (HTTP 401** ou **HTTP 403)** no registro: a chave está errada ou incompleta. Refaça o passo 2.
- **Trimble: …** no registro: a Trimble recusou ou está fora do ar. O serviço tenta de novo sozinho, com intervalo de 5 minutos.
