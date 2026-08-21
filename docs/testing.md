# Baseline atual de testes

Este documento registra a infraestrutura e o resultado dos testes existentes no
Maker em 29 de julho de 2026. Ele descreve a baseline observada; não implica
cobertura dos fluxos que não são exercitados pela suíte.

## Ambiente observado

```text
Sistema operacional: Windows
Node.js: 24.18.0
npm: 11.16.0
Test runner: Jest 29.7.0
```

O README exige Node.js 18 ou superior. A baseline foi executada somente na
versão acima; não há matriz automatizada que demonstre o comportamento em todas
as versões suportadas.

No PowerShell deste ambiente, os comandos foram executados com `npm.cmd`. Ele é
o executável equivalente ao `npm` usado na documentação multiplataforma e evita
depender da política local de execução de `npm.ps1`.

## Instalação das dependências

Os arquivos de dependências são:

- `package.json`, com dependências e scripts declarados;
- `package-lock.json`, com as resoluções usadas pelo npm.

Comandos previstos pelo projeto:

```bash
npm install
```

Para uma instalação limpa e reproduzível a partir do lockfile, o npm também
oferece:

```bash
npm ci
```

Nesta verificação não foi necessária uma nova instalação: as dependências
declaradas estavam disponíveis e `npm.cmd test` pôde ser executado.

`npm.cmd ls --depth=0` encontrou as dependências diretas necessárias, mas também
reportou diversos pacotes `extraneous` no `node_modules` local. Esses pacotes
não fazem parte do contrato declarado em `package.json`; a condição é uma
limitação deste workspace e não foi corrigida, porque limpar ou reinstalar
dependências ampliaria o escopo da tarefa.

## Comandos disponíveis

### Scripts do `package.json`

| Comando | Implementação | Finalidade | Validação finita |
| --- | --- | --- | --- |
| `npm test` | `jest --runInBand` | Executa a suíte Jest serialmente | Sim |
| `npm start` | `node src/server.js` | Inicia o servidor | Não |
| `npm run dev` | `nodemon src/server.js` | Inicia o servidor com recarga | Não |
| `npm run deploy` | `node deploy.js` | Cria configuração de forma interativa | Não |

`npm start` e `npm run dev` permanecem em execução e não contêm health check ou
encerramento automático. `npm run deploy` pode escrever `config.js` e requer
interação. Por esses motivos, eles não foram usados como comandos de validação
desta baseline.

### Outros comandos de verificação

```bash
git diff --check
```

Esse comando verifica erros de whitespace no diff, mas não é um script npm e
não valida comportamento da aplicação.

Não há scripts ou arquivos de configuração para:

- lint;
- formatação;
- typecheck;
- build;
- cobertura;
- testes end-to-end;
- testes de navegador;
- testes de API separados.

## Configuração atual do Jest

O projeto usa a descoberta padrão do Jest; não existe `jest.config.*`. O script
inclui `--runInBand`, portanto os arquivos de teste são executados serialmente
no mesmo processo de worker.

Essa configuração contribui para a repetibilidade da suíte atual, que:

- usa apenas rede local em portas efêmeras nos testes HTTP;
- não depende de relógio;
- não grava no filesystem;
- inicia e encerra servidores HTTP locais controlados pelos testes;
- não abre navegador;
- usa fixtures mínimas versionadas no próprio repositório.

Não há configuração de limite mínimo de cobertura, snapshots ou setup global.

## Testes existentes

Existem quinze arquivos:

```text
public/script.test.js
public/js/frontend-utils.test.js
public/js/preview-export.test.js
src/server.test.js
src/routes/templates.test.js
src/routes/news.external.test.js
src/lib/assetResolver.external.test.js
src/lib/assetResolver.local.test.js
src/lib/imageValidator.test.js
src/lib/manifestLoader.test.js
src/lib/remoteRequestPolicy.test.js
src/lib/safeHttpClient.test.js
src/lib/svgSanitizer.test.js
src/services/newsScraper.test.js
src/services/templatePageService.test.js
```

A suíte de `server.test.js` verifica:

1. importar a aplicação sem chamar `app.listen`;
2. usar o app em um servidor HTTP local com porta efêmera;
3. `GET /` retornando a interface HTML;
4. manter registradas `GET /api/templates` e `POST /api/news/extract`;
5. URL obrigatória em `POST /api/news/extract`;
6. URL ausente e protocolo inválido em `POST /api/news/embed-image`;
7. JSON malformado convertido em resposta pública 400 sem detalhe do parser;
8. erro após início da resposta delegado ao próximo middleware, sem segundo JSON;
9. corpo JSON acima de 2 MB convertido em 413;
10. erro global inesperado convertido em 500 sem mensagem interna;
11. iniciar o servidor ao executar `src/server.js` como entrypoint.

