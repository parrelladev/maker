# Arquitetura atual do Maker

## Shell do editor em tela única

A interface principal em `public/index.html` usa um shell de tela única com
header, sidebar de edição, workspace e barra inferior de status e exportação. O
preview ocupa a área dominante do workspace e conserva o `iframe` real usado
pelo renderer e pela exportação; não existe um mock visual intermediário. O
viewport ao redor do iframe é dimensionável e prepara a interface para outras
proporções, embora Story permaneça o único modo funcional nesta etapa.

O novo editor é o único fluxo UX ativo. O bootstrap carrega o catálogo editorial,
cria a `publication`, resolve o renderer e entrega o preview à ponte técnica. O
catálogo visual antigo, os cards, `#templateModal`, `#modalTitle` e `#closeModal`
não fazem parte do DOM nem da inicialização. **Nova arte** reinicia diretamente a
`publication`; não existe retorno a catálogo ou abertura de modal. Story é o
primeiro formato operacional integrado; Feed, Comparar e Baixar ambos permanecem
visíveis, mas não estão implementados.

Este documento descreve a arquitetura observada no código atual. Ele registra o
comportamento existente; não define uma arquitetura-alvo.

## Estado editorial central (fundacional)

`public/js/editor-state.js` introduz `publication` como o futuro estado editorial
central do Maker. O objeto mantém `brand` e `family`, um único `content`
compartilhado com URL, título, subtítulo, tag e imagem, e configurações visuais
independentes por formato. Feed e Story possuem separadamente variante, tema e
ajustes de imagem.

Estado transitório da interface, como formato aberto, sidebar, loading, toast,
iframe ou identidade de operações assíncronas, não pertence a `publication`.
O módulo continua sem dependência de DOM, templates ou marcas específicas e
agora é a fonte de verdade editorial do shell. `editor-ui.js` cria uma
`publication`, deriva do catálogo a primeira combinação Story válida e aplica
as trocas de marca, família, variante, tema e campos de conteúdo por meio das
funções de `editor-state.js`.

## Registry de marcas (fundacional)

O diretório `brands/<brandId>` concentra a identidade de cada marca em
`brand.json`, `logos/` e `fonts/`. Logos e fontes pertencem à marca e são
referenciados por aliases semânticos estáveis, como `primary` e
`headline.black`, sem obrigar consumidores a conhecer filenames ou caminhos
globais.

`src/lib/brandRegistry.js` descobre marcas válidas, carrega seus metadados e
resolve aliases com confinamento à pasta da marca. A representação de listagem
expõe somente `id` e `name`; paths absolutos permanecem internos ao loader. O
registry ainda não está exposto por HTTP nem integrado ao editor.

Marca e template são responsabilidades separadas: logos e fontes pertencem à
marca; composição pertence à variante; dimensões pertencem ao formato; tema
não deve ser confundido com identidade estrutural. Os templates existentes
continuam usando seus assets atuais até uma migração posterior e incremental.

## Schema editorial dos manifests (fundacional)

O manifest continua sendo o contrato técnico declarativo do renderer e pode
também declarar sua posição no domínio editorial segundo a hierarquia:

```text
Marca → Família → Variante → Formato → Tema
```

- **Marca** identifica a identidade e os assets mantidos pelo Brand Registry.
- **Família** identifica uma linguagem gráfica dentro da marca.
- **Variante** identifica a composição estrutural/editorial.
- **Formato** identifica dimensões e canal; seus IDs são abertos a extensões.
- **Tema** identifica aparência, principalmente cor, sem criar outra variante.

Manifests editoriais usam `editor` com `brand`, `family`, `variant` e `label`,
um objeto não vazio `formats`, cujas entradas possuem `dimensions`, e podem
declarar `themes` como objetos `{ id, label }`. A marca é apenas referenciada
por ID: nomes, logos, fontes e paths continuam pertencendo ao Brand Registry.

`src/lib/templateManifest.js` valida e normaliza esse contrato sem consultar o
filesystem nem manter enums de famílias, variantes ou formatos. A representação
normalizada expõe `editorial`, `formats` e `themes`. Para um único formato,
também deriva `dimensions` em memória para os consumidores técnicos atuais;
`formats` prevalece caso o arquivo contenha também a propriedade legada. Com
múltiplos formatos não há escolha implícita e `dimensions` não é derivada.

