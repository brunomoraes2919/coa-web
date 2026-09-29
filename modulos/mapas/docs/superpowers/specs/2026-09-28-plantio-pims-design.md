# Plantio automático do PIMS (via Agrovex) + cadastro pré-carregado — Design

Data: 28/09/2026 · Status: aprovado por delegação (usuário autorizou as decisões)

## Objetivo

1. Trazer do PIMS, sem digitação, quais talhões da safra estão **plantados**, **plantando** ou
   **a plantar**, pintando cada situação com uma cor no mapa de chuva.
2. Amarrar o código do talhão no PIMS (`UPNIVEL3.CD_UPNIVEL3`) ao código do shape.
3. Entregar o sistema já **pré-cadastrado** com as sete unidades, a safra SOJA 26/27 e os
   shapes das áreas de soja.

## O que existe no PIMS (validado no Agrovex em 28/09/2026)

- `PERIODOSAFRA.DE_PER_SAFRA` = nome da safra, ex.: `SOJA 26/27` (cultura + ano).
- `UPNIVEL3` (talhão × safra): `CD_UPNIVEL3` código (`001`, `013A`, `02PIVO`, `19PESQ`),
  `QT_AREA_PROD` área prevista, `DT_PLANT_INI`/`DT_PLANT_ENC` (preenchidas quando o plantio
  encerra), `ID_VARIEDADE`. `UNIDADEADM.DE_UNI_ADM` = unidade (fazenda); `UPNIVEL2.DE_UPNIVEL2` = setor.
- `APPLANTIO` (apontamento de plantio): `ID_UPNIVEL3`, `ID_PERIODOSAFRA`, `DT_OPERACAO`, `QT_AREA`.
  A soma de `QT_AREA` por talhão é a área já plantada.

Regra de status (por talhão × safra):

| status | condição |
|---|---|
| `plantado` | `DT_PLANT_ENC` preenchida **ou** área apontada ≥ 99% da área prevista |
| `plantando` | 0 < área apontada < 99% da prevista |
| `a_plantar` | talhão cadastrado na safra sem apontamento |

Exemplos reais (28/09): Siriema 007 = 208/228 ha → plantando; Siriema 001 = 97/97 → plantado.

## Arquitetura

O site é estático e o Agrovex não aceita chamadas de navegador (preflight CORS → 401) nem pode
receber o token. Então:

```
GitHub Actions (cron 1×/h + manual)  ──token AGROVEX (secret)──▶  Agrovex MCP execute_query
        │
        ▼ gera public/dados/plantio.json   { geradoEm, safras:[{nome, unidades:[{unidade, talhoes:[{codigo, setor, status, areaPrevista, areaPlantada, inicio, fim, variedade}]}]}] }
        ▼ commit + deploy Pages
Site (local ou Supabase) ── fetch ./dados/plantio.json ──▶ casa código do shape × código PIMS
```

- Script `scripts/sincronizar-plantio.mjs` (Node, sem dependências): inicializa a sessão MCP,
  chama `execute_query` com a SQL acima para as safras ativas (configuráveis em
  `scripts/plantio.config.json`; padrão: todas as safras do ano-safra corrente e do seguinte,
  exceto as administrativas — prefixos ADM, CORREC, COBERTURA, ABERTURA), grava o JSON. Workflow `.github/workflows/plantio.yml`: `schedule: '0 * * * *'`
  + `workflow_dispatch`; faz commit do JSON só se mudou e dispara o deploy.
- Em desenvolvimento local, o mesmo script roda com `AGROVEX_TOKEN` no ambiente (`npm run plantio`).
- Sem `plantio.json` (ou sem internet) o app continua com o plantio manual.

## Modelo de dados (acréscimos)

```
fazendas  + unidadePims: string | null      // 'SIRIEMA', 'GUAPIRAMA'...
talhoes   + codigo: string | null           // normalizado (ver abaixo); vem da coluna escolhida
safras    + nomePims: string | null         // 'SOJA 26/27' (default = nome)
areasCultura (nova) (id, safraId, fazendaId, codigo, geom, areaHa)  // shape da cultura (soja)
plantios  + origem: 'pims' | 'manual', status: 'plantado'|'plantando'|'a_plantar', areaPrevista, areaPlantada, inicio, fim, variedade
```

Normalização do código (shape e PIMS, dos dois lados): maiúsculas sem acento; remove prefixo
`TH`/`TALHÃO`; espaço e hífen são separadores; `PIVÔ 02` → `02PIVO`; número com sufixo letra →
número com 3 dígitos + sufixo (`39B` → `039B`, `TH 033A` → `033A`, `001-A` → `001A`,
`19PESQ` → `019PESQ`); demais mantêm-se sem espaços nem hífens (`P14`, `M1A`).

## Comportamento

- **Cadastro da fazenda**: além da coluna do nome, escolhe-se a **coluna do código PIMS** (sugerida:
  `COD`, `TH CODE`, `TALHAO`, `CODIGO`) e a **unidade PIMS** (lista fixa das unidades encontradas
  no `plantio.json`). Polígonos com o mesmo código viram um MultiPolygon.
- **Safra**: novo campo "Nome no PIMS"; botão **Importar áreas da cultura** (shape da soja) por
  fazenda; a área importada é pintada no mapa (mesmo sem PIMS ela é "a plantar").
- **Plantio automático**: na tela de Plantio e no Novo mapa, o app lê `plantio.json`, casa
  `(unidadePims, codigo)` e mostra por talhão: status, % plantado, datas, variedade. **O PIMS
  prevalece**: talhão com registro no PIMS segue o PIMS e não pode ser marcado à mão. Os plantios
  manuais continuam existindo (origem `manual`) e valem só nos talhões sem registro no PIMS (não há
  opção "manter manual"). Aviso quando um talhão plantado no PIMS não tem polígono na área da cultura
  nem no limite base.
- **Mapa**: cores por status sobre a interpolação — plantado: quadriculado + contorno laranja
  `#DB8A08` (igual hoje); plantando: hachura diagonal + contorno amarelo `#F2C200`; a plantar:
  só contorno tracejado cinza `#555`. Legenda com as três entradas e a data/hora do `plantio.json`
  ("Plantio PIMS de 28/09/2026 07:00"). A tabela "Chuva por talhão" ganha a coluna Situação e %.
- **Pré-cadastro** (`public/dados/seed/`): GeoJSON das sete unidades (base) e das áreas de soja
  26/27, `seed.json` com fazendas (coluna de código e unidade PIMS), talhões, safra `SOJA 26/27`
  (01/09/2026–31/08/2027) e áreas da cultura. Na primeira abertura em modo local o app carrega o
  seed automaticamente (com aviso "Cadastro padrão do COA carregado"); em Configurações existe
  "Recarregar cadastro padrão" e no Supabase "Importar cadastro padrão".
  Fontes: base = `MAPAS MATHEUS/{DOURADO_MAPA DE CHUVA AUTOM (WGS 84), GLOBO V3, NEBRASKA V2,
  SIRIEMA V2 + SÃO MIGUEL V2 (uma fazenda, setores SIRIEMA/SÃO MIGUEL), SM3 V2, GUAPIRAMA V3,
  3 FLECHAS V2}`; cultura = `LIMITES SOJA 26_27/*/SOJA <UNIDADE> 26.27.zip` (Três Flechas veio
  vazio: sem área de soja até novo envio; Guapirama usa `ÁREA DE SOJA 2627-GUAPIRAMA.zip`).

## Fora de escopo

Escrita no PIMS; outras culturas além das cadastradas como safra; proxy via Supabase Edge
Function (fica como evolução se a atualização horária não bastar).