`axios` e `newsScraper` são mockados em `server.test.js`. Os testes HTTP
adicionados exercitam somente o servidor local e o filesystem do repositório,
sem realizar chamadas externas reais.

A suíte de `src/routes/templates.test.js` usa
`test/fixtures/template-workspace` como diretório de trabalho temporário. Os
módulos são carregados depois da troca de diretório, de modo que os
`path.resolve('templates')` e `path.resolve('input')` atuais apontem para as
fixtures. O diretório original é restaurado após cada teste. Esse workspace
mínimo contém somente os arquivos necessários para manifest válido, manifest
ausente, JSON inválido, `index.html` ausente, ausência de CSS, CSS compartilhado,
CSS da página, logo SVG local e logo ausente.

Essa suíte verifica:

1. carregamento de template válido;
2. template inexistente;
3. página inexistente;
4. manifest ausente;
5. manifest inválido;
6. `index.html` ausente;
7. diretório sem CSS;
8. CSS compartilhado do template e CSS específico da página;
9. logo local e logo ausente.

Os caminhos negativos confirmam respostas 404 estáveis sem paths para recursos
ausentes e resposta 500 sem detalhe do parser para manifest JSON inválido.
Na listagem, ela também confirma que manifest ausente, JSON inválido e HTML
ausente são omitidos sem derrubar a resposta, geram logs de diagnóstico e
permanecem consultáveis internamente por `inspectTemplateCatalog`.

A suíte de `src/routes/news.external.test.js` caracteriza a incorporação de
imagens com o cliente compartilhado mockado: URL pública, timeout, rejeição por
tamanho, MIME inesperado, corpo vazio, assinatura incompatível, erro inesperado
sem exposição do detalhe, redirect público e bloqueio de destinos não públicos,
inclusive após redirect. Ela também confirma a data URL, categorias inválidas de
URL da notícia convertidas em 400 e a mensagem estável quando a incorporação
ocorre dentro de `/extract`.

A suíte de `src/lib/assetResolver.external.test.js` caracteriza SVG remoto com
o cliente compartilhado mockado. Ela registra timeout, limite de resposta e
redirects configurados, exigência de `image/svg+xml` e bloqueio de destinos não
públicos. Também verifica remoção de scripts, `foreignObject`, handlers e URLs
perigosas, rejeição de XML malformado, ausência de cache negativo para timeout
e outro erro remoto classificado e nova tentativa depois de falha temporária.

A suíte de `src/lib/assetResolver.local.test.js` confirma que SVG local também
é sanitizado e que arquivos acima de 1 MB são rejeitados antes da leitura. Um
cache injetado demonstra o limite de capacidade, descarte FIFO, ausência de
promoção em hits, reutilização das entradas recentes, ausência de cache negativo
para valores ausentes ou inválidos, logo inexistente e SVG inválido, além do
isolamento de `altText` por chamada.

A suíte de `src/lib/imageValidator.test.js` cobre assinaturas reconhecidas de
PNG, JPEG, GIF e WebP, parâmetros no MIME, tipos ausentes, genéricos ou
incompatíveis, corpo vazio, corpo não binário, assinatura divergente, limite
defensivo e erros estáveis. As fixtures exercitam somente a identificação
básica por assinatura e não representam necessariamente arquivos completos ou
decodificáveis.

A suíte de `src/lib/remoteRequestPolicy.test.js` fixa os valores concretos dos
perfis de HTML, imagem e SVG, incluindo timeout, limite de bytes, redirects,
`User-Agent`s existentes e a imutabilidade das estruturas. Os testes dos três
consumidores confirmam que esses mesmos valores chegam ao cliente compartilhado.