Manifests sem `editor` são legados e continuam válidos, com `editorial: null` e
suas `dimensions` originais. Essa compatibilidade permite migração incremental.
O path físico do template não define marca, família, variante ou formato: a
identidade vem exclusivamente dos metadados. Um mesmo renderer técnico pode,
portanto, declarar vários formatos e temas sem que a organização de arquivos
se torne parte do domínio.

## Catálogo editorial derivado

`src/lib/editorCatalog.js` reúne os manifests editoriais descobertos por
`inspectTemplateCatalog()` na hierarquia pública marca → família → variante →
formato → tema. Ele não mantém listas de IDs conhecidas: a identidade e o nome
da marca vêm do Brand Registry, enquanto família, variante, formatos, dimensões
e temas vêm dos manifests. Como ainda não existe um registry de famílias, o ID
da família também é usado temporariamente como seu label.

`getEditorialMetadata()` é a única fronteira usada para interpretar o domínio
editorial do manifest. Seu retorno `null` identifica manifests legados, que
continuam disponíveis para o renderer técnico, mas não entram no catálogo e não
recebem identidade inferida por diretório ou filename. Uma marca referenciada
por manifest precisa existir no Brand Registry; referências desconhecidas
interrompem a construção com um erro de configuração explícito.

Manifests com a mesma combinação marca/família/variante são agregados em uma
única variante, permitindo que renderers diferentes acrescentem formatos como
`story`, `feed` ou qualquer ID futuro. Labels divergentes para essa variante e
renderers técnicos diferentes para a mesma combinação completa até formato são
conflitos explícitos, nunca escolhas baseadas na ordem do filesystem.

O catálogo público contém somente IDs, labels, nome de marca, dimensões e temas,
todos ordenados deterministicamente por ID. A referência técnica relativa
`{ template, page }` fica em um índice privado e é obtida por
`resolveRenderer()` com seleção exata de marca, família, variante e formato;
tema não escolhe renderer e não há fallback para a primeira opção. Nenhum path
absoluto ou raiz do filesystem faz parte da representação serializável.

O navegador obtém essa representação em `GET /api/editor/catalog`. A referência
técnica permanece no índice privado: `POST /api/editor/resolve` recebe marca,
família, variante e formato, chama `resolveRenderer()` e devolve somente
`template`, `page`, dimensões e temas. Trocas de tema não usam essa rota porque
tema não participa da chave do renderer.

`public/js/editor-catalog.js` contém apenas helpers puros de navegação e seleção
válida; descoberta, conflitos e resolução técnica continuam exclusivamente no
backend. `public/js/editor-ui.js` renderiza selects e botões acessíveis a partir
dos dados recebidos e usa um identificador monotônico para descartar resoluções
ou inicializações de preview obsoletas. O controller também mantém o estado
transitório `idle/loading/ready/error`: mudanças de renderer bloqueiam a
exportação antes da primeira espera assíncrona e somente a liberam depois que a
ponte legada conclui a atualização efetiva do iframe para a seleção atual.

### Ponte temporária com o editor legado

O objeto `LegacyEditorBridge`, definido em `public/script.js`, concentra a
compatibilidade entre a seleção editorial resolvida e
`currentTemplate`/`currentPage`/`currentTheme`. O controller novo entrega o
renderer a essa ponte, que reutiliza o iframe, o runtime de bindings e a
exportação existentes. O select oculto `#customTheme` também é sincronizado
somente nessa fronteira; a interação do usuário ocorre nos botões de tema do
novo shell. Essa ponte é transitória e não torna o script legado fonte de
verdade editorial.

No schema atual, `themes` pertence ao renderer como um todo. Assim, todos os
formatos declarados pelo mesmo manifest compartilham o mesmo conjunto de temas;
temas específicos por formato exigiriam uma evolução futura do schema.

### Importação de notícia no editor

O botão **Importar notícia** pertence a `public/js/editor-ui.js`. O controller
valida a URL com a regra HTTP/HTTPS já usada pelo frontend, adapta o contrato de
transporte `{ h1, h2, chapeu, bg }` para um patch editorial de
`{ title, subtitle, tag, image }` e aplica esse patch atomicamente ao `content`
compartilhado da `publication`. Somente valores não vazios entram no patch;
campos ausentes preservam o conteúdo editorial atual. Em seguida, os campos do
shell são derivados da `publication` e o mesmo renderer atualmente selecionado
recebe uma única atualização de dados, sem nova chamada a `/api/editor/resolve`.

