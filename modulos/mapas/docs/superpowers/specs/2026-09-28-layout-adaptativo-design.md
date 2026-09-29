# Layout adaptativo e redesign do mapa — Design

Data: 28/09/2026 · Status: aprovado por delegação

## Problema

Com um único formato (A3 paisagem, quadro 333×288 mm, painel à direita), fazendas alongadas
(Três Flechas: ~3× mais alta que larga) ou em blocos separados (Siriema + São Miguel, com
um vazio grande entre eles) viram um mapa pequeno no meio da folha: rótulos ilegíveis e área
desperdiçada. Os exemplos do COA feitos à mão resolvem com folha em retrato e com dois quadros.

## Regras de adaptação (automáticas, com escolha manual disponível)

1. **Orientação** (`orientacao: 'auto' | 'paisagem' | 'retrato'`, padrão `auto`):
   calcula o bbox dos talhões em Mercator; se altura/largura > 1,25 → retrato, senão paisagem.
   Retrato = A3 297×420 mm com o painel embaixo (faixa de 68 mm) — o mapa fica 287×338 mm.
   Paisagem mantém o painel à direita (71,4 mm).
2. **Quadros** (`quadros: 'auto' | 1 | 'setor'`, padrão `auto`):
   agrupa talhões por proximidade (união de bboxes que se tocam com folga de 8% do maior lado
   do conjunto). Se houver 2 ou 3 grupos e o **fator de aproveitamento** (área da folha
   ocupada pelos talhões) com quadros separados for ≥ 1,5× o de um quadro único → usa quadros
   separados, empilhados (retrato/paisagem decidido pelo conjunto dos quadros). Cada quadro
   tem título (nome do setor, se todos os talhões do grupo forem do mesmo setor; senão
   "Bloco 1/2"), escala própria e a mesma escala de cores. `'setor'` força um quadro por setor.
   A interpolação é única (mesma grade); só o recorte muda.
3. **Escala de rótulos**: tamanho do rótulo do talhão = clamp(2,1 mm × k, 1,6, 3,2 mm) onde
   k = raiz(área média dos talhões em mm² / 40). Rótulos abaixo de 1,6 mm que não cabem no
   polígono são omitidos (já é assim). Valor dos PICs: 3,5 mm fixo.

## Redesign (identidade COA, tom institucional)

- **Página**: fundo branco; moldura verde `#0C5A50` de 6 mm em toda a volta; quadro(s) do mapa
  com borda 0,5 mm verde-escura; sombra sutil nos painéis.
- **Cabeçalho do painel**: logo colorida (paisagem, no topo do painel lateral; retrato, à
  esquerda da faixa inferior), título "MAPA DE PRECIPITAÇÃO" em Open Sans 700 caixa-alta com
  filete laranja `#DB8A08` de 1 mm abaixo; subtítulo com a fazenda em 700.
- **Bloco de informações**: pares rótulo/valor em duas colunas (rótulo em 400 cinza `#5D6D69`
  3,2 mm; valor em 700 preto 3,8 mm): Safra, Período, Fonte, Talhões, Setor, Média da fazenda,
  Média na área plantada (quando houver), Plantio (PIMS dd/MM HH:mm, quando houver), Data.
  Sem caixa com borda preta; separadores finos `#DBE2E0`.
- **Legenda**: título "Precipitação (mm)" em 700; amostras 6×4 mm com canto 0,6 mm e borda
  `#8A8A8A` 0,15 mm; itens de situação de plantio acima (Plantado, Plantando, A plantar) com a
  amostra do padrão real; no modo compacto só as classes presentes. Em paisagem fica no painel;
  em retrato fica na faixa inferior à direita, em 2–3 colunas.
- **Rosa dos ventos**: versão simplificada (seta N com haste, 4 pontos), 14 mm, no canto superior
  direito do quadro, sobre fundo branco 85%.
- **Barra de escala**: 3 segmentos alternados preto/branco com rótulos 0, x, 2x, "km" quando
  ≥ 1 km (2,5 km / 5 km como nos mapas do COA), no canto inferior direito do quadro, sobre
  fundo branco 85%.
- **Grade de coordenadas**: marcas discretas cinza nas bordas internas, texto 2,2 mm.
- **PICs**: gota azul como hoje; valor com o destaque escolhido (`destaquePics`).
- **Rodapé**: "Mapa de Chuva COA · Locks" à esquerda, data de geração à direita, atribuição
  do mapa base em 1,8 mm cinza.
- **Logos**: `logo-coa.png` (colorida) sobre branco; `logo-coa-branco.png` reservada para a
  moldura verde se houver faixa escura (não usada no padrão).

## Não muda

Interpolação, cores das classes, PNG por dpi, textos editáveis e a prévia = exportação.