A suíte de `src/lib/safeHttpClient.test.js` verifica protocolos, credenciais,
resolução DNS, fixação do endereço, classificação de IPv4 e IPv6, respostas DNS
mistas, redirects para destinos privados, limites configurados, timeout e erros
classificados. Ela também reproduz o contrato Promise-based transformado por
`util.callbackify` no Axios 1.12 e usa um servidor local para atravessar o
adaptador Node, lookup e socket reais, confirmando o IP e o cabeçalho `Host`.
Testes com relógio injetado verificam a deadline total, DNS pendente, DNS lento,
saldo repassado a cada redirect, conclusão dentro do orçamento e remoção de
timers em sucesso e erro. A suíte também inicia processos-filhos que já nascem
com `NODE_USE_ENV_PROXY=1`, `HTTP_PROXY` e `HTTPS_PROXY`; os destinos HTTP e
HTTPS e o proxy local contabilizam separadamente conexões TCP e requisições.
Nos dois protocolos, os testes confirmam conexão no IP fixado, `Host` original
e zero conexões e requisições no proxy. O cenário HTTPS confia somente no
certificado de fixture por `NODE_EXTRA_CA_CERTS`, observa o SNI original no
servidor e também confirma que o mesmo certificado é rejeitado sem essa
confiança explícita. Outro teste faz duas validações sucessivas do mesmo
hostname para IPs locais diferentes e comprova que a segunda requisição não
reutiliza o socket da primeira. A chave privada correspondente ao certificado
é uma fixture sem uso fora da suíte.

A suíte de `src/lib/svgSanitizer.test.js` cobre parsing XML estrito, raiz SVG,
limite de bytes, scripts, handlers, `foreignObject`, CSS não suportado, URLs
externas, valores CSS ofuscados, referências locais canônicas, `DOCTYPE` e XML
malformado. Para os quatro logos locais, confirma estrutura, ausência de markup
ativo, idempotência e propriedades de apresentação essenciais; nos três logos
baseados em `.cls-1`, verifica a conversão para `fill="#fff"` sem conservar
`style`. Esses testes não afirmam equivalência visual completa em navegador.

A suíte de `src/services/newsScraper.test.js` importa `extractChapeu`, cria
fragmentos HTML em memória com Cheerio e verifica três comportamentos:

1. extrai o chapéu da seção imediatamente anterior à seção do título no layout
   atual da A Gazeta;
2. preserva a extração pelo seletor legado
   `label.text-tw-theme-box-kicker-default[id^="kicker-"]`;
3. retorna `null` quando há apenas conteúdo comum antes do título.

A mesma suíte caracteriza `newsScraper.fetch` com respostas do cliente
compartilhado simuladas: URL pública, timeout, resposta acima de 5 MB, MIME
HTML válido com parâmetros, rejeição de MIME ausente ou inesperado, redirects e
bloqueio de destinos não públicos.

A suíte de `src/services/templatePageService.test.js` injeta filesystem, loader,
resolvedor de logo e logger. Ela confirma o modelo completo, ordenação por nome
dentro de cada diretório, CSS compartilhado antes do CSS específico da página,
logos SVG e de imagem local ou remota,
ausência de CSS e logo, fallback com warning e propagação de falha do manifest
para a rota.

A suíte de `public/script.test.js` executa `public/script.js` em um contexto
controlado com elementos DOM simulados. Ela caracteriza o snapshot normalizado
do formulário e o estado global de template, tema, notícia, manifest e preview,
incluindo abertura, fechamento e troca de template. O cache de notícias tem
cobertura para reutilização na mesma URL e substituição por URL diferente. A
chamada direta sem contexto ainda caracteriza o contrato de associação do
resultado à URL solicitada; os fluxos de busca explícita e geração passam um
verificador e impedem que respostas obsoletas atualizem o cache.

A mesma suíte cobre os caminhos de validação da geração na orquestração,
incluindo mensagens, foco e ausência de efeitos assíncronos nas falhas iniciais,
além da restauração do loading e do botão nas falhas pós-extração cobertas. Uma
geração válida com conflito entre valores manuais e extraídos confirma a
precedência da categoria e da imagem manuais, a aplicação da data URL
incorporada ao preview e o envio desse preview ao exportador simulado. Outro
teste compara o payload completo aplicado imediatamente antes da captura com o
resultado de `buildPreviewData`, incluindo textos, categoria, imagem, tema e
logo, e confirma a ordem entre atualização do DOM e download.

Promises controladas cobrem mudança de URL durante extração, troca de template,
fechamento e reabertura do modal e duas gerações concorrentes concluídas fora
de ordem. Os testes confirmam que somente o contexto mais novo pode alterar
cache, categoria, preview e exportação. Outro caso altera campos durante a
extração e demonstra que a geração usa o snapshot inicial, deixando as edições
posteriores para a operação seguinte.