A ponte `LegacyEditorBridge` ainda encapsula a chamada ao cache de extração
existente, a provenance técnica da imagem e a aplicação no runtime do iframe.
Resultados vazios continuam não cacheáveis. O controller mantém uma identidade
monotônica da importação e compara também a URL editorial atual: respostas
anteriores a outra importação, a uma edição de URL ou a **Nova arte** são
descartadas silenciosamente. Trocar variante durante a requisição não invalida
o conteúdo; a resposta é aplicada ao renderer que estiver atual.

Durante a importação, a razão composta `news-import` bloqueia **Baixar atual**.
Qualquer mudança de `publication.content` também inicia uma sincronização
versionada e mantém a razão `content-sync` ativa até o snapshot editorial atual
ser aplicado efetivamente ao runtime do iframe. Conclusões obsoletas não podem
remover essa razão nem alterar o status. `content-sync` compõe com os bloqueios
independentes `editor-preview` e `export`, e a guarda programática do download
também exige que não haja sincronização de conteúdo pendente.
Operações stale de `content-sync` não possuem autoridade para alterar status ou
readiness da UI.

No novo caminho, `LegacyEditorBridge.applyPublicationContent()` monta o payload
diretamente do `content` recebido; os inputs permanecem uma projeção visual e
não precisam ser relidos como fonte editorial. A ponte combina esse snapshot
com a provenance técnica existente para distinguir imagem manual de imagem
extraída e vinculada à URL exata. Feed e Comparar continuam fora do fluxo
funcional.

### Fronteira editorial e primeiro renderer migrado

`resolveRenderer()` é a fronteira oficial entre a seleção editorial e o
renderer técnico. Além de `{ template, page }`, seu resultado inclui cópias das
`dimensions` do formato e dos `themes` aceitos pelo renderer. `theme` permanece
configuração aplicada pelo runtime atual (stylesheet e atributo no mesmo HTML),
e não participa da chave técnica marca/família/variante/formato.

