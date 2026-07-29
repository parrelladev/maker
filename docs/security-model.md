# Modelo de segurança atual do Maker

Este documento descreve os limites de confiança, controles e riscos observados
no código atual do Maker. Ele não declara que a aplicação é segura e não define
uma arquitetura futura.

## Como ler as classificações

Cada observação de segurança usa uma destas classificações:

- **Vulnerabilidade confirmada pelo código:** existe um caminho alcançável em
  que uma entrada não confiável chega a uma operação sensível sem o controle
  necessário. A possibilidade pode ainda depender da conectividade do ambiente.
- **Risco dependente do ambiente:** o impacto depende da topologia de rede, do
  proxy, de quem pode editar arquivos locais ou de como a aplicação é publicada.
- **Defesa existente:** controle implementado e visível no código.
- **Defesa ausente:** controle relevante que não está implementado no fluxo.
- **Hipótese a testar:** comportamento plausível cuja exploração ou resultado
  não foi demonstrado por teste automatizado ou teste de integração.

“Defesa existente” não significa proteção completa. Por exemplo, aceitar apenas
HTTP e HTTPS reduz protocolos possíveis, mas não impede acesso a endereços
privados.

## Visão geral e fronteiras de confiança

```text
usuário/navegador
   |
   | URLs, textos, seleção e chamadas HTTP
   v
frontend Maker ───────────────> origens externas no navegador
   |                              fontes, imagens e recursos CSS
   | JSON
   v
backend Express
   |
   +──> página de notícia remota
   +──> imagem remota
   +──> SVG remoto indicado por manifest
   |
   v
filesystem local
templates, manifests, CSS, fontes, logos e configuração
```

O modelo atual trata quatro origens de forma diferente:

1. **Usuário e cliente HTTP:** não confiáveis. Podem chamar as APIs diretamente,
   sem passar pelas validações ou opções visuais do frontend.
2. **Servidores remotos:** não confiáveis. Controlam HTML, redirects, headers,
   imagens, SVGs e tempos de resposta.
3. **Templates, manifests e assets locais:** tratados pelo código como
   confiáveis. Não há validação ou isolamento contra conteúdo local malicioso.
4. **Operador e ambiente de implantação:** controlam `PORT`, `config.js`,
   filesystem, conectividade de saída, proxy e exposição pública.

## Inventário de entradas controladas

### Entradas do usuário na interface

| Entrada | Origem | Destino principal |
| --- | --- | --- |
| Link da notícia | `#newsUrl` | `POST /api/news/extract` |
| Chapéu manual | `#customTag` | binding de texto `tag` |
| Título manual | `#customTitle` | binding de texto `h1` |
| Subtítulo manual | `#customSubtitle` | binding de texto `h2` |
| Imagem manual | `#customImageUrl` | `src` no preview e, na exportação, `POST /api/news/embed-image` |
| Template | card com `data-template` | parâmetros de `GET /api/templates/:template/:page` |
| Tema | `#customTheme` | atributo e URL de stylesheet definidos pelo manifest |

Os cards e temas normais são criados por dados estáticos em
`public/script.js`. Isso é uma restrição de interface, não de API: um cliente
pode enviar requisições próprias e escolher outros valores de rota e de corpo.

Os campos manuais de texto atuais chegam a bindings do tipo `text`, que usam
`textContent`. Essa é uma **defesa existente** contra interpretação desses
valores como HTML nos manifests atuais.

### Entradas HTTP diretas

| Endpoint | Entrada controlável |
| --- | --- |
| `POST /api/news/extract` | `req.body.url` |
| `POST /api/news/embed-image` | `req.body.url` |
| `GET /api/templates/:template/:page` | `req.params.template` e `req.params.page` |
| `GET /templates/*` | caminho do recurso estático |
| `GET /input/*` | caminho do recurso estático |

`express.json({ limit: "2mb" })` impõe limite ao corpo JSON. Essa é uma
**defesa existente** contra corpos JSON arbitrariamente grandes, mas não limita
o tamanho de respostas remotas baixadas posteriormente.

As rotas não registram autenticação ou autorização no código atual. A
possibilidade de qualquer cliente alcançá-las é um **risco dependente do
ambiente**, porque um proxy externo pode impor controles que não aparecem neste
repositório. Dentro da aplicação, essa é uma **defesa ausente**.

