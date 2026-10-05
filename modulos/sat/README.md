# Locks SAT

Monitoramento de cintilação ionosférica para as operações com GNSS/RTK das fazendas, dentro do COA WEB.

- **Hoje:** por fazenda, a cintilação medida agora, o índice ionosférico previsto para as próximas 3 horas, a janela de risco do dia (pelo histórico dos últimos 7 dias) e a linha do tempo de 00 a 24 h.
- **Mapa:** a ionosfera sobre o mapa, nas mesmas cores das fazendas, com o contorno dos talhões, quatro fundos e o histórico dos últimos 30 dias.
- **Alertas:** os avisos dos últimos 7 dias.

## Como funciona

- O código fica em `modulos/sat/` (React + Vite + TypeScript) e o build publicado em `sat/`, na raiz do repositório.
- O `index.html` do COA WEB abre o módulo num iframe (`sat/index.html?embed=1`) logo depois do login, escondido. O vigia roda ali o tempo todo e avisa o site, que mostra o aviso em qualquer categoria.
- Fazendas e limites vêm do cadastro do módulo Mapas (`mapas_fazendas`, `mapas_talhoes`), com a sessão do usuário: cada um vê só as fazendas liberadas para ele.
- Os dados da ionosfera passam pela função `api/gnss.js` (na raiz), que só atende usuário logado no COA WEB.

## Publicar

```bash
cd modulos/sat
npm install
npm run publicar
```

`publicar` roda os testes, confere os tipos, grava o build em `../../sat` e confere a saída (sem dados, só a chave anon). Depois é commitar `modulos/sat` junto com `sat/` e dar push no `main`: a Vercel publica o site e a função `api/gnss.js`.

No GitHub Pages não existe a função: o módulo abre, mas fica "Sem dados da Trimble".

## Testar no computador

```bash
cd modulos/sat
npm run local
```

Abre o COA WEB inteiro em `http://localhost:8770/`, com a mesma função `api/gnss.js`. Entre com o seu usuário do COA WEB.

## Limites

- Só vigia com o COA WEB aberto em alguma aba.
- A fonte dos dados não é oficial e pode ficar indisponível; nesse caso o módulo mostra "Sem dados da Trimble" e tenta de novo sozinho.
- A cintilação não tem previsão: o que olha para a frente é o índice (3 h) e a janela de risco, que é uma estimativa pelo histórico.
- Alertas e preferências ficam guardados no navegador; ao entrar outro usuário no mesmo navegador, eles são apagados.