Os renderers reais `agazeta/padrao/foto-acima/story` e
`agazeta/padrao/foto-abaixo/story` são descobertos declarativamente a partir de
seus manifests. Como as composições são estruturalmente diferentes, cada
variante mantém seu próprio HTML, enquanto azul, branco e preto compartilham o
mesmo renderer dentro de cada variante. Ambos os manifests referenciam
`primary`, `headline.black` e `body.italic`; os arquivos correspondentes
continuam sendo definidos somente no Brand Registry. `templatePageService`
pede esses aliases a uma pequena camada de resolução, recebe a logo sanitizada
e gera as regras de fontes consumidas pelo mesmo iframe sem publicar paths
absolutos. Os renderers legados continuam usando `defaultLogo` e seus CSS
atuais, tornando a migração incremental.

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
│   │   ├── frontend-utils.js      # validações e transformações puras
│   │   ├── preview-export.js      # captura e download do PNG
│   │   └── preview-runtime.js     # bindings e escala dentro do iframe
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
resolvidos. Antes de acessar o filesystem, a resolução exige que `template` e
`page` sejam segmentos diretos não vazios, sem `.`, `..`, NUL, `/` ou `\`.
Também rejeita caminhos absolutos e comprova com `path.resolve` e
`path.relative` que o diretório da página permanece em `TEMPLATE_ROOT`.

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

Os parâmetros `template` e `page` da rota são confinados a `TEMPLATE_ROOT` na
fronteira de resolução do filesystem em `manifestLoader`. Assim, a mesma regra
protege a rota e futuros chamadores de `loadManifest`; referências inválidas
são classificadas como template ausente antes de qualquer leitura.

`src/lib/safeHttpClient.js` centraliza os downloads feitos pelo servidor. Antes
da conexão, valida protocolo e credenciais, resolve e fixa o endereço DNS e
rejeita endereços não públicos IPv4 e IPv6. O mesmo processo ocorre em cada
redirecionamento, que é seguido explicitamente pelo cliente. O `lookup`
Promise-based entrega ao Axios somente endereços previamente validados, sem
alterar hostname, `Host`, TLS ou SNI. Cada consumidor fornece timeout, limite de
bytes e quantidade máxima de redirecionamentos; os erros operacionais são
classificados. Cada salto usa Agents HTTP e HTTPS explícitos, sem keep-alive,
para impedir que o proxy ambiental dos Agents globais contorne o endereço
fixado. O timeout cria uma única deadline monotônica para a operação
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

`public/index.html` define o shell, campos editoriais, controles, o `iframe`,
loading e toasts. Não contém catálogo ou modal legado oculto.

`public/js/api.js` expõe `window.Api`:

- `loadManifest` chama a API de template e mantém um cache por
  `<template>/<page>`;
- `extractNewsData` chama a extração, registra erros e retorna `{}` em falha;
- `embedImage` solicita ao backend uma data URL e propaga uma mensagem de erro.

`public/js/frontend-utils.js` expõe `window.FrontendUtils` e concentra
validação de URL HTTP/HTTPS, validação da imagem efetiva, normalização de
valores opcionais, escolha do ícone dos toasts, construção do nome do PNG e
montagem pura do payload da arte. As funções não acessam o DOM e também são
exportadas para testes unitários.

`public/script.js` mantém a infraestrutura técnica reutilizada: cache de notícia,
provenance de imagem, estado do renderer, montagem do `iframe`, runtime de
bindings e exportação. Ele não seleciona brand/family/variant/theme e não
registra listeners de cards ou modal.

`public/js/preview-runtime.js` expõe `window.PreviewRuntime` dentro do iframe.
Sua API permite inicializar o manifest, atualizar bindings, aplicar escala e
tratar resize. A inicialização mantém `window.__updatePreview` como ponto de
entrada usado pela página principal e não registra os listeners novamente
quando chamada mais de uma vez na mesma instância.

`readGenerationFormData` concentra a leitura dos cinco campos do formulário e
dos estados atuais de tema e template em um snapshot normalizado, sem alterar
esses estados.

`validateGenerationInput`, em `public/js/frontend-utils.js`, recebe o snapshot
normalizado da entrada e concentra as regras puras da geração. Seu resultado
estruturado contém `valid`, `code`, `message` e `focusField`; esses códigos são
detalhes internos do frontend, não uma API pública versionada.

`generateArtWithPreviewFlow` mantém a validação em duas fases. A primeira ocorre
antes dos efeitos assíncronos e verifica as pré-condições disponíveis na
entrada. A segunda ocorre depois da extração e verifica categoria e imagem no
payload montado por `buildPreviewData`, a mesma função usada pelo preview.
`applyGenerationValidation` traduz o resultado inválido em toast e foco no
campo indicado. A precedência dos valores manuais sobre os extraídos permanece
a mesma nas duas fases e na montagem do preview.

Depois da primeira validação, a geração captura um contexto imutável com o
snapshot completo do formulário, URL, template, página, versão da sessão do
renderer e identificador monotônico da geração. Manifest e logo são associados a
esse contexto quando o carregamento termina. Dados extraídos complementam o
snapshot, mas os campos não são relidos para montar a arte: alterações feitas
durante a operação pertencem à próxima geração.

Após carregar manifest, extrair dados, incorporar imagem, inicializar preview e
concluir o download, o fluxo confirma que URL, template, página, sessão e
identificador ainda correspondem à geração atual. Uma troca em qualquer desses
valores torna a operação obsoleta. Nesse caso ela termina sem atualizar cache,
campos, preview ou exportação e sem exibir erro ou sucesso. Uma geração mais
nova também invalida as anteriores; somente a mais nova controla a restauração
do loading enquanto estiver em andamento.

Os contratos de imagem dessas fases são distintos. `isValidRemoteImageUrl`
aceita somente HTTP e HTTPS e é usado para a imagem digitada manualmente.
`isValidResolvedImageValue` aceita HTTP/HTTPS ou uma data URL Base64 de PNG,
JPEG, GIF ou WebP, formato que o backend produz depois de validar e incorporar
a imagem. Data URLs não pertencem ao contrato da entrada manual; SVG, MIME
genérico, payload vazio e formatos sem o marcador `;base64,` não pertencem ao
contrato da imagem resolvida.

O campo de imagem pode ser preenchido pelo usuário ou por
`handleFetchNewsAndPreview`. Quando a extração preenche o campo, o frontend
registra a origem `extracted` junto com o valor exato em
`resolvedImageFieldState`. O snapshot da geração só expõe esse conteúdo como
`resolvedImage` enquanto origem e valor ainda correspondem ao campo; caso
contrário, ele é `manualImage`. Um evento `input` invalida imediatamente a
origem automática. Troca da URL editorial ou edição manual da imagem também
limpa esse estado, impedindo que uma associação antiga seja reutilizada.

`public/js/preview-export.js` expõe `window.PreviewExport`. O módulo espera
fontes e imagens, rejeita imagens que terminam o carregamento sem dimensões,
verifica imagens HTTP(S), chama `html-to-image` dentro do `iframe` e inicia o
download por meio de um link temporário. A rejeição de `decode()` permanece
best-effort somente quando a imagem já está completa e possui largura válida;
ela não equivale ao evento real de erro de carregamento.

## Listagem e carregamento de templates

Há duas APIs com responsabilidades distintas:

1. `GET /api/templates` lista o conteúdo válido encontrado no filesystem por
   meio de `listTemplates`. A resposta expõe nome, logo e dimensões somente de
   páginas que possuam manifest com JSON válido e `index.html`. Manifest
   ausente, JSON inválido ou HTML ausente gera um diagnóstico interno com
   template, página e código estável, é registrado no servidor e não impede que
   as demais páginas sejam retornadas. Testes e ferramentas internas podem
   consultar `{ templates, diagnostics }` por `inspectTemplateCatalog`; os
   diagnósticos não fazem parte da API pública.
2. `GET /api/editor/catalog` alimenta exclusivamente o novo editor com a
   hierarquia declarativa de brand/family/variant/format/theme. A seleção é
   resolvida por `POST /api/editor/resolve`; não há array `storyTemplates`, card
   ou modal intermediário. A `LegacyEditorBridge.selectRenderer()` recebe o
   resultado técnico `{ template, page }` e então `ensurePreviewInitialized` ou
   o fluxo de geração chama:

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
assets remotos usam `502 TEMPLATE_REMOTE_ASSET_FAILED`. Segmentos de template
ou página com traversal, separadores codificados já decodificados pelo Express,
NUL ou forma absoluta também recebem o 404 estável, sem caminhos internos na
resposta.

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
Somente resultados com conteúdo em ao menos um dos campos `h1`, `h2`, `chapeu`
ou `bg` atualizam esse cache. `null`, `undefined` e objetos sem esses dados
continuam chegando ao tratamento de erro do chamador, mas não substituem um
cache válido nem impedem uma nova tentativa para a mesma URL.

A busca explícita captura URL, template, página e versão da sessão do renderer,
além de um identificador monotônico próprio. O mesmo verificador de contexto é
passado a `getOrExtractNewsData` e ao carregamento do preview. Se a URL ou o
template mudar, a sessão do renderer for substituída, ou outra busca começar, a
operação anterior termina silenciosamente: não grava o cache, não preenche
campos, não altera a proveniência da imagem, não atualiza o iframe nem exibe
toast. Somente a busca ainda atual pode restaurar o botão; a edição da URL e a
abertura de uma nova sessão restauram diretamente o controle da interface.

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

O campo manual aceita somente uma URL HTTP ou HTTPS; data URLs e outros
protocolos são rejeitados antes dos efeitos assíncronos. O preview usa
diretamente essa URL. Na geração, se a imagem efetiva ainda for HTTP(S), o frontend chama
`POST /api/news/embed-image`; a data URL retornada é aplicada novamente ao
preview como `backgroundOverride` antes da captura. Antes dessa aplicação, o
retorno também precisa satisfazer o contrato de imagem resolvida.

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
3. serializa o manifest para a chamada de inicialização, escapando `<`, U+2028
   e U+2029 para o contexto do script inline sem alterar os valores
   reconstruídos pelo JavaScript;
4. monta um documento HTML completo;
5. define `<base href="/templates/<template>/<page>/">`;
6. inclui o fragmento HTML do template;
7. carrega `/vendor/html-to-image.js`;
8. instala um bootstrap mínimo com fila e uma Promise de readiness;
9. carrega `/js/preview-runtime.js` com tratamento explícito de `load` e
   `error`, valida sua API e o inicializa com o manifest;
10. grava tudo com `frameDoc.open/write/close`.

O `iframe` não usa atributo `sandbox`. Como o documento é escrito pelo pai e
permanece na mesma origem, o frontend acessa diretamente `contentDocument` e
`contentWindow`.

Há duas escalas:

- `resizePreviewFrame` aplica um `transform` ao próprio `iframe`, calculado pelo
  menor limite entre a largura natural do wrapper e a altura disponível no
  contêiner. O wrapper acompanha as dimensões visuais resultantes, enquanto o
  iframe preserva o canvas de 1080 x 1920 usado na exportação;
- `PreviewRuntime.applyScale`, dentro do iframe, escala o elemento `html` de acordo com
  as dimensões do manifest e o viewport interno.

O runtime publica `window.__updatePreview`. Enquanto o módulo está carregando,
o bootstrap enfileira as atualizações e as aplica em ordem após a
inicialização. `PreviewRuntime.update` registra e propaga falhas de binding; por
isso, a Promise `window.__previewRuntimeReady` só resolve depois da carga,
validação, inicialização e aplicação sem erro de todos os itens da fila. Falha
de carga, API inválida, exceção da inicialização ou falha durante a drenagem
rejeita a Promise com uma mensagem estável e retorna ao tratamento de erro da
página principal.

`ensurePreviewInitialized` aguarda essa readiness e somente então publica
`currentManifestData`, `previewInitializedTemplate` e
`previewInitializedPage`. Template e página formam a chave de reutilização; uma
falha não deixa o iframe reutilizável e uma chamada posterior reinicia o
processo. Tanto `updatePreview` quanto a geração montam o payload por
`buildPreviewData` e o entregam a `applyArtworkDataToPreview`. Na geração, o
runtime pronto precede a aplicação síncrona do payload final, que precede
`downloadPreview`; preview e PNG observam o mesmo DOM. Se a aplicação final
falhar, o erro chega ao tratamento da geração e a exportação não é iniciada. O
placeholder é ocultado somente depois da readiness. `updatePreview` também
propaga falhas atuais ao fluxo de busca, impedindo o toast de sucesso; listeners
de edição tratam essa atualização como best-effort, encerram a rejeição com log
e não exibem toast. Cada atualização auxiliar recebe um identificador monotônico
e captura sessão, template e página ao iniciar. Somente a solicitação mais
recente desse contexto pode aplicar o payload ou registrar uma falha; conclusões
substituídas e falhas cujo contexto não é mais atual permanecem silenciosas.

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
runtime não o interpreta. Categoria e imagem efetivas são pré-condições da
segunda fase de `validateGenerationInput`, executada depois da extração.

## Exportação para PNG

`generateArtWithPreviewFlow` executa a primeira fase de validação antes de
mostrar o loading e então:

1. carrega novamente os dados do template, usando o cache de `Api`;
2. confirma que o contexto da geração ainda é atual;
3. obtém ou reutiliza a extração associada à URL capturada e só então atualiza
   seu cache;
4. monta os dados da arte com `buildPreviewData`, usando o snapshot inicial;
5. exige categoria e imagem no payload montado;
6. incorpora pelo backend uma imagem do payload ainda remota;
7. reconstrói o payload pela mesma função, com a imagem exportável, e o aplica
   ao mesmo DOM do preview;
8. chama `PreviewExport.downloadPreview` e confirma novamente o contexto antes
   do toast de sucesso.

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

No preview interativo, `buildPreviewData` lê o formulário e seleciona os dados
extraídos somente quando a URL do cache coincide com a URL atual. Na geração,
ela recebe explicitamente o snapshot inicial e o resultado extraído vinculado
ao contexto. Nos dois casos delega a montagem a `createArtworkData`. Essa
função pura recebe dados do formulário, dados extraídos, manifest, logo
resolvida, tema e override opcional de background. Ela estabelece a precedência
usada ao atualizar o DOM:

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
de URL são passados por `buildPreviewData` a `createArtworkData`. Isso impede
que o cache de uma notícia anterior seja usado após a URL ser editada.

Há uma diferença importante entre origem e conteúdo dos campos: depois de
“Buscar dados”, valores textuais extraídos são copiados para os inputs manuais
vazios. Para a imagem, o frontend preserva separadamente a origem extraída,
associada ao valor exato e à URL da notícia. Uma edição do campo invalida essa
associação e faz o novo conteúdo seguir o contrato manual. Uma nova extração
não sobrescreve inputs que já contenham um valor manual.

## Estado técnico do renderer no frontend

A seleção editorial possui um único owner: `publication`, mantida por
`editor-ui.js`. `currentTemplate`, `currentPage` e `currentTheme` continuam em
`public/script.js` exclusivamente como projeção técnica do renderer resolvido.
`selectRendererState()` só é chamado por `LegacyEditorBridge.selectRenderer()`;
não existe caminho por card, ID hardcoded ou modal.

`editorSessionVersion` substitui o nome histórico `modalSessionVersion` e mantém
a mesma proteção stale para geração, busca e inicialização. A troca de renderer
incrementa essa versão e invalida operações técnicas anteriores sem alterar a
fonte editorial. `previewInitializationVersion` permanece independente e
protege inicializações concorrentes do iframe.

A `LegacyEditorBridge` expõe somente operações consumidas pelo controller novo:
seleção de renderer e tema, importação, reconciliação/aplicação de conteúdo e os
bloqueios de readiness de preview, importação e sincronização. Cache,
provenance, bindings e exportação permanecem temporariamente em `script.js`.
`#customTheme` continua oculto como ponte comprovada para o runtime; nenhum outro
DOM legado é necessário.