### Entradas controladas por servidores remotos

Depois que o backend inicia uma requisição, a origem remota controla:

- redirects e destinos seguintes;
- tempo até responder;
- tamanho e compressão da resposta;
- headers, inclusive `Content-Type`;
- HTML da notícia;
- metadados de título, descrição e imagem;
- conteúdo binário da imagem;
- markup de um SVG remoto configurado em manifest.

O scraper reduz título, subtítulo e chapéu a limites de caracteres depois do
download e do parse. Esses limites protegem o payload de saída desses campos,
mas não limitam o HTML recebido ou o custo do Cheerio.

### Entradas locais e operacionais

São entradas de implantação, não entradas normais do usuário:

- `config.js`, `PORT` e argumentos do processo;
- `templates/*/index/manifest.json`;
- HTML, CSS e fontes em `templates`;
- logos e outros arquivos em `input`;
- bundle versionado em `public/vendor`;
- conteúdo de `public`.

O código pressupõe que quem pode escrever nesses locais é confiável.

## Endpoints que recebem URLs

### `POST /api/news/extract`

Contrato:

```json
{ "url": "https://exemplo.test/noticia" }
```

A rota verifica apenas se `url` possui valor. Ela não verifica tipo, protocolo,
hostname, endereço IP ou porta antes de chamar `newsScraper.fetch`.

`newsScraper.fetch` passa o valor diretamente a `axios.get`, com timeout de
10 segundos e User-Agent de navegador.

- **Vulnerabilidade confirmada pelo código — SSRF:** um cliente pode fornecer
  uma URL HTTP(S) de loopback, link-local, rede privada ou endereço reservado, e
  o servidor tentará acessá-la se houver conectividade.
- **Defesa ausente:** allowlist de protocolos na própria rota.
- **Defesa ausente:** resolução DNS e bloqueio de faixas não públicas.
- **Defesa ausente:** validação do destino após cada redirect.
- **Defesa ausente:** limite explícito para bytes da resposta.
- **Defesa ausente:** validação do tipo de conteúdo como HTML.
- **Defesa existente:** timeout de 10 segundos.
- **Risco dependente do ambiente:** o alcance real do SSRF depende das redes,
  credenciais implícitas, proxies e serviços acessíveis ao processo.

Depois do parse, a URL de imagem extraída pode provocar uma segunda requisição
no mesmo endpoint por meio de `embedImage`.

### `POST /api/news/embed-image`

Contrato:

```json
{ "url": "https://exemplo.test/imagem.jpg" }
```

A implementação aplica a regex `^https?://` diretamente ao valor recebido, de
forma case-insensitive. JavaScript pode coerzir valores que não são strings
antes da aplicação da regex; portanto, não existe validação explícita de tipo.
Determinados valores coercíveis, como um array contendo uma única URL HTTP(S),
podem ser aceitos.

- **Defesa existente:** após a coerção realizada pelo JavaScript, a regex exige
  que a representação do valor comece com um prefixo HTTP ou HTTPS.
- **Defesa ausente:** validação explícita de tipo para exigir uma string. Essa
  ausência não constitui SSRF por si só.
- **Defesa existente:** timeout de 15 segundos.
- **Defesa existente:** `maxContentLength` e `maxBodyLength` de 12 MB.
- **Defesa existente:** máximo de três redirects configurado no Axios.
- **Defesa existente:** exige `Content-Type` iniciado por `image/` antes de
  produzir a data URL.
- **Vulnerabilidade confirmada pelo código — SSRF:** a rota aceita destinos
  HTTP(S) privados, locais e reservados e realiza o download no servidor.
- **Defesa ausente:** validação semântica de URL, hostname, DNS, IP e porta.
- **Defesa ausente:** validação de cada destino da cadeia de redirects.
- **Defesa ausente:** confirmação de que os bytes correspondem ao formato
  declarado no `Content-Type`.
- **Hipótese a testar:** comportamento exato dos limites com respostas
  comprimidas, streams interrompidos e redirects que mudam de protocolo.

### URLs derivadas de manifests

`GET /api/templates/:template/:page` não recebe uma URL no corpo, mas o manifest
carregado pode conter `defaultLogo` remoto. Nesse caso, a rota chama
`resolveLogoAsset`.

