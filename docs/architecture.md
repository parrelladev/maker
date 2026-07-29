# Arquitetura atual do Maker

Este documento descreve a arquitetura observada no código atual. Ele registra o
comportamento existente; não define uma arquitetura-alvo.

## Finalidade da aplicação

O Maker é uma aplicação web para produzir artes PNG a partir de templates
HTML/CSS e dados de notícias. O servidor fornece a interface, os templates e
serviços de leitura de notícias e imagens. O navegador monta um preview em um
`iframe`, aplica os dados ao DOM do template e exporta esse mesmo DOM como PNG.

Não há renderização de PNG, Chromium ou fila de geração no backend. Cada cliente
faz sua própria exportação.

```text
notícia remota ──> backend ──> dados + imagem incorporada
                                  |
template em disco ──> backend ────+──> frontend
                                          |
                                          v
                                  DOM dentro do iframe
                                    |             |
                                    v             v
                                 preview       PNG local
```

## Estrutura de diretórios

```text
.
├── src/
│   ├── server.js                  # composição e inicialização do Express
│   ├── server.test.js             # testes HTTP e do entrypoint
│   ├── appConfig.js               # resolução da porta
│   ├── routes/
│   │   ├── templates.js           # listagem e carregamento de templates
│   │   └── news.js                # extração e incorporação de imagens
│   ├── services/
│   │   ├── newsScraper.js              # download e parsing de notícias
│   │   ├── newsScraper.test.js         # testes do chapéu
│   │   ├── templatePageService.js      # montagem de página de template
│   │   └── templatePageService.test.js # testes unitários da montagem
│   └── lib/
│       ├── manifestLoader.js       # descoberta e leitura de manifests
│       ├── assetResolver.js        # resolução de logos locais/remotas
│       ├── httpErrorResponse.js    # erros públicos e logs HTTP
│       ├── imageValidator.js       # MIME, tamanho e assinatura de imagens
│       ├── imageValidator.test.js  # testes da validação binária
│       ├── remoteRequestPolicy.js  # limites dos downloads remotos
│       ├── remoteRequestPolicy.test.js # testes dos limites compartilhados
│       ├── safeHttpClient.js       # cliente compartilhado para URLs remotas
│       ├── safeHttpClient.test.js  # classificação e controles do cliente
│       ├── svgSanitizer.js         # parsing XML e allowlist de SVG
│       └── svgSanitizer.test.js    # SVGs válidos e conteúdo ativo
├── public/
│   ├── index.html                 # estrutura da interface e do modal
│   ├── styles.css                 # apresentação da interface
│   ├── script.js                  # catálogo, estado e orquestração
│   ├── js/
│   │   ├── api.js                 # cliente HTTP e cache de templates
│   │   └── preview-export.js      # captura e download do PNG
│   ├── vendor/html-to-image.js    # biblioteca versionada de exportação
│   └── previews/                  # miniaturas usadas pelo catálogo
├── templates/
│   └── <template>/
│       ├── css/                   # CSS compartilhado e temas
│       ├── fonts/                 # fontes opcionais
│       └── <page>/
│           ├── index.html         # fragmento HTML da arte
│           └── manifest.json      # dimensões e bindings
├── input/                         # logos e outros assets locais
├── deploy.js                      # criação interativa de config.js
├── config.example.js
└── README.md / DEPLOY.md
```

O diretório `public` é servido na raiz. `input` e `templates` são expostos,
respectivamente, em `/input` e `/templates`. Isso permite que o documento do
`iframe` carregue arquivos referenciados pelos templates.

## Módulos e responsabilidades

### Backend

`src/server.js` cria o Express, configura JSON com limite de 2 MB, monta os
diretórios estáticos e os routers, registra uma resposta para `/`, um middleware
global de erro e exporta `app`. A escuta é iniciada somente quando o arquivo é
executado diretamente, protegida por `require.main === module`; importar o
módulo não abre uma porta.

`src/appConfig.js` resolve a porta nesta ordem:

1. variável de ambiente `PORT`;
2. `port` de `config.js`, caso o arquivo exista e possa ser importado;
3. valor padrão `3000`.

`src/lib/manifestLoader.js` conhece a estrutura física de `templates`.
`inspectTemplateCatalog` percorre templates e páginas e separa o catálogo válido
dos diagnósticos internos. Manifest ausente, JSON inválido e `index.html`
ausente invalidam somente a página correspondente. `listTemplates` retorna o
catálogo válido e registra os diagnósticos; templates sem páginas válidas não
entram na lista pública. `loadManifest` valida a presença dos diretórios, do
manifest e do `index.html` e retorna o manifest junto com os caminhos
resolvidos.

`src/lib/assetResolver.js` resolve a logo padrão declarada no manifest:

- SVG local ou remoto é lido como markup e retornado como `inline-svg`;
- imagem remota não SVG conserva a própria URL;
- imagem local não SVG é localizada em `input`;
- nomes sem extensão são procurados nas extensões suportadas;
- dados estáveis dos resultados são guardados no `LOGO_CACHE`, indexado pelo
  valor original; o texto alternativo é aplicado separadamente a cada chamada;
- valores ausentes, logos locais não encontradas, respostas remotas inválidas e
  erros de download não entram no cache. Uma chamada posterior tenta resolver
  o asset novamente.

A chave do `LOGO_CACHE` é o `manifest.defaultLogo` carregado pelo serviço de
páginas. O cache mantém no máximo 32 resoluções bem-sucedidas. Ao inserir uma
nova chave no limite, remove a chave inserida há mais tempo (FIFO); consultar uma
chave existente não altera essa ordem. Não há TTL nem invalidação quando um
manifest ou asset muda no filesystem.

Os parâmetros `template` e `page` da rota ainda não são confinados a
`TEMPLATE_ROOT`. Parâmetros codificados podem selecionar caminhos fora dessa
raiz e, consequentemente, manifests que não pertencem ao catálogo normal. O
limite do cache reduz o impacto desse caminho sobre memória, mas não corrige a
travessia de diretórios, que permanece uma tarefa de segurança separada e
prioritária.

`src/lib/safeHttpClient.js` centraliza os downloads feitos pelo servidor. Antes
da conexão, valida protocolo e credenciais, resolve e fixa o endereço DNS e
rejeita endereços não públicos IPv4 e IPv6. O mesmo processo ocorre em cada
redirecionamento, que é seguido explicitamente pelo cliente. O `lookup`
Promise-based entrega ao Axios somente endereços previamente validados, sem
alterar hostname, `Host`, TLS ou SNI. Cada consumidor fornece timeout, limite de
bytes e quantidade máxima de redirecionamentos; os erros operacionais são
classificados. O timeout cria uma única deadline monotônica para a operação
completa: DNS, conexão, resposta e redirects compartilham o mesmo orçamento, e
cada chamada Axios recebe somente o tempo restante.

`src/lib/remoteRequestPolicy.js` centraliza, em três perfis imutáveis, timeout,
limite de bytes, máximo compartilhado de redirects e os `User-Agent`s usados
pelos downloads de HTML e imagem. O perfil de SVG preserva a ausência de
`User-Agent` adicional. Os consumidores acrescentam somente o `responseType`
adequado ao chamar `safeHttpClient`.

`src/lib/imageValidator.js` valida a resposta binária usada na incorporação de
imagens. Ele aceita apenas PNG, JPEG, GIF e WebP, normaliza parâmetros do MIME,
rejeita corpo vazio ou acima do limite e compara uma assinatura básica com o
tipo declarado. As falhas usam mensagens classificadas e estáveis.

`src/lib/httpErrorResponse.js` separa respostas públicas de diagnóstico
interno. Ele reconhece categorias estáveis do cliente HTTP, classifica erros do
parser JSON e registra método, rota, status, código público e o erro original
somente no log do servidor.

