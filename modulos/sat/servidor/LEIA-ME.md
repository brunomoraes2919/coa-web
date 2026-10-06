# Locks SAT: alertas de janela de risco pelo WhatsApp (serviço da VM)

Este guia põe o serviço no ar na VM do Google Cloud. Você roda os comandos no terminal SSH da VM (botão **SSH** no console do Google Cloud).

Cada bloco cinza de **comando** abaixo é **um passo**: cole o bloco inteiro, aperte Enter e confira o que apareceu. Se aparecer algo diferente do que está escrito, pare e avise antes de seguir. Um único bloco deste guia **não** é comando (é o conteúdo de um arquivo, no passo 2) e está avisado logo acima dele.

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

Cria o usuário `locks-sat` (o serviço roda com ele, separado da sua conta), baixa o programa e instala as bibliotecas. Leva alguns minutos e termina com uma linha que começa com **Instalado.** Pode rodar de novo sem estragar nada: a chave gravada e o pareamento já feito não são tocados.

```bash
curl -fsS https://raw.githubusercontent.com/brunomoraes2919/coa-web/main/modulos/sat/servidor/instalar.sh | bash
```

Agora confira que o usuário do serviço **não** consegue ler os arquivos da sua conta (onde ficam as chaves das outras rotinas). Tem de aparecer uma linha terminando em **Permission denied**:

```bash
sudo -u locks-sat cat ~/.plantio-pims.env > /dev/null
```

Se **não aparecer nada**, pare e avise: o arquivo das chaves da sua conta está aberto para os outros usuários da VM. Se aparecer outra coisa, pare e avise também.

## 2. Gravar a chave do Supabase

O serviço precisa de duas informações do Supabase: o endereço do projeto e a chave de serviço. A VM já tem as duas, no arquivo das rotinas do plantio. Este comando copia só essas duas linhas para o arquivo do serviço, **sem mostrá-las na tela**. Não aparece nada:

```bash
grep -E '^(SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=' ~/.plantio-pims.env | sudo -u locks-sat tee /home/locks-sat/.locks-sat-whatsapp.env > /dev/null && sudo chmod 600 /home/locks-sat/.locks-sat-whatsapp.env
```

Confira. Este comando mostra só os **nomes** do que ficou gravado, nunca os valores. Têm de aparecer exatamente duas linhas, `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` (em qualquer ordem):

```bash
sudo -u locks-sat cut -d= -f1 /home/locks-sat/.locks-sat-whatsapp.env
```

Apareceram as duas? Vá para o passo 3.

### Se o comando acima não mostrar as duas linhas

Aí é preciso digitar as duas à mão. Pegue os valores no painel do Supabase, no projeto do COA:

- **SUPABASE_URL**: Project Settings → API (ou Data API) → **Project URL**. Parece com `https://alguma-coisa.supabase.co`.
- **SUPABASE_SERVICE_ROLE_KEY**: Project Settings → **API keys** → a chave **`service_role`** (na aba das chaves legadas; se o painel só mostrar "Secret keys", use a secret). É um texto longo, sem espaços; use o botão de copiar do painel.

**Atenção:** a chave `service_role` abre o banco inteiro. Não mostre a ninguém, não cole em conversa, e-mail ou chat (nem neste com o Claude), não ponha no repositório. Ela só vai neste arquivo da VM.

Abra o arquivo no editor `nano` (a tela vira um editor de texto):

```bash
sudo -u locks-sat nano /home/locks-sat/.locks-sat-whatsapp.env
```

**O bloco abaixo não é um comando: não cole no terminal.** Ele mostra como o arquivo tem de ficar, dentro do editor: duas linhas, cada uma com o nome, o sinal `=` e o valor colado logo depois, **sem espaço e sem aspas**. Se o arquivo abrir vazio, digite as duas linhas inteiras.

```
SUPABASE_URL=https://alguma-coisa.supabase.co
SUPABASE_SERVICE_ROLE_KEY=cole-a-chave-aqui
```

Para salvar e sair: **Ctrl + X**, depois **S** (ou **Y**, se a pergunta vier em inglês), depois **Enter**. Outro jeito: **Ctrl + O**, **Enter** (salva) e **Ctrl + X** (sai).

Confira, sem mostrar a chave, que as duas linhas estão preenchidas. Deve aparecer só o número **2**:

```bash
sudo -u locks-sat grep -c -E '^(SUPABASE_URL=https://|SUPABASE_SERVICE_ROLE_KEY=.)' /home/locks-sat/.locks-sat-whatsapp.env
```

## 3. Parear o número do COA

É a "ligação" do programa com o WhatsApp do número do COA. Só se faz uma vez (a sessão fica guardada na VM). Você vai precisar do **celular do COA** na mão.