No fluxo independente “Buscar dados da matéria”, Promises controladas cobrem A
lenta/B rápida, A concluída antes de B, rejeição tardia de A, propriedade do
loading do botão, fechamento e reabertura do modal, edição da URL durante a
requisição, preservação da proveniência da imagem de B, ausência de uma segunda
atualização do preview por A e retry após falha atual. Os casos confirmam que
respostas obsoletas não alteram campos, cache, proveniência, iframe, toasts ou o
botão pertencente à busca mais nova, sem usar temporizadores. Falhas atuais ao
aplicar o preview impedem o toast de sucesso e restauram o botão; falhas que se
tornam obsoletas durante a aplicação continuam silenciosas. Atualizações
best-effort disparadas pelos campos encerram rejeições explicitamente sem criar
toast. O teste de troca de sessão mantém silenciosa uma rejeição auxiliar antiga,
enquanto falha auxiliar atual ainda produz um único log. Inicializações
concorrentes na mesma sessão cobrem rejeição e resolução fora de ordem, e um
caso com três solicitações confirma que somente a versão mais recente pode ser
considerada atual.

O cache também é exercitado com `null`, `undefined`, objeto vazio e resultados
parciais contendo isoladamente título, subtítulo, chapéu ou imagem. Os testes
confirmam retry real na mesma URL depois de `{}`, cache após o retry válido,
reutilização na terceira busca, preservação de cache válido anterior e da
proveniência da imagem, além do descarte de resposta vazia obsoleta.

Falhas injetadas em carregamento de manifest, incorporação da imagem,
inicialização do preview e download confirmam ausência de sucesso, bloqueio das
etapas posteriores e restauração do loading e do botão. Promises controladas
também confirmam que rejeições antigas de extração, incorporação e download não
produzem erro depois de troca de sessão ou início de uma geração mais recente,
sem remover o loading pertencente à operação atual.

Testes diretos de `buildPreviewData` caracterizam sua integração com formulário
e cache, enquanto testes unitários de `createArtworkData` exercitam a montagem
pura do payload. Em conjunto, eles caracterizam a matriz completa de
precedência usada na arte:

| Dado | Ordem caracterizada |
| --- | --- |
| Título e subtítulo | manual, extraído da URL correspondente, string vazia |
| Categoria | manual, chapéu extraído da URL correspondente, string vazia |
| Imagem no preview | manual, extraída da URL correspondente, string vazia |
| Imagem na exportação | override incorporado, manual, extraída, string vazia |
| Tema | tema atual e stylesheet derivado, ou valores nulos |
| Logo | logo resolvida válida, fallback local ou remoto derivado do manifest |

A mesma matriz confirma que dados associados a outra URL são ignorados, que a
logo resolvida preserva os formatos `inline-svg` e `image`, e que a ausência de
todos os valores conserva inclusive o fallback legado `logo-a-gazeta`.

A suíte de `public/js/frontend-utils.test.js` cobre as transformações puras do
frontend, incluindo normalização, URL HTTP/HTTPS, nome do arquivo e
`validateGenerationInput`. Para a validação da geração, confirma resultados
estruturados com validade, código, mensagem e campo de foco para todas as
pré-condições atuais, nas fases inicial e posterior à extração. Os testes
separam a imagem manual, limitada a HTTP/HTTPS, da imagem resolvida, que também
aceita data URL Base64 de PNG, JPEG, GIF e WebP. Casos de SVG, HTML, MIME
ausente ou genérico, cabeçalho inválido, payload vazio, ausência de Base64 e
protocolos não permitidos são rejeitados. O fluxo integrado cobre uma data URL
JPEG extraída chegando ao preview e à exportação, além da rejeição da mesma
forma quando digitada no campo manual.

`public/script.test.js` também cobre o fluxo “Buscar dados → Criar”, a
reutilização da imagem extraída pelo cache, a invalidação da origem automática
após um evento `input`, a limpeza dessa origem entre modal e template e a
incorporação de uma imagem manual HTTP cujo backend retorna uma data URL JPEG
validada. Nesses fluxos, preview e exportação recebem a mesma imagem e loading e
botão são restaurados.

`public/js/preview-export.test.js` cobre imagem já carregada, URL HTTP(S), espera
por `load`, rejeição por `error`, imagem completa sem dimensões e rejeição
best-effort de `decode()` para uma imagem já válida. Os casos de falha confirmam
que a captura por `html-to-image` não começa.