Como o manifest vem do filesystem local, esse fluxo depende de alguém com
capacidade de alterar conteúdo implantado. Ainda assim, o destino é externo e
usa a rede do servidor.

## Requisições externas realizadas pelo servidor

| Local | Origem da URL | Timeout | Limite de resposta | Redirects | Tipo |
| --- | --- | ---: | ---: | ---: | --- |
| `newsScraper.fetch` | corpo de `/extract` | 10 s | nenhum explícito | padrão da biblioteca | não validado |
| `routes/news.embedImage` | imagem extraída ou corpo de `/embed-image` | 15 s | 12 MB | 3 | exige `image/*` após download |
| `assetResolver.resolveLogoAsset` | `defaultLogo` do manifest | nenhum explícito | nenhum explícito | padrão da biblioteca | apenas procura `<svg` no texto |

Não há cliente HTTP centralizado, política comum de saída ou validação
compartilhada entre esses três fluxos.

### Redirects

Somente `embedImage` declara `maxRedirects`, com valor três. Nenhum fluxo
inspeciona o endereço resolvido antes da primeira conexão ou depois de um
redirect.

- **Vulnerabilidade confirmada pelo código:** redirects podem levar um download
  inicialmente público a um destino privado, desde que a biblioteca e a rede
  permitam a conexão.
- **Defesa ausente:** callback ou transporte que revalide cada salto.
- **Hipótese a testar:** quantidade exata de redirects aceita nos fluxos que
  deixam o padrão do Axios e o comportamento diante de redirects relativos,
  troca de protocolo e ciclos.

## Conteúdo remoto incorporado

### HTML da notícia

O HTML remoto é carregado no Cheerio. O documento completo não é enviado ao
iframe. O código extrai strings e um atributo de imagem:

- título;
- descrição;
- chapéu;
- URL de imagem.

Nos manifests atuais, título, subtítulo e tag são aplicados com `textContent`.
Isso é uma **defesa existente** contra XSS originado diretamente nesses três
campos.

O HTML inteiro, entretanto, é baixado e parseado antes dos limites textuais:

- **Defesa ausente:** limite de bytes do HTML.
- **Risco confirmado de consumo de recursos:** um cliente pode fazer o servidor
  baixar e analisar respostas grandes repetidamente.
- **Risco dependente do ambiente:** impacto depende de memória, concorrência,
  limites do proxy e disponibilidade da aplicação.

### Imagem extraída

Se o scraper retorna uma URL HTTP(S), o backend baixa seus bytes e produz
`data:<content-type>;base64,...`. Referências relativas são preservadas sem
resolução contra a URL da notícia e não passam pelo segundo download.

A data URL é enviada no JSON, guardada no frontend e atribuída ao `src` indicado
pelo manifest.

- **Defesa existente:** timeout, limite declarado de 12 MB, três redirects e
  checagem de `image/*`.
- **Defesa existente:** uma imagem incorporada deixa de exigir CORS durante a
  captura.
- **Risco de consumo de recursos:** o buffer, a conversão base64 e a resposta
  JSON coexistem em memória; base64 também aumenta o volume representado.
- **Defesa ausente:** limite de concorrência e rate limiting.
- **Hipótese a testar:** pico real de memória para respostas próximas do limite
  sob múltiplas requisições concorrentes.

### Imagem manual

No preview, a URL manual é atribuída diretamente a `src` antes de ser
incorporada. Isso faz o navegador do usuário solicitar a origem remota.

Na exportação, uma imagem efetiva HTTP(S) é enviada a `/api/news/embed-image` e
substituída no mesmo preview pela data URL. `preview-export.js` ainda procura
elementos `img` HTTP(S) remanescentes e executa `fetch` com CORS antes da
captura.

- **Risco dependente do ambiente:** a origem da imagem observa IP, headers e
  timing do navegador no preview e do servidor durante a incorporação.
- **Defesa existente:** a exportação falha se a verificação CORS de uma imagem
  remota remanescente não obtiver resposta bem-sucedida.
- **Defesa ausente:** política de origens permitidas no frontend.

### Recursos externos declarados em HTML e CSS