`src/lib/svgSanitizer.js` usa o parser XML estrito `saxes` e reconstrói o SVG a
partir de allowlists de elementos, atributos e valores. Scripts,
`foreignObject`, handlers, estilos inline, elementos de animação, CSS
arbitrário, referências externas e valores CSS ofuscados não entram no markup
resultante. Somente regras locais com seletor de classe simples e propriedades
de apresentação reconhecidas são convertidas em atributos validados; o elemento
`style` nunca permanece no resultado. XML malformado e documentos sem raiz SVG
são rejeitados. O mesmo sanitizador atende assets locais e remotos.

`src/services/newsScraper.js` baixa o HTML da notícia e usa Cheerio para extrair
título, subtítulo, imagem e chapéu. O texto é normalizado e limitado. A
responsabilidade de baixar a imagem extraída não pertence a esse serviço.

`src/services/templatePageService.js` carrega e valida o manifest, lê HTML e
CSS compartilhado e específico da página, resolve a logo e monta o modelo
entregue pela API. Falhas ao resolver a logo são registradas e preservam
`resolvedLogo: null`.

`src/routes/templates.js` lista templates e converte o resultado ou os erros do
serviço de página em HTTP. `src/routes/news.js` converte extração e incorporação
de imagem em HTTP e contém a função privada `embedImage`.

### Frontend

`public/index.html` define a grade, o modal, campos manuais, controles, o
`iframe`, loading e toasts. Ele carrega `api.js`, `preview-export.js` e
`script.js`, nessa ordem.

`public/js/api.js` expõe `window.Api`:

- `loadManifest` chama a API de template e mantém um cache por
  `<template>/<page>`;
- `extractNewsData` chama a extração, registra erros e retorna `{}` em falha;
- `embedImage` solicita ao backend uma data URL e propaga uma mensagem de erro.

`public/script.js` mantém o catálogo visível, o estado global da tela e a
orquestração dos fluxos. Ele também gera como string o runtime de bindings
executado no `iframe`.

`public/js/preview-export.js` expõe `window.PreviewExport`. O módulo espera
fontes e imagens, verifica imagens HTTP(S), chama `html-to-image` dentro do
`iframe` e inicia o download por meio de um link temporário.

## Listagem e carregamento de templates

Há dois mecanismos distintos de listagem:

1. `GET /api/templates` lista o conteúdo válido encontrado no filesystem por
   meio de `listTemplates`. A resposta expõe nome, logo e dimensões somente de
   páginas que possuam manifest com JSON válido e `index.html`. Manifest
   ausente, JSON inválido ou HTML ausente gera um diagnóstico interno com
   template, página e código estável, é registrado no servidor e não impede que
   as demais páginas sejam retornadas. Testes e ferramentas internas podem
   consultar `{ templates, diagnostics }` por `inspectTemplateCatalog`; os
   diagnósticos não fazem parte da API pública.
2. A interface atual não consome esse endpoint. Os cards são construídos a
   partir do array estático `storyTemplates` em `public/script.js`, que também
   define grupos, nomes, miniaturas, temas e estado “Em construção”.

Ao clicar em um card, `openModal` define `currentTemplate`, configura o tema,
limpa os campos e caches de tela, esvazia o `iframe` e abre o modal. O template
propriamente dito só é carregado quando `ensurePreviewInitialized` ou o fluxo de
geração chama:

```text
Api.loadManifest(template, "index")
    |
    v
GET /api/templates/:template/:page
    |
    +--> templatePageService.loadTemplatePage()
              +--> loadManifest() ──> manifest.json + index.html
              +--> readCssFrom(template/css)
              +--> readCssFrom(template/page)
              +--> resolveLogoAsset(defaultLogo)
    |
    v
{ template, page, manifest, html, css[], resolvedLogo }
```

Os arquivos CSS do diretório compartilhado são retornados antes dos CSS da
página. Dentro de cada diretório, os arquivos CSS são ordenados pelo nome com
comparação lexical. O frontend concatena o conteúdo recebido na mesma ordem.