A suíte também executa o módulo estático `public/js/preview-runtime.js` pelo
mesmo bootstrap escrito no iframe. Os testes caracterizam sua API explícita,
readiness atrasada, drenagem ordenada da fila, falha de carregamento, falha de
inicialização, rejeição e retry após falha de binding enfileirado, reutilização
sem reinjeção ou listeners duplicados, escala e resize. A geração confirma a
ordem entre runtime pronto, payload aplicado e início da exportação, bloqueia o
download quando o payload final falha e descarta silenciosamente falhas de
update de gerações obsoletas. A serialização do manifest cobre fechamento de
script, reconstrução dos valores originais, `<script>`, aspas, barras
invertidas, U+2028 e U+2029. Os demais casos caracterizam texto,
HTML, imagem, as três formas de logo, variáveis CSS, classes, atributos, campos
aninhados, valores fixos, valores e alvos ausentes, múltiplos alvos, arrays
opcionais ausentes e atualizações repetidas.

## Módulos e comportamentos cobertos

### Cobertura direta demonstrada

| Módulo | Símbolo | Comportamento demonstrado |
| --- | --- | --- |
| `src/server.js` | `app`, middleware global e guard do entrypoint | importação sem listener, uso HTTP, interface, erros públicos, delegação após `headersSent` e inicialização direta |
| `src/routes/templates.js` | rotas de listagem e carregamento | manifest válido, ausente e inválido; HTML e CSS; logo local e ausente; caminhos inexistentes; traversal com `%2F`, `%5C` e `%2E%2E`; arquivo obrigatório ilegível; falha de asset remoto; erro inesperado; e erros públicos sem detalhes internos |
| `src/lib/manifestLoader.js` | `inspectTemplateCatalog`, `listTemplates` e `loadManifest` | descoberta, diagnósticos internos, filtragem, parsing, validação dos arquivos mínimos e confinamento de template/página a segmentos diretos dentro de `TEMPLATE_ROOT` |
| `src/lib/assetResolver.js` | `createLogoAssetResolver` e `resolveLogoAsset` | SVG local, imagem local e remota, ordem de extensões, capacidade máxima, descarte FIFO, ausência de cache negativo, retry após falhas e cache sem compartilhamento de texto alternativo |
| `src/lib/imageValidator.js` | `validateImageResponse` | allowlist de MIME, corpo binário, tamanho, vazio e assinaturas básicas |
| `src/lib/remoteRequestPolicy.js` | políticas de HTML, imagem e SVG | valores concretos, `User-Agent`s e imutabilidade |
| `src/lib/safeHttpClient.js` | `get`, lookup, validação e classificação | protocolos, credenciais, DNS, IPv4/IPv6, redirects, limites, Agents HTTP/HTTPS por salto, bloqueio de proxy ambiental, contrato Axios e conexão local real |
| `src/lib/svgSanitizer.js` | `sanitizeSvg` | XML estrito, gramáticas de valores, CSS local simples, referências locais, idempotência, limite e SVGs maliciosos representativos |
| `src/services/templatePageService.js` | `loadTemplatePage` | manifest, HTML, CSS compartilhado e da página, logo, fallback e modelo de resposta |
| `src/routes/news.js` | validações de `/extract` e `/embed-image`; `embedImage` pela rota | validações existentes, incorporação, limites configurados, MIME, erros classificados, falha inesperada sem detalhe e bloqueios |
| `src/services/newsScraper.js` | `extractChapeu` e `fetch` | extração, configuração do cliente, respostas e bloqueios |
| `public/script.js` | estado da tela, cache e fluxo de geração | snapshot normalizado e imutável na geração, transições do estado global, descarte por URL, template, sessão e geração, concorrência fora de ordem, falhas assíncronas, validações da orquestração, matriz de precedência, payload canônico no preview/exportação e restauração do loading e botão |
| `public/js/preview-runtime.js` | `PreviewRuntime`, `__previewRuntimeReady` e `__updatePreview` | readiness, carga e inicialização, falhas, retry, fila, API explícita, bindings, escala, resize e listeners idempotentes |
| `public/js/frontend-utils.js` | `createArtworkData`, `validateGenerationInput` e transformações auxiliares | payload completo da arte, precedência e fallbacks sem DOM ou globals; validação pura estruturada, URL remota HTTP/HTTPS, allowlist de data URL resolvida, normalização, ícones de toast e nome do PNG |

O arquivo `newsScraper.js` é carregado durante a suíte, mas isso não significa
que todas as suas funções estejam cobertas. Não foi gerado relatório percentual
de cobertura.

### Comportamentos do mesmo módulo sem cobertura