`public/index.html` carrega Google Fonts e Font Awesome de origens externas.
Templates podem referenciar fontes, imagens ou imports CSS. O `<base>` do iframe
resolve referências do template sob `/templates/<template>/<page>/`, mas URLs
absolutas continuam externas.

`html-to-image` também pode buscar recursos encontrados no DOM e no CSS durante
a captura.

- **Risco dependente do ambiente:** disponibilidade, privacidade e integridade
  desses recursos dependem de HTTPS, CSP, proxy, DNS e das origens externas.
- **Defesa ausente:** não há Content Security Policy configurada pelo Express no
  código atual.
- **Defesa ausente:** não há Subresource Integrity nos links externos do
  documento principal.

## Carregamento de SVG

`resolveLogoAsset` trata SVG local e remoto como texto:

1. identifica SVG remoto pela extensão presente na URL;
2. baixa o texto remoto ou lê o arquivo local;
3. verifica apenas se o texto contém `<svg`;
4. guarda o resultado no `LOGO_CACHE`;
5. envia o markup na resposta da rota de template;
6. o binding `logo` atribui o markup a `el.innerHTML` dentro do iframe.

Para SVG remoto:

- **Defesa ausente:** sanitização de elementos, atributos, URLs e event
  handlers.
- **Defesa ausente:** timeout, limite de bytes e limite explícito de redirects.
- **Defesa ausente:** validação de `Content-Type`.
- **Defesa ausente:** bloqueio de destinos privados.
- **Risco dependente do ambiente:** exige que um manifest local confiado aponte
  para uma origem remota ou que o conteúdo dessa origem seja comprometido.
- **Hipótese a testar — XSS:** verificar em navegadores suportados quais
  elementos e event handlers de um SVG inserido por `innerHTML` permanecem
  ativos e se conseguem executar no contexto de mesma origem do iframe.
- **Hipótese a testar — requisições secundárias:** verificar quais referências
  externas dentro do SVG são carregadas pelo navegador e por `html-to-image`.

Para SVG local, os mesmos riscos de markup ativo existem se o filesystem de
implantação não for confiável. O caminho normal pressupõe que os arquivos em
`input` foram revisados.

Uma logo HTTP(S) não SVG segue outro caminho: `resolveLogoAsset` não baixa seus
bytes no servidor, apenas devolve a URL como `src`. O binding de logo atribui
essa URL ao elemento de imagem ou a `backgroundImage`, e o navegador passa a
ser responsável pela requisição. Esse fluxo expõe o cliente à origem remota e
não recebe os limites de timeout e tamanho de `embedImage`.

O cache de logos não possui expiração ou limite. Como os manifests são locais e
finitos na operação normal, o crescimento tende a acompanhar esses valores;
isso muda se conteúdo local puder ser alterado dinamicamente.

## Uso de `innerHTML`

### Dados estáticos da interface

`public/script.js` usa `innerHTML` para:

- construir cards com dados de `storyTemplates`;
- montar opções de tema com dados estáticos;
- construir toasts;
- limpar containers.

Cards e temas vêm do próprio bundle e são tratados como confiáveis.

`showToast` interpola `message` em HTML. Algumas mensagens concatenam
`error.message`.

- **Defesa ausente:** uso de `textContent` para a parte variável do toast.
- **Hipótese a testar — XSS:** determinar se algum erro alcançável consegue
  transportar markup controlado pelo usuário ou por uma origem remota até
  `showToast`. O código atual frequentemente substitui erros por mensagens
  genéricas, mas o fluxo de incorporação propaga `detail`.

### Runtime de bindings

O runtime suporta:

- `text`: usa `textContent`;
- `html`: usa `innerHTML`;
- `image`: atribui `src`;
- `logo` com SVG: usa `innerHTML`;
- `logo` com imagem: atribui `src` ou `backgroundImage`;
- atributos: usa `setAttribute`;
- variáveis CSS: usa `style.setProperty`;
- classes: usa `classList.add`.

Os manifests atuais usam bindings de texto, imagem e logo; não usam o tipo
`html`. Alguns usam atributos para tema.

- **Defesa existente:** os campos de notícia textuais atuais usam `text`.
- **Defesa ausente:** allowlist de nomes de atributos, propriedades CSS,
  seletores ou tipos de binding.
- **Risco dependente do ambiente:** um manifest local malicioso pode escolher
  `html`, atributos de evento, URLs ou seletores sensíveis.