`lastNewsUrl`/`lastNewsData` preservam o cache associado à URL exata.
`resolvedImageFieldState` preserva provenance manual ou extraída e a associação
entre URL e data URL/backend-resolved image. `currentManifestData`,
`previewInitializedTemplate` e `previewInitializedPage` registram exclusivamente
o documento técnico carregado no iframe. Em `api.js`, `manifestCache` permanece
privado e indexado por template/página.

A inicialização ativa é:

```text
infraestrutura técnica -> bootstrap do editor -> editorCatalog -> publication
-> resolveRenderer -> LegacyEditorBridge -> iframe real -> preview/export
```
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

- leitura síncrona da configuração e leitura assíncrona de manifests, HTML,
  CSS, logos e diretórios;
- abertura da porta HTTP quando `server.js` é executado como entrypoint;
- requisições HTTP para notícias, imagens e SVGs remotos;
- mutação dos caches em memória;
- logs de configuração, servidor e erros; logs de requisição com falha
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
- As rotas usam serviços importados sem pontos explícitos de injeção. A leitura
  de manifests e a montagem de HTML, CSS e logo ficam, respectivamente, em
  `manifestLoader` e `templatePageService`, que possuem cobertura direta.
- `news.js` combina contrato HTTP e download/conversão de imagem; `embedImage`
  não é exportada.