- `cleanText`, que não é exportada;
- normalização de whitespace;
- limites de 120, 220 e 80 caracteres;
- precedência de `og:title`, `title` e `h1`;
- precedência de descrições;
- precedência de imagens;
- erros HTTP e de parsing não relacionados a timeout;
- documentos vazios ou malformados;
- URLs de imagem relativas.

## Comportamentos importantes sem cobertura

### Backend

- resolução de `PORT` e `config.js`;
- ordem completa dos middlewares e caminhos negativos de arquivos estáticos;
- redirects reais, respostas comprimidas e streams interrompidos;
- invalidação do cache de logos após mudança de arquivo;
- concorrência de resoluções iguais, TTL, cache distribuído e comportamento
  após reinicialização do processo;

### Frontend

- navegador real;
- exportação PNG real;
- equivalência visual completa entre preview e PNG;
- catálogo e seleção de templates por interação real;
- seleção e troca de tema em navegador;
- cliente das APIs;
- construção do documento do iframe em navegador real;
- escala visual do preview em navegador real;
- confiança em manifest e template;
- espera real de fontes e imagens pelo navegador;
- bloqueio de imagens não exportáveis em navegador real;
- captura real com `html-to-image`;
- criação e revogação da URL de download.

### Segurança e uso de recursos

- completude das faixas especiais conforme mudanças nos registros de endereços;
- integração real de redirects para destinos não públicos;
- imposição do limite durante recebimento pelo adaptador real;
- respostas comprimidas;
- timeouts;
- decodificação completa, integridade estrutural, arquivos truncados e
  políglotas;
- redaction e retenção dos logs internos;
- interpretação do SVG sanitizado por `innerHTML` em navegador real;
- isolamento do iframe;
- concorrência, memória e CPU.

## Limitações do ambiente de teste

- A baseline foi executada em uma única combinação de Windows, Node e npm.
- Não existe CI ou matriz de versões observável nos arquivos do repositório.
- Não há `jsdom`, browser real ou ferramenta end-to-end configurada.
- Não há `supertest`; o harness atual usa `http.createServer`, `fetch` e um
  processo filho para exercitar o Express e o entrypoint.
- A suíte de templates troca temporariamente o `cwd` do processo e depende da
  execução serial configurada por `--runInBand`; cada teste restaura o diretório.
- O cliente compartilhado é mockado nas suítes consumidoras. Sua suíte usa DNS
  injetado e, no teste de integração, Axios e socket reais contra um servidor
  exclusivamente local. `newsScraper` é mockado nos testes HTTP que não
  exercitam extração. Não há chamadas reais à internet.
- Redirects e resolução privada permanecem simulados. A conexão local exercita
  o contrato real de lookup e socket, mas não redirects nem DNS do sistema.
- O filesystem e as dependências do browser não possuem mocks ou pontos de
  injeção configurados.
- O frontend depende de globais do DOM, iframe, CORS, fontes, imagens e
  `html-to-image`.
- A suíte não mede cobertura; portanto, “arquivo carregado” não pode ser
  interpretado como “arquivo coberto”.
- Os pacotes extraneous do `node_modules` tornam o workspace diferente de uma
  instalação estritamente derivada do lockfile.
- Os testes atuais não usam rede, de modo que a passagem da suíte não valida
  disponibilidade ou comportamento de serviços externos.

## Cobertura de exportação por formato

Os testes de frontend cobrem exportabilidade independente de Feed e Story,
seleção estrutural stale, autoridade técnica de frame/manifest e inicialização,
guarda programática dos dois downloads, filenames, mutex comum e revalidação
antes do efeito irreversível do download.

## Cobertura de status global do preview

Os testes do controller exercitam a regra single e Compare, `syncPending` em
cada formato, conclusão parcial de sincronização paralela, callback stale,
loading, erro, reconciliação no `finally` da exportação, invalidação estrutural
por marca/família e o loading do Story default após **Nova arte**.
Também verificam que conteúdo compartilhado sincroniza os dois formatos, que
tema, ajuste e reset sincronizam somente o formato ativo e que status global e
exportabilidade individual permanecem decisões distintas.

## Resultado atual

Comando:

```powershell
npm.cmd test
```

Resultado observado: consulte a execução mais recente de `npm.cmd test`; a
documentação não fixa a contagem porque ela muda a cada teste adicionado. Uma
requisição controlada usa a pilha Axios/lookup/socket local; nenhuma chamada à
internet é realizada.

O guard do entrypoint permite importar a aplicação sem abrir a porta configurada.
Os testes HTTP usam portas efêmeras e encerram seus servidores e processos.