- **Hipótese a testar:** capacidade exata de execução de script por bindings de
  `html`, atributos e URLs nos navegadores suportados.

## Construção e escrita do iframe

`ensurePreviewInitialized` recebe do backend:

- `manifest`;
- fragmento HTML;
- conteúdos CSS;
- identidade do template e da página;
- logo resolvida.

O frontend:

1. concatena CSS dentro de `<style>`;
2. serializa o manifest com `JSON.stringify`;
3. interpola esse JSON em um script inline;
4. interpola HTML e CSS locais em um documento completo;
5. inclui `html-to-image`;
6. escreve o documento por `frameDoc.open`, `write` e `close`.

O iframe não possui `sandbox` e fica na mesma origem do documento principal.

- **Defesa existente:** na operação normal, HTML, CSS e manifest vêm do
  filesystem local controlado pela implantação.
- **Defesa ausente:** `sandbox` no iframe.
- **Defesa ausente:** CSP específica para o iframe ou documento principal.
- **Defesa ausente:** escaping voltado ao contexto de `<script>` para strings do
  manifest que possam conter `</script>`.
- **Defesa ausente:** sanitização do HTML e CSS do template.
- **Risco dependente do ambiente:** se um atacante puder alterar templates ou
  manifests locais, o código já concede execução e acesso de mesma origem; o
  iframe não é uma fronteira de segurança.
- **Hipótese a testar:** comportamento de strings de manifest contendo
  sequências de fechamento de script e alcance ao `window.parent`.

O uso de `document.write` não recebe diretamente o HTML completo da notícia. A
principal fronteira é a confiança nos arquivos locais e nas logos resolvidas.

## Confiança em manifests e templates locais

O backend valida somente existência e JSON bem formado. Não existe schema para:

- dimensões;
- seletores;
- campos;
- tipos de binding;
- atributos;
- classes;
- variáveis CSS;
- nomes ou URLs de logos.

O template HTML é lido integralmente e devolvido ao cliente. CSS é lido e
concatenado. O manifest controla parte do runtime e pode iniciar a resolução de
logo remota.

Portanto:

- **Premissa atual:** somente operadores confiáveis podem criar ou alterar
  `templates`, `input`, `public` e `config.js`.
- **Risco dependente do ambiente:** montagem de volume, pipeline de deploy,
  painel de upload ou permissões de escrita podem invalidar essa premissa.
- **Defesa ausente:** validação de schema e allowlists.
- **Defesa ausente:** isolamento do template em origem separada ou iframe
  restrito.
- **Hipótese a testar:** parâmetros `:template` e `:page` com segmentos
  codificados, traversal e diferenças de normalização entre Express, URL e
  `path.join`. Não há teste de segurança desse contrato.

Os arquivos estáticos são servidos pelo Express a partir de raízes definidas,
mas o comportamento completo de normalização e symlinks depende da biblioteca,
do filesystem e da implantação.

## Políticas atuais de timeout, tamanho e redirects

| Fluxo | Timeout | Limite de entrada/resposta | Redirects |
| --- | ---: | --- | --- |
| Corpo JSON da API | não aplicável no parser | 2 MB de entrada | não aplicável |
| Download da notícia | 10 s | nenhum limite explícito de resposta | padrão do Axios |
| Download de imagem | 15 s | 12 MB declarados | máximo 3 |
| Download de SVG remoto | nenhum explícito | nenhum explícito | padrão do Axios |
| Fetch de imagem no navegador | nenhum explícito | nenhum explícito | padrão do navegador |
| Fontes e CSS externos | nenhum explícito no código da aplicação | nenhum explícito | navegador |

Não há timeout global do Express, rate limiting, limite explícito de
concorrência ou cancelamento das requisições externas quando o cliente
desconecta.

## Mensagens de erro e vazamento de informações

### Respostas do backend

| Local | Status | Exposição |
| --- | ---: | --- |
| `/api/news/extract` sem URL | 400 | mensagem fixa |
| `/api/news/extract` em erro | 500 | mensagem fixa + `error.message` em `detail` |
| `/api/news/embed-image` inválida | 400 | mensagem fixa |
| `/api/news/embed-image` em erro | 422 | mensagem fixa + `error.message` em `detail` |
| `/api/templates/:template/:page` em erro | 404 | mensagem fixa + `error.message` em `detail` |
| middleware global | 500 | mensagem fixa + `err.message` em `detail` |