Ausência de template, página, manifest ou HTML é convertida em HTTP 404 com
`TEMPLATE_NOT_FOUND`. Manifest JSON inválido usa `500 TEMPLATE_INVALID`;
arquivo obrigatório ilegível usa `500 TEMPLATE_FILE_UNREADABLE`; e falhas
inesperadas usam `500 TEMPLATE_LOAD_FAILED`. Falhas ao resolver uma logo local
são registradas internamente e resultam em `resolvedLogo: null`; falhas de
assets remotos usam `502 TEMPLATE_REMOTE_ASSET_FAILED`.

## Extração de notícias

O fluxo parte de “Buscar dados da matéria” ou da geração:

```text
URL digitada
   |
   v
getOrExtractNewsData(url)
   |  cache válido somente se lastNewsUrl === url
   v
POST /api/news/extract
   |
   +--> newsScraper.fetch(url)
   |      +--> safeHttpClient.get(HTML)
   |      +--> cheerio.load
   |      +--> título: og:title -> title -> primeiro h1
   |      +--> subtítulo: og:description -> description -> primeiro h2
   |      +--> imagem: og:image -> meta image -> primeira img
   |      `--> chapéu: seletor legado -> seção anterior ao h1 atual
   |
   `--> embedImage(bg)
          `--> URL HTTP(S): segundo download ──> data URL
          `--> referência relativa: valor preservado
```

`cleanText` reduz espaços, remove bordas em branco e limita título a 120
caracteres, subtítulo a 220 e chapéu a 80.

Na resposta bem-sucedida, quando a imagem encontrada é uma URL HTTP ou HTTPS,
`bg` contém a imagem incorporada e `bgSource` conserva a URL extraída.
Referências relativas são preservadas em ambos os campos, sem resolução contra
a URL da notícia. A resposta também contém `h1`, `h2` e `chapeu`. Ausência da
URL gera HTTP 400; URL inválida, protocolo não permitido ou credenciais
embutidas também geram HTTP 400. Falha de download, parsing ou incorporação
gera HTTP 500.

No frontend, o resultado é guardado em `lastNewsData` e associado a
`lastNewsUrl`. Ao buscar explicitamente, os campos manuais vazios são
preenchidos com os valores extraídos antes de atualizar o preview.

## Resolução e incorporação de imagens

Existem fluxos diferentes para imagem de notícia, imagem manual e logo.

### Imagem extraída

Quando o valor encontrado pelo scraper é uma URL HTTP ou HTTPS, `embedImage` em
`routes/news.js` faz um segundo download com o cliente HTTP compartilhado. Ele
usa timeout de 15 segundos, limite de 12 MB durante o recebimento, até três
redirecionamentos e exige PNG, JPEG, GIF ou WebP com assinatura básica
compatível com o `Content-Type`. O buffer vira
`data:<tipo>;base64,...`. Referências relativas de imagem não passam por esse
download e são preservadas sem resolução contra a URL da notícia.

Assim, normalmente a imagem extraída já chega ao navegador incorporada e não
depende de CORS durante a captura.

### Imagem manual

O preview usa diretamente a URL digitada no campo manual. Na geração, se a
imagem efetiva ainda for HTTP(S), o frontend chama
`POST /api/news/embed-image`; a data URL retornada é aplicada novamente ao
preview como `backgroundOverride` antes da captura.

`preview-export.js` também percorre elementos `img` do documento e faz
requisições CORS para URLs HTTP(S) remanescentes. Uma falha interrompe a
exportação.

### Logo

A rota de template chama `resolveLogoAsset`. SVGs são enviados como markup;
imagens são representadas por `src`. Para arquivos locais não SVG, a rota troca
o caminho físico por `/input/<defaultLogo>`. Se a resolução falhar, o frontend
tenta um fallback derivado diretamente de `defaultLogo`.

## Construção do preview e funcionamento do iframe

`ensurePreviewInitialized` evita recarregar enquanto
`previewInitializedTemplate` e `currentManifestData` correspondem ao template
atual. Quando inicializa:

1. carrega HTML, CSS, manifest e logo;
2. concatena o CSS;
3. serializa o manifest dentro de um script;
4. monta um documento HTML completo;
5. define `<base href="/templates/<template>/<page>/">`;
6. inclui o fragmento HTML do template;
7. carrega `/vendor/html-to-image.js`;
8. inclui o runtime de bindings;
9. grava tudo com `frameDoc.open/write/close`.

O `iframe` não usa atributo `sandbox`. Como o documento é escrito pelo pai e
permanece na mesma origem, o frontend acessa diretamente `contentDocument` e
`contentWindow`.

Há duas escalas:

- `resizePreviewFrame` aplica um `transform` ao próprio `iframe`, calculado pela
  largura do wrapper e por uma largura fixa de 1080;
- `applyPreviewScale`, dentro do iframe, escala o elemento `html` de acordo com
  as dimensões do manifest e o viewport interno.

O runtime publica `window.__updatePreview`. `updatePreview` constrói o payload
atual e chama essa função, que muta o DOM do template e reaplica a escala. O
placeholder é ocultado assim que o documento é inicializado.

## Bindings do manifest

O runtime lê quatro coleções opcionais:

- `bindings`: atualizam conteúdo de elementos;
- `cssVars`: definem propriedades CSS;
- `classes`: adicionam classes;
- `attributes`: definem atributos.

Valores podem vir de `entry.value` ou de `entry.field`. Campos aceitam caminhos
separados por ponto, resolvidos por `getValue`. Valor explícito tem precedência
sobre `field`. Entradas incompletas, seletores sem alvos e valores `undefined`
ou `null` são ignorados.

Tipos suportados em `bindings`:

- `text` ou tipo ausente: atribui `textContent`;
- `html`: atribui `innerHTML`;
- `image`: atribui `src`;
- `logo`: incorpora SVG em `innerHTML`, atribui `src` em `<img>` ou usa
  `backgroundImage` em outro elemento.

`cssVars` usa `style.setProperty`; `classes` converte array, string ou valor
escalar em nomes de classe e apenas os adiciona; `attributes` usa
`setAttribute`.

Os manifests atuais ligam `resolvedBg`, `resolvedLogo`, `h1`, `h2` e `tag`.
Alguns também alteram o `href` de `#themeStylesheet` e o atributo `data-theme`
do elemento `html`. Todos declaram dimensões de 1080 × 1920. O runtime suporta
mais tipos de binding do que os manifests atuais exercitam.

O atributo `required` presente em alguns bindings é enviado ao frontend, mas o
runtime não o interpreta. As validações de categoria e imagem na geração estão
codificadas em `generateArtWithPreviewFlow`.

## Exportação para PNG

`generateArtWithPreviewFlow` valida template, URL da notícia e URL manual,
mostra o loading e então:

1. carrega novamente os dados do template, usando o cache de `Api`;
2. obtém ou reutiliza a extração associada à URL atual;
3. exige categoria efetiva e imagem efetiva;
4. incorpora pelo backend uma imagem efetiva ainda remota;
5. atualiza o mesmo DOM do preview com a imagem exportável;
6. chama `PreviewExport.downloadPreview`.

Antes da captura, `downloadPreview` espera `document.fonts.ready`, aguarda
imagens e verifica URLs de imagem remotas. Em seguida chama
`frameWindow.htmlToImage.toBlob` sobre o `documentElement` do iframe.

Largura e altura vêm de `manifest.dimensions`, com fallbacks 1080 × 1920. A
captura usa `pixelRatio: 1`, fundo preto, desativa a escala automática e
sobrescreve no clone o tamanho e o `transform`, para remover a escala visual do
preview.

O blob resultante é associado a uma object URL; um `<a download>` temporário é
clicado e removido, e a URL é revogada depois de um segundo. O nome atual é
`<template>-<page>.png`. O loading é restaurado no bloco `finally`, inclusive
em retornos antecipados dentro do `try`.

## Precedência de valores

`buildPreviewData` estabelece a precedência usada ao atualizar o DOM:

```text
título/subtítulo:
  campo manual -> extração da URL atual -> ""

tag:
  campo manual -> chapéu extraído da URL atual -> ""

imagem no preview comum:
  campo manual -> imagem extraída da URL atual -> ""

imagem ao preparar exportação:
  backgroundOverride incorporado -> campo manual -> imagem extraída -> ""

tema:
  currentTheme -> null

logo:
  defaultLogo do manifest -> fallback literal "logo-a-gazeta"
  resolvedLogo da API -> fallback construído no frontend -> null

dimensões:
  manifest.dimensions -> 1080 x 1920
```

Somente dados cujo `lastNewsUrl` coincide exatamente com o valor atual do campo
de URL participam de `buildPreviewData`. Isso impede que o cache de uma notícia
anterior seja usado após a URL ser editada.

Há uma diferença importante entre origem e conteúdo dos campos: depois de
“Buscar dados”, valores extraídos são copiados para os inputs manuais vazios.
A partir daí, o preview os trata como valores manuais. Uma nova extração não
sobrescreve inputs que já estejam preenchidos.

## Estado global do frontend

As variáveis a seguir vivem no escopo global de `public/script.js`:

| Variável | Responsabilidade |
| --- | --- |
| `storyTemplates` | catálogo estático exibido na interface |
| `templateLookup` | índice do catálogo por ID |
| `storyGroups` | grupos derivados do catálogo |
| `currentTemplate` | ID do template aberto |
| `currentTemplateMeta` | metadados estáticos do card aberto |
| `currentTheme` | tema selecionado |
| `activeStoryGroup` | grupo de cards visível |
| `lastNewsData` | último resultado de extração |
| `lastNewsUrl` | URL à qual o resultado está associado |
| `currentManifestData` | última resposta de página carregada |
| `previewInitializedTemplate` | template atualmente escrito no iframe |

O arquivo também conserva referências globais aos elementos do DOM. Em
`api.js`, `manifestCache` é estado persistente privado da IIFE, indexado por
template e página e preenchido somente após uma resposta bem-sucedida. No
backend, `LOGO_CACHE` persiste no processo e é indexado pelo valor da logo
declarado em manifest local. O cache não inclui o texto alternativo recebido na
chamada nem resultados nulos ou falhas de resolução.

Abrir ou fechar o modal limpa os estados da notícia e do preview. Trocar tema
preserva o template e os dados e solicita uma atualização do preview.

## Dependências entre frontend e backend

Os contratos principais são:

| Frontend | Endpoint/backend | Dados esperados |
| --- | --- | --- |
| `Api.loadManifest` | `GET /api/templates/:template/:page` | manifest, HTML, CSS, logo resolvida, nomes |
| `Api.extractNewsData` | `POST /api/news/extract` | `h1`, `h2`, `chapeu`, `bg`, `bgSource` |
| `Api.embedImage` | `POST /api/news/embed-image` | `dataUrl` |
| documento do iframe | estáticos `/templates`, `/input`, `/vendor` | CSS, fontes, imagens e biblioteca |

O frontend conhece detalhes do schema do manifest, convenções de caminhos,
nome da página `index`, nomes de campos (`h1`, `h2`, `tag`, `resolvedBg`,
`resolvedLogo`) e convenção `theme-<tema>.css`. O backend conhece a organização
física de templates e assets, mas não executa bindings.

O endpoint de listagem é independente do catálogo atualmente renderizado. Por
isso, adicionar um template no filesystem não cria automaticamente um card, e
um card estático pode apontar para conteúdo ausente.

## Principais efeitos colaterais

No backend:

- leitura síncrona de configuração, manifests, HTML, CSS, logos e diretórios;
- abertura da porta HTTP quando `server.js` é executado como entrypoint;
- requisições HTTP para notícias, imagens e SVGs remotos;
- mutação dos caches em memória;
- logs de configuração, servidor, chapéu e erros; logs de requisição com falha
  incluem o erro original e contexto operacional.

No frontend:

- instalação de listeners globais e em elementos;
- mutação do catálogo, modal, campos, loading, toasts e estilos;
- escrita integral do documento do iframe;
- requisições HTTP à API e, na validação, a imagens remotas;
- mutação do DOM do template a cada binding;
- timers para escala, remoção de toast e revogação de object URL;
- criação de blob/object URL e clique programático para download;
- logs no console;
- carregamento de fontes externas declarado em `index.html`.

## Pontos atualmente difíceis de testar

- A composição do Express permanece no mesmo módulo do entrypoint, embora o
  guard de `require.main` permita importar o app sem abrir a porta configurada.
- As rotas acessam diretamente filesystem e serviços importados, sem
  pontos explícitos de injeção.
- `templates.js` combina roteamento, leitura de HTML/CSS, ordenação, resolução
  de logo e tradução de erros.
- `news.js` combina contrato HTTP e download/conversão de imagem; `embedImage`
  não é exportada.
- O frontend está concentrado em um script global acoplado ao DOM real e a
  objetos `window`.
- O runtime de bindings existe como uma string interpolada, executada apenas
  depois de `document.write` no iframe.
- Preview e exportação dependem de APIs de navegador, fontes, carregamento de
  imagens, CORS, timing e `html-to-image`.
- Listeners de inputs descartam rejeições de `updatePreview` com
  `catch(() => {})`, embora a função também trate erros internamente.
- Operações assíncronas de extração e inicialização não carregam um identificador
  de requisição; respostas atrasadas podem atualizar o estado depois de uma
  mudança de URL ou template.
- Os caches do frontend e do backend persistem no escopo do módulo/processo e
  não têm API de limpeza ou invalidação. O cache de logos limita-se a 32
  entradas com descarte FIFO; alterações de manifest ou asset durante a
  execução só são observadas depois de reiniciar o processo e recarregar a
  página.
- Os manifests atuais não exercitam todos os tipos aceitos pelo runtime.
- A suíte automatizada cobre rotas HTTP, carregamento de templates, requisições
  externas simuladas e o cliente HTTP seguro, mas não cobre precedência,
  bindings, loading ou exportação no navegador.

## Riscos e limitações observados

- Os downloads do backend passam pelo cliente compartilhado, que bloqueia
  endereços não públicos e revalida redirecionamentos. Um teste local exercita
  Axios, lookup e socket reais; respostas comprimidas e redirects reais ainda
  não são exercitados de ponta a ponta.
- Notícias, imagens e SVG remoto possuem timeout, limite de bytes e limite de
  redirecionamentos. Notícias aceitam `text/html` e `application/xhtml+xml`;
  SVG remoto exige `image/svg+xml`.
- SVG remoto ou local continua inserido como `innerHTML`, mas o markup passa por
  parsing XML estrito, gramáticas restritas de valores e allowlists antes de ser
  retornado. Os testes preservam propriedades estruturais e de apresentação
  essenciais dos quatro logos atuais, mas não demonstram equivalência visual
  completa nem substituem validação em navegador.
- Rotas e middleware global retornam mensagens e códigos públicos estáveis;
  caminhos, stacks e mensagens originais permanecem somente nos logs internos.
- A API de extração converte falhas em `{}` no cliente, perdendo o detalhe da
  resposta antes que o fluxo principal trate o resultado.
- A listagem do frontend e a listagem do backend podem divergir.
- A ordem dos CSS depende da ordem do filesystem.
- O cálculo externo de escala pressupõe largura de design de 1080, enquanto o
  runtime interno e a exportação consultam o manifest.
- `classes` apenas adiciona classes; atualizações posteriores não removem
  classes aplicadas por valores anteriores.
- O runtime aceita binding `html`, que escreve conteúdo com `innerHTML`; a
  segurança depende da origem e do controle dos dados declarados no manifest.
- O atributo `required` dos bindings não é uma regra genérica executada pelo
  runtime.
- A ausência de isolamento por `sandbox` torna o iframe dependente da confiança
  nos templates e scripts que ele carrega.
- A cobertura automatizada atual não demonstra preservação dos fluxos
  completos descritos neste documento.