Mostra um **QR code** no terminal. Aumente a janela do terminal se ele sair cortado. No celular do COA: WhatsApp → **Aparelhos conectados** → **Conectar um aparelho** e aponte a câmera para o QR. Quando der certo aparece **Pareado.** e o terminal volta ao normal:

```bash
sudo -u locks-sat bash -c 'cd /home/locks-sat/whatsapp && set -a && . /home/locks-sat/.locks-sat-whatsapp.env && set +a && TZ=America/Cuiaba LOCKS_SAT_SESSAO=/home/locks-sat/whatsapp/sessao node locks-sat-whatsapp.mjs --parear'
```

Se o QR não funcionar, use o **código de 8 dígitos**. No comando abaixo, antes de apertar Enter, apague `NUMERO_DO_COA` e escreva no lugar o número do COA: troque pelo número com 55 e DDD, só dígitos (sem espaço, traço, parêntese ou `+`). Aparece um código como `ABCD-EFGH`; no celular: Aparelhos conectados → Conectar um aparelho → **Conectar com número de telefone**, e digite o código. No fim também aparece **Pareado.**:

```bash
sudo -u locks-sat bash -c 'cd /home/locks-sat/whatsapp && set -a && . /home/locks-sat/.locks-sat-whatsapp.env && set +a && TZ=America/Cuiaba LOCKS_SAT_SESSAO=/home/locks-sat/whatsapp/sessao node locks-sat-whatsapp.mjs --parear NUMERO_DO_COA'
```

## 4. Ensaio (não envia nada)

Calcula as janelas de hoje com os dados reais e **mostra o que enviaria** a cada pessoa cadastrada, nos horários de 07:00, 12:00 e 30 minutos antes de cada janela. Não conecta ao WhatsApp, não envia e não grava nada. Pode levar alguns minutos (ele espera entre as consultas à Trimble). Aparecem linhas começando com data e hora e `ensaio:`, com o telefone só pelos 4 últimos dígitos, e no fim **ensaio: fim**. Só aparece mensagem para quem já mandou ATIVAR (ou foi confirmado à mão no COA WEB):

```bash
sudo -u locks-sat bash -c 'cd /home/locks-sat/whatsapp && set -a && . /home/locks-sat/.locks-sat-whatsapp.env && set +a && TZ=America/Cuiaba LOCKS_SAT_SESSAO=/home/locks-sat/whatsapp/sessao node locks-sat-whatsapp.mjs --ensaio'
```

## 5. Teste real (manda uma mensagem só para você)

Manda **uma** mensagem de teste para o número que você indicar. No comando abaixo, antes de apertar Enter, apague `SEU_NUMERO` e escreva no lugar o **seu** número: troque pelo número com 55 e DDD, só dígitos (sem espaço, traço, parêntese ou `+`). Em alguns segundos chega no seu WhatsApp o texto "Teste do Locks SAT: o envio pelo WhatsApp está funcionando." e o terminal escreve **Enviado para …** com os 4 últimos dígitos:

```bash
sudo -u locks-sat bash -c 'cd /home/locks-sat/whatsapp && set -a && . /home/locks-sat/.locks-sat-whatsapp.env && set +a && TZ=America/Cuiaba LOCKS_SAT_SESSAO=/home/locks-sat/whatsapp/sessao node locks-sat-whatsapp.mjs --teste SEU_NUMERO'
```

## 6. Ligar o serviço

Primeiro confira os arquivos de serviço que o instalador pôs no sistema. O esperado é **não aparecer nada**. Se aparecer alguma linha citando `locks-sat-whatsapp`, pare e avise:

```bash
sudo systemd-analyze verify /etc/systemd/system/locks-sat-whatsapp*.service
```

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

A atualização automática troca o programa e as bibliotecas. Ela **não** troca os arquivos de serviço do sistema (os `.service` e o `.timer`) nem o próprio atualizador: quando esses mudarem no repositório, rode de novo o comando do passo 1 (instalar). Ele não mexe na chave nem no pareamento e reinicia o serviço se ele estiver ligado.

**Desligar** o serviço e as atualizações. Os alertas param até você ligar de novo (passo 6). Não aparece nada na tela:

```bash
sudo systemctl disable --now locks-sat-whatsapp locks-sat-whatsapp-atualizar.timer
```

## Teste ou pareamento com o serviço já ligado

Os comandos dos passos 3 (parear) e 5 (teste) abrem uma conexão própria com o WhatsApp. Com o serviço ligado seriam duas conexões do mesmo número, e uma derruba a outra. Então, depois que o serviço estiver ligado, para rodar um deles à mão:

Pare o serviço. Não aparece nada na tela:

```bash
sudo systemctl stop locks-sat-whatsapp
```

Rode o comando do passo 3 ou do passo 5 e espere terminar. Depois ligue o serviço de novo. Não aparece nada na tela:

```bash
sudo systemctl start locks-sat-whatsapp
```

O ensaio (passo 4) não conecta ao WhatsApp e pode rodar com o serviço ligado.

## Parear de novo

Precisa quando o registro mostra **Sessão encerrada: é preciso parear de novo**, quando o COA WEB mostra "sessão encerrada no celular" (o aparelho foi removido em Aparelhos conectados, ou o celular ficou cerca de 14 dias sem abrir o WhatsApp) ou quando o número do COA mudar. Para os outros avisos, veja antes "Se algo der errado": nem todos pedem novo pareamento.

Primeiro desligue o serviço. Não aparece nada na tela:

```bash
sudo systemctl stop locks-sat-whatsapp
```

Apague a sessão antiga. Não aparece nada na tela:

```bash
sudo -u locks-sat bash -c 'cd /home/locks-sat/whatsapp && find sessao -mindepth 1 -delete'
```

Pareie como no passo 3 (QR ou código) e espere o **Pareado.**. Depois ligue o serviço de novo. Não aparece nada na tela:

```bash
sudo systemctl start locks-sat-whatsapp
```

## Se algo der errado

Os avisos abaixo aparecem no terminal (nos comandos rodados à mão), no registro do serviço ("Ver o que o serviço fez") ou no COA WEB, em Contatos do WhatsApp.

- **Falta SUPABASE_URL** (ou **Falta SUPABASE_SERVICE_ROLE_KEY**): a linha correspondente do arquivo do passo 2 está vazia ou não existe. Refaça o passo 2.
- **SUPABASE_URL não parece um endereço https://… do Supabase**: o que está depois de `SUPABASE_URL=` não é o endereço do projeto (pode ser a chave, colada na linha errada, ou o endereço com alguma coisa a mais no fim). Refaça o passo 2.
- **SUPABASE_SERVICE_ROLE_KEY tem caracteres que uma chave não tem**: a chave foi colada pela metade, com espaço no meio ou com outro texto junto. Refaça o passo 2.
- **Esse é o número de exemplo: troque pelo número de verdade** ou **Número fora do formato**: no comando do passo 3 ou 5, o número não foi trocado, ou foi escrito com espaço, traço, parêntese ou `+`. Use só dígitos, com 55 e DDD na frente.
- **O fuso do processo precisa ser America/Cuiaba**: o comando foi rodado sem o `TZ=America/Cuiaba`. Use os blocos deste guia exatamente como estão.
- **Não conectei ao WhatsApp em 90 segundos**: o número ainda não foi pareado (passo 3) ou a VM está sem internet.
- **ainda não pareado** (no registro: **Ainda não pareado: rode o pareamento**): o serviço foi ligado antes do pareamento. Ele fica ligado esperando, sem conectar. Faça como em "Teste ou pareamento com o serviço já ligado": pare o serviço, faça o passo 3 e ligue de novo.
- **sessão em uso em outro lugar**: alguém rodou o teste ou o pareamento com o serviço ligado, e as duas conexões se derrubaram. O serviço não tenta de novo sozinho. **Não apague a sessão e não pareie de novo**; basta reiniciar o serviço. Não aparece nada na tela:

```bash
sudo systemctl restart locks-sat-whatsapp
```

- **acesso recusado pelo WhatsApp**: o WhatsApp recusou a conexão do número; pode ser bloqueio do número do COA. Pare o serviço com o comando abaixo e avise. Não pareie de novo e não ligue o serviço até resolver (insistir piora):

```bash
sudo systemctl stop locks-sat-whatsapp
```

- **Supabase recusou … (HTTP 401** ou **HTTP 403)** no registro: a chave está errada ou incompleta. Refaça o passo 2.
- **Trimble: …** no registro: a Trimble recusou ou está fora do ar. O serviço tenta de novo sozinho, com intervalo de 5 minutos.
- **erro não tratado: …** no registro: um erro que o programa não previu. O serviço continua ligado; se a linha se repetir, avise.
- O status (passo 6) mostra **failed** em vez de **active (running)**: o serviço caiu 20 vezes em uma hora e o sistema parou de tentar ligar. Veja o motivo em "Ver o que o serviço fez" e avise. Depois de resolvido, este comando libera e liga de novo. Não aparece nada na tela:

```bash
sudo systemctl reset-failed locks-sat-whatsapp && sudo systemctl start locks-sat-whatsapp
```