Mensagens de filesystem podem conter caminhos absolutos. Mensagens do Axios
podem revelar informações sobre resolução, conexão, protocolo ou destino.

- **Vulnerabilidade confirmada pelo código — exposição de detalhes:** valores
  de `error.message` são enviados ao cliente em múltiplas respostas.
- **Risco dependente do ambiente:** o conteúdo exato depende do erro, paths,
  versões das bibliotecas e configuração de rede.
- **Defesa existente:** cada resposta também possui uma mensagem pública fixa.
- **Defesa ausente:** tradução para códigos públicos sem detalhes internos.

### Logs

O servidor registra:

- erro global completo;
- falha ao importar `config.js`;
- endereço e porta de escuta;
- chapéu extraído.

O frontend registra erros de API, preview, bindings e geração no console.

- **Risco dependente do ambiente:** logs podem ser coletados por plataforma,
  compartilhados com operadores ou persistidos.
- **Defesa ausente:** política explícita de redaction e classificação de dados.

## Riscos consolidados

### SSRF

- **Confirmado pelo código:** `/extract` e `/embed-image` permitem requisições
  do servidor a destinos HTTP(S) escolhidos direta ou indiretamente pelo
  usuário, sem bloqueio de redes não públicas.
- **Confirmado pelo código:** não há validação por salto de redirect.
- **Dependente do ambiente:** serviços internos alcançáveis, metadados de nuvem,
  proxies, DNS e regras de firewall determinam o impacto.
- **Defesas existentes:** timeouts; limite/tipo/redirects apenas no fluxo de
  imagem.

### XSS e execução de conteúdo

- **Defesa existente:** texto de notícia e campos manuais atuais usam
  `textContent`.
- **Defesas ausentes:** sanitização de SVG, sanitização de templates, sandbox,
  CSP e allowlists de bindings.
- **Dependente do ambiente:** templates/manifests/assets locais precisam ser
  comprometidos ou uma logo remota configurada precisa fornecer conteúdo
  ativo.
- **Hipóteses a testar:** execução por SVG inserido com `innerHTML`, binding
  `html`, atributos, toast e fechamento de script no manifest.

### Consumo excessivo de recursos

- **Confirmado pelo código:** notícia e SVG remoto não têm limite explícito de
  resposta; não há rate limiting nem limite de concorrência.
- **Defesas existentes:** corpo JSON de 2 MB; timeouts de notícia e imagem;
  imagem limitada a 12 MB.
- **Dependente do ambiente:** proxy, quantidade de processos, memória, CPU e
  conectividade influenciam disponibilidade.
- **Hipóteses a testar:** memória sob concorrência, compressão, parse de HTML
  grande, cache de SVG e custo do base64.

### Vazamento de informações

- **Confirmado pelo código:** `error.message` é exposto por rotas e middleware.
- **Dependente do ambiente:** conteúdo revelado varia conforme filesystem,
  rede, Axios e operação.
- **Defesa existente:** mensagens públicas fixas acompanham o detalhe.
- **Defesa ausente:** remoção ou correlação interna dos detalhes sensíveis.

## Cobertura e lacunas de verificação

A suíte atual cobre apenas a extração de chapéu em três fragmentos HTML. Ela não
cobre:

- validação de URL ou protocolo;
- bloqueio de IPs privados e reservados;
- resolução DNS e redirects;
- timeouts e limites;
- tipos de conteúdo;
- erros e detalhes expostos;
- SVG local ou remoto;
- bindings e `innerHTML`;
- construção do iframe;
- parâmetros de template e página;
- concorrência e consumo de memória;
- comportamento de browser na exportação.

Nenhuma garantia de segurança dos fluxos acima é demonstrada pelos testes
atuais.

## Itens deliberadamente não concluídos neste documento

Este modelo registra o estado atual. Ele não:

- define uma política futura completa;
- escolhe bibliotecas de sanitização;
- modifica mensagens ou contratos HTTP;
- implementa bloqueio de rede;
- altera o iframe;
- estabelece limites operacionais ideais;
- comprova hipóteses que exigem testes de integração ou navegador.
