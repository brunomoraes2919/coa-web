# Montagens de Painel (TV do COA)

Módulo do COA WEB que monta a tela da TV da sala do COA: **montagens** com nome (divisão da tela + sites de cada
quadro, cada site com o seu tempo), uma delas **na TV hoje**, e a página da TV com a moldura do COA.

- Editor: COA WEB → categoria **Montagens de Painel** (`painel/index.html?embed=1` dentro da casca).
- TV: `https://coa-web-teal.vercel.app/painel/?tv=1` (botão **Abrir na TV** do editor).
- Especificação e plano: `modulos/painel/docs/`. Banco: `supabase/0025_painel.sql`.

## Arquivos

| Arquivo | O que faz |
|---|---|
| `painel/logica.js` | Contas sem tela (divisões, tempos, endereços, montagem, rotação), testadas |
| `painel/fonte.js`, `painel/config.js` | Dados: Supabase do COA WEB ou servidor local |
| `painel/editor.js`, `painel/estilo.css` | Editor |
| `painel/tv.js`, `painel/tv.css` | TV |
| `api/conferir-site.js` | Diz se um site deixa ser exibido dentro de outra página |
| `vercel.json` | Só `/painel/` pode abrir sites externos em quadros (`frame-src https:`) |

## Sites que não abrem num quadro

Quem decide é o dono do site (cabeçalhos `X-Frame-Options` e `frame-ancestors`). Em 15/10/2026 não abriam: John
Deere Operations Center, portal da ZEUS, windy.com e zoom.earth. Abrem: páginas do COA WEB, o widget do Windy
(`embed.windy.com`) e o radar do RainViewer. O editor confere na hora de adicionar. Site que pede login pode pedir o
login dentro do quadro: na TV, a tecla **I** libera mexer nos sites por 2 minutos.

## Deixar a TV abrindo sozinha (Linux)

1. No Chrome/Chromium da TV, entre uma vez no COA WEB com um login que tenha a categoria **Montagens de Painel** e
   as categorias das páginas que vão nos quadros (Operacional, Previsão do Tempo…).
2. Teste o modo quiosque (sai com Alt+F4):
   `chromium --kiosk --noerrdialogs --disable-session-crashed-bubble https://coa-web-teal.vercel.app/painel/?tv=1`
   (ou `google-chrome` no lugar de `chromium`).
3. Início automático: crie `~/.config/autostart/painel-coa.desktop` com:

       [Desktop Entry]
       Type=Application
       Name=Painel do COA
       Exec=chromium --kiosk --noerrdialogs --disable-session-crashed-bubble https://coa-web-teal.vercel.app/painel/?tv=1
       X-GNOME-Autostart-enabled=true

4. Desligue a proteção de tela e o desligamento do monitor (Configurações → Energia), senão a TV apaga.
5. TV 4K: ponha a escala da tela do sistema em 200% (ou o zoom do Chrome em 200%). A moldura acompanha sozinha, e
   os sites dos quadros deixam de aparecer miúdos (eles usam a escala própria deles).

Na TV: **I** libera mexer nos sites por 2 min; **F** pede tela cheia (no quiosque já está). A TV confere a montagem
a cada minuto e recarrega sozinha quando o painel é publicado de novo: ninguém precisa dar F5. Ao publicar mudança
em `painel/`, troque o `?v=` do arquivo em `painel/index.html`.

## Testes

- `node --test "modulos/painel/testes/*.test.mjs"` (na raiz).
- Servidor local, sem login e com montagens fictícias: `node modulos/painel/scripts/servidor-local.mjs` → editor em
  `http://localhost:8792/painel/` e TV em `http://localhost:8792/painel/?tv=1&conferir=5` (`conferir` encurta a
  conferência da montagem; só vale no servidor local).
