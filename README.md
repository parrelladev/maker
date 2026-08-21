# Maker

Aplicação web para criar artes PNG a partir de templates HTML/CSS e dados de notícias.

O template é renderizado em um `iframe` no navegador. Ao clicar em **Criar**, o próprio preview é convertido em PNG com `html-to-image`, nas dimensões definidas pelo manifest. O servidor não executa Chromium, Puppeteer nem mantém uma fila de geração.

## Requisitos

- Node.js 18 ou superior
- npm

## Executando localmente

```bash
npm install
npm run dev
```

Acesse `http://localhost:3000`.

Para iniciar sem recarga automática:

```bash
npm start
```

## Configuração

A única configuração necessária é a porta HTTP:

```bash
PORT=3000 npm start
```

Também é possível copiar `config.example.js` para `config.js` ou executar `npm run deploy` para criar esse arquivo interativamente. A variável `PORT` tem prioridade.

## Fluxo da aplicação

1. O usuário seleciona um template.
2. A interface solicita HTML, CSS e manifest em `/api/templates/:template/:page`.
3. Ao informar uma notícia, `/api/news/extract` extrai título, subtítulo, chapéu e imagem.
4. A imagem extraída é incorporada como data URL para não bloquear a exportação por CORS.
5. O runtime de bindings aplica os dados ao DOM do iframe.
6. `html-to-image` captura o iframe no tamanho do manifest e inicia o download do PNG.

Não existe uma segunda renderização no backend: o arquivo baixado é produzido a partir do mesmo DOM exibido no preview.

## API

### `GET /api/templates`

Lista somente templates que possuam ao menos uma página válida. Uma página é
válida para a listagem quando contém `manifest.json` com JSON válido e
`index.html`. Páginas inválidas são omitidas sem impedir a listagem das demais
e geram diagnóstico no log do servidor.

### `GET /api/templates/:template/:page`

Retorna manifest, HTML, CSS e logo resolvida da página.

Falhas distinguem template ou página ausente (`404 TEMPLATE_NOT_FOUND`),
manifest inválido (`500 TEMPLATE_INVALID`), arquivo obrigatório ilegível
(`500 TEMPLATE_FILE_UNREADABLE`), asset remoto indisponível
(`502 TEMPLATE_REMOTE_ASSET_FAILED`) e erro inesperado
(`500 TEMPLATE_LOAD_FAILED`).

### `POST /api/news/extract`

Extrai os dados usados pela arte.

```json
{
  "url": "https://exemplo.com/noticia"
}
```

Resposta:

```json
{
  "h1": "Título",
  "h2": "Subtítulo",
  "chapeu": "Categoria",
  "bg": "data:image/jpeg;base64,...",
  "bgSource": "https://exemplo.com/imagem.jpg"
}
```

A importação só responde com sucesso quando título, subtítulo, chapéu e
imagem estão presentes e a imagem foi validada e incorporada. Conteúdo
incompleto retorna `422 NEWS_EXTRACTION_INCOMPLETE` sem dados editoriais
parciais.

O download do PNG não possui endpoint: ele acontece no navegador.

## Templates

Cada página de template contém seu HTML e manifest. CSS e fontes compartilhadas ficam no diretório do template.

```text
templates/
  <template>/
    css/
    fonts/                 # opcional
    <page>/
      index.html
      manifest.json
```

O manifest define:

- dimensões da arte;
- logo padrão;
- bindings de texto, HTML, imagem e logo;
- variáveis CSS, classes e atributos dinâmicos.

Exemplo de binding:

```json
{
  "selector": "#title",
  "type": "text",
  "field": "h1"
}
```

## Estrutura principal

```text
src/
  server.js
  appConfig.js
  routes/
    news.js
    templates.js
  services/
    newsScraper.js
  lib/
    assetResolver.js
    manifestLoader.js

public/
  index.html
  script.js
  js/
    api.js
    frontend-utils.js
    preview-export.js
    preview-runtime.js
  vendor/
    html-to-image.js

templates/                 # layouts, manifests, CSS e fontes
input/                     # logos e outros assets locais
```

## CORS e imagens

Imagens encontradas pelo scraper são baixadas pelo servidor e incorporadas no retorno, portanto não dependem do CORS da origem.

Uma URL digitada diretamente no campo **Imagem manual** ainda precisa permitir leitura cross-origin. Se não permitir, a exportação é interrompida com uma mensagem de erro em vez de produzir uma arte sem imagem.

## Operação

- O servidor não inicia processos de navegador.
- Cada cliente realiza sua própria exportação.
- Não existe fila global nem resposta `409` por geração concorrente.
- A imagem extraída possui limite de 12 MB e timeout de 15 segundos.
- O bundle de `html-to-image` 1.11.13 fica versionado em `public/vendor`, sem instalação adicional nem dependência de CDN em produção.

Veja [DEPLOY.md](DEPLOY.md) para publicação em produção.