- O frontend está concentrado em um script global acoplado ao DOM real e a
  objetos `window`.
- O runtime de bindings é um módulo estático, mas seu bootstrap e execução
  continuam dependentes do documento escrito no iframe.
- Preview e exportação dependem de APIs de navegador, fontes, carregamento de
  imagens, CORS, timing e `html-to-image`.
- Operações assíncronas de busca, geração e atualização auxiliar carregam
  identidade de URL, template, página, sessão e/ou contador monotônico. Elas
  descartam conclusões obsoletas, mas não cancelam fisicamente o trabalho já
  iniciado.
- Os caches do frontend e do backend persistem no escopo do módulo/processo e
  não têm API de limpeza ou invalidação. O cache de logos limita-se a 32
  entradas com descarte FIFO; alterações de manifest ou asset durante a
  execução só são observadas depois de reiniciar o processo e recarregar a
  página.
- Os manifests atuais não exercitam todos os tipos aceitos pelo runtime.
- A suíte automatizada cobre rotas HTTP, carregamento de templates, requisições
  externas simuladas, cliente HTTP seguro, precedência, bindings, loading,
  readiness e exportação em ambientes simulados. Ela não executa esses fluxos
  em navegador real nem comprova equivalência visual do PNG.

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
- CSS compartilhado precede CSS da página e os arquivos de cada diretório são
  ordenados deterministicamente por nome.
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
- A cobertura automatizada não demonstra os fluxos completos em navegador real
  nem equivalência visual entre preview e PNG.
