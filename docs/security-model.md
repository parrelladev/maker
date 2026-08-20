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

“Defesa existente” não significa proteção completa. Os downloads do servidor,
por exemplo, combinam restrição de protocolo com resolução DNS e classificação
de endereços; a efetividade do transporte real ainda depende da integração com
o adaptador HTTP e o sistema operacional.

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
**defesa existente** contra corpos JSON arbitrariamente grandes. Os downloads
remotos possuem limites separados por fluxo.

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
download e do parse. Esses limites protegem o payload de saída desses campos;
o cliente HTTP limita o HTML recebido, mas não o custo do parse dentro desse
limite.

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

A rota verifica apenas se `url` possui valor antes de chamar
`newsScraper.fetch`. O cliente HTTP compartilhado então exige uma string, aceita
somente HTTP/HTTPS, rejeita credenciais, resolve o hostname e bloqueia qualquer
resposta DNS não pública antes da conexão.

- **Defesa existente:** bloqueio de loopback, link-local, redes privadas,
  multicast, endereços reservados e não roteáveis em IPv4 e IPv6.
- **Defesa existente:** nova resolução, classificação e fixação do endereço em
  cada hostname alcançado por redirect, com máximo de três redirects.
- **Defesa existente:** deadline total de 10 segundos, incluindo DNS, conexão,
  recebimento e redirects, além de limite de 5 MB aplicado pelo adaptador
  durante o recebimento, independentemente de `Content-Length`.
- **Defesa existente:** aceita somente `text/html` e
  `application/xhtml+xml`, ignorando parâmetros como `charset`; ausência ou
  outro tipo gera erro classificado.
- **Defesa existente:** teste local atravessa Axios, lookup e socket e confirma
  o endereço fixado e o cabeçalho `Host`.
- **Hipótese a testar:** redirects e respostas comprimidas com o adaptador real.

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
passam pela regex, mas o cliente compartilhado os rejeita por não serem string.

- **Defesa existente:** após a coerção realizada pelo JavaScript, a regex exige
  que a representação do valor comece com um prefixo HTTP ou HTTPS.
- **Defesa ausente:** validação explícita de tipo para exigir uma string. Essa
  ausência na rota não constitui SSRF por si só; o cliente aplica essa validação
  antes da rede.
- **Defesa existente:** timeout de 15 segundos.
- **Defesa existente:** `maxContentLength` e `maxBodyLength` de 12 MB.
- **Defesa existente:** máximo de três redirects, com revalidação de cada
  destino.
- **Defesa existente:** permite somente `image/png`, `image/jpeg`, `image/gif`
  e `image/webp`, aceitando parâmetros do MIME, antes de produzir a data URL.
- **Defesa existente:** rejeita corpo vazio, repete defensivamente a verificação
  do limite no buffer recebido e confere assinatura básica compatível com o
  tipo declarado.
- **Defesa existente:** protocolos, credenciais, DNS e endereços IPv4/IPv6 são
  validados pelo cliente compartilhado antes da conexão.
- **Limitação observada:** a assinatura identifica o contêiner básico, mas não
  comprova que o arquivo inteiro seja uma imagem íntegra ou decodificável.
- **Hipótese a testar:** comportamento exato dos limites com respostas
  comprimidas, streams interrompidos e redirects que mudam de protocolo.

### URLs derivadas de manifests

`GET /api/templates/:template/:page` não recebe uma URL no corpo, mas o manifest
carregado pode conter `defaultLogo` remoto. Nesse caso, a rota chama
`resolveLogoAsset`.

Como o manifest vem do filesystem local, esse fluxo depende de alguém com
capacidade de alterar conteúdo implantado. Ainda assim, o destino é externo e
usa a rede do servidor.

Os parâmetros `template` e `page` são confinados a `TEMPLATE_ROOT` por
`manifestLoader`, antes de qualquer leitura. Ambos precisam ser segmentos
diretos não vazios: `.`, `..`, NUL, `/`, `\` e formas absolutas são rejeitados.
Depois dessa validação, `path.resolve` constrói o diretório e `path.relative`
comprova que ele não é absoluto nem começa fora da raiz. A defesa fica na
fronteira do filesystem e cobre a rota e outros chamadores de `loadManifest`.
Referências inválidas usam o contrato público `404 TEMPLATE_NOT_FOUND`, sem
expor o caminho resolvido. Testes unitários cobrem separadores POSIX e Windows,
segmentos normalizáveis, valores absolutos e nomes Unicode; testes HTTP exercem
`%2F`, `%5C` e `%2E%2E` contra um template válido colocado fora do catálogo.

## Requisições externas realizadas pelo servidor

| Local | Origem da URL | Timeout | Limite de resposta | Redirects | Tipo |
| --- | --- | ---: | ---: | ---: | --- |
| `newsScraper.fetch` | corpo de `/extract` | 10 s | 5 MB | 3 | `text/html` ou `application/xhtml+xml` |
| `routes/news.embedImage` | imagem extraída ou corpo de `/embed-image` | 15 s | 12 MB | 3 | PNG, JPEG, GIF ou WebP com assinatura básica |
| `assetResolver.resolveLogoAsset` | `defaultLogo` do manifest | 10 s | 1 MB | 3 | exige `image/svg+xml`, XML válido e allowlists |

Os três fluxos usam `safeHttpClient`, que aplica a mesma validação de URL, DNS,
endereços e redirects e retorna erros classificados. Os valores da tabela, o
máximo compartilhado de redirects e os `User-Agent`s usados por HTML e imagem
ficam centralizados em `src/lib/remoteRequestPolicy.js`; o perfil de SVG não
adiciona um `User-Agent`.

### Redirects

Todos os fluxos limitam a cadeia a três redirects. O cliente desativa redirects
automáticos do Axios, interpreta cada `Location`, repete a validação e a
resolução e só então inicia o salto seguinte. O `lookup` Promise-based não
resolve DNS: ele entrega somente um endereço do conjunto previamente validado.
Uma única deadline monotônica cobre a cadeia inteira; DNS e cada chamada Axios
recebem apenas o tempo restante, sem reiniciar o timeout em cada salto.

Em Node 24.5 ou posterior, `NODE_USE_ENV_PROXY=1` pode tornar os Agents globais
sensíveis a `HTTP_PROXY` e `HTTPS_PROXY`, contornando o `lookup` fornecido pela
aplicação mesmo quando o Axios recebe `proxy: false`. O `safeHttpClient` não usa
esses Agents globais: cada salto recebe Agents HTTP e HTTPS explícitos, sem
keep-alive, além do lookup fixado. Assim, proxy ambiental não participa das
requisições desse cliente, o socket continua subordinado ao endereço validado e
um salto não reutiliza conexão criada para uma validação anterior.

- **Defesa existente:** um redirect público para destino privado é rejeitado.
- **Defesa existente:** o cliente desabilita proxy no Axios e usa Agents
  explícitos próprios para impedir que proxy nativo do runtime contorne o
  endereço validado pelo `lookup`.
- **Defesa existente:** o teste de integração local confirma o endereço usado
  pelo socket e a preservação do hostname no cabeçalho `Host`.
- **Defesa existente:** testes em processos-filhos ativam proxy ambiental antes
  do carregamento do runtime e confirmam, para HTTP e HTTPS, zero conexões TCP e
  zero requisições no proxy, uso do lookup fixado e conexão no destino
  validado. O cenário HTTPS preserva `Host` e SNI e confia explicitamente apenas
  no certificado local da fixture; sem essa confiança, a validação TLS rejeita
  a conexão.
- **Hipótese a testar:** redirects reais, ciclos, respostas comprimidas e falhas
  entre resolução e socket.

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

- **Defesa existente:** limite de 5 MB durante o recebimento.
- **Risco confirmado de consumo de recursos:** um cliente pode fazer o servidor
  baixar e analisar repetidamente respostas dentro do limite.
- **Risco dependente do ambiente:** impacto depende de memória, concorrência,
  limites do proxy e disponibilidade da aplicação.

### Imagem extraída

Se o scraper retorna uma URL HTTP(S), o backend baixa seus bytes e produz
`data:<content-type>;base64,...`. Referências relativas são preservadas sem
resolução contra a URL da notícia e não passam pelo segundo download.

A data URL é enviada no JSON, guardada no frontend e atribuída ao `src` indicado
pelo manifest.

- **Defesa existente:** timeout, limite de 12 MB, três redirects, allowlist de
  MIME, corpo não vazio e assinatura básica de PNG, JPEG, GIF ou WebP.
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
3. aplica limite de 1 MB;
4. faz parsing XML estrito com `saxes`;
5. reconhece somente regras CSS locais com seletor de classe simples e
   propriedades de apresentação permitidas;
6. converte essas propriedades em atributos validados nos elementos;
7. reconstrói o documento usando allowlists de elementos, atributos e valores,
   sem conservar o elemento `style`;
8. guarda no `LOGO_CACHE` o resultado sanitizado sem dados de apresentação da
   chamada, como o texto alternativo;
9. envia o markup na resposta da rota de template;
10. o binding `logo` atribui o markup a `el.innerHTML` dentro do iframe.

Para SVG remoto:

- **Defesa existente:** scripts, `foreignObject`, elementos não reconhecidos,
  event handlers, estilos inline, CSS arbitrário e referências externas são
  removidos.
- **Defesa existente:** atributos de pintura e referência usam gramáticas
  fechadas. Escapes e comentários CSS, protocolos explícitos ou ofuscados,
  funções desconhecidas e valores ambíguos são descartados.
- **Defesa existente:** `href` e atributos que aceitam referências conservam
  somente fragmentos locais em sintaxe canônica, como `url(#identificador)`.
- **Defesa existente:** o subconjunto CSS aceito contém apenas seletores de
  classe simples e propriedades de apresentação com valores validados pela
  mesma gramática dos atributos. Se uma regra sair desse subconjunto, todo o
  conteúdo daquele elemento `style` é ignorado; nenhum CSS arbitrário é
  preservado no resultado.
- **Defesa existente:** XML malformado, `DOCTYPE`, raiz que não seja SVG e
  conteúdo acima do limite são rejeitados antes do cache.
- **Defesa existente:** timeout de 10 segundos, limite de 1 MB e máximo de três
  redirects.
- **Defesa existente:** exige `image/svg+xml`, aceitando parâmetros como
  `charset`; tipo ausente ou incompatível gera erro classificado.
- **Defesa existente:** validação compartilhada de protocolo, credenciais, DNS,
  endereços e redirects.
- **Risco dependente do ambiente:** exige que um manifest local confiado aponte
  para uma origem remota ou que o conteúdo dessa origem seja comprometido.
- **Hipótese a testar — XSS:** verificar em navegadores suportados se existe
  interpretação ativa não contemplada pelas allowlists atuais.
- **Hipótese a testar — requisições secundárias:** verificar se fragmentos
  locais preservados podem alcançar recursos fora do SVG sanitizado no
  documento do iframe ou durante o uso de `html-to-image`.

SVG local passa pelo mesmo sanitizador. O tamanho é consultado antes da leitura
e validado novamente sobre o texto. Os quatro logos existentes possuem testes
estruturais, de idempotência e das propriedades de apresentação essenciais; os
três que dependem de `.cls-1` preservam `fill="#fff"` como atributo. Isso não
constitui teste de equivalência visual em navegador. O filesystem continua
sendo uma fronteira confiada para os demais tipos de asset.

Uma logo HTTP(S) não SVG segue outro caminho: `resolveLogoAsset` não baixa seus
bytes no servidor, apenas devolve a URL como `src`. O binding de logo atribui
essa URL ao elemento de imagem ou a `backgroundImage`, e o navegador passa a
ser responsável pela requisição. Esse fluxo expõe o cliente à origem remota e
não recebe os limites de timeout e tamanho de `embedImage`.

O cache de logos não possui expiração, mas mantém no máximo 32 resoluções
bem-sucedidas e descarta a entrada mais antiga ao inserir uma nova chave no
limite. Valores ausentes, assets inválidos e falhas locais ou remotas não criam
cache negativo. Não existe invalidação quando um manifest ou asset muda durante
a execução.

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
- **Defesa existente:** antes da interpolação, a serialização JSON do manifest
  escapa `<`, U+2028 e U+2029 com sequências JavaScript. Isso impede que
  `</script>` vindo do manifest encerre o bootstrap e preserva o valor lógico
  reconstruído pelo JavaScript.
- **Defesa ausente:** sanitização do HTML e CSS do template.
- **Risco dependente do ambiente:** se um atacante puder alterar templates ou
  manifests locais, o código já concede execução e acesso de mesma origem; o
  iframe não é uma fronteira de segurança.
- **Limite da defesa:** templates e manifests locais continuam sendo conteúdo
  confiável; o iframe permanece sem sandbox e HTML local pode executar scripts
  e alcançar `window.parent`.

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
- **Defesa existente:** parâmetros `:template` e `:page` aceitam somente nomes
  diretos confinados a `TEMPLATE_ROOT`; a suíte testa segmentos codificados,
  traversal, `/` e `\` após a decodificação do Express.

Os arquivos estáticos são servidos pelo Express a partir de raízes definidas,
mas o comportamento completo de normalização e symlinks depende da biblioteca,
do filesystem e da implantação.

## Políticas atuais de timeout, tamanho e redirects

| Fluxo | Timeout | Limite de entrada/resposta | Redirects |
| --- | ---: | --- | --- |
| Corpo JSON da API | não aplicável no parser | 2 MB de entrada | não aplicável |
| Download da notícia | 10 s | 5 MB durante o recebimento | máximo 3 |
| Download de imagem | 15 s | 12 MB durante o recebimento | máximo 3 |
| Download de SVG remoto | 10 s | 1 MB durante o recebimento | máximo 3 |
| Fetch de imagem no navegador | nenhum explícito | nenhum explícito | padrão do navegador |
| Fontes e CSS externos | nenhum explícito no código da aplicação | nenhum explícito | navegador |

Não há timeout global do Express, rate limiting, limite explícito de
concorrência ou cancelamento das requisições externas quando o cliente
desconecta.

Os timeouts da tabela são deadlines totais de cada download, não limites
renovados por etapa. Quando a deadline expira, o cliente deixa de aguardar DNS
ou transporte e trata a falha como `TIMEOUT`. Isso não garante cancelamento
físico de um resolver injetado ou outra operação subjacente sem suporte a
cancelamento; sua conclusão tardia permanece observada internamente para evitar
rejeições não tratadas, e o timer do cliente é removido ao concluir.

## Mensagens de erro e vazamento de informações

### Respostas do backend

| Local | Status | Exposição |
| --- | ---: | --- |
| `/api/news/extract` sem URL | 400 | mensagem fixa |
| `/api/news/extract` com URL, protocolo ou credenciais inválidas | 400 | categoria estável do cliente seguro |
| `/api/news/extract` em erro classificado | 500 | mensagem, código e detalhe reconstruído de categoria conhecida |
| `/api/news/extract` em erro inesperado | 500 | mensagem fixa + `NEWS_EXTRACTION_FAILED` |
| `/api/news/embed-image` inválida | 400 | mensagem fixa |
| `/api/news/embed-image` em erro | 422 | mensagem, código e detalhe reconstruído de categoria conhecida |
| `/api/templates/:template/:page` ausente | 404 | `TEMPLATE_NOT_FOUND`, sem detalhe interno |
| manifest inválido | 500 | `TEMPLATE_INVALID`, sem detalhe do parser |
| arquivo obrigatório do template ilegível | 500 | `TEMPLATE_FILE_UNREADABLE`, sem detalhe de filesystem |
| falha de asset remoto do template | 502 | `TEMPLATE_REMOTE_ASSET_FAILED`, sem URL ou detalhe de rede |
| falha inesperada ao carregar template | 500 | `TEMPLATE_LOAD_FAILED`, sem detalhe interno |
| middleware global, JSON malformado | 400 | `INVALID_JSON` |
| middleware global, corpo acima de 2 MB | 413 | `PAYLOAD_TOO_LARGE` |
| middleware global, erro inesperado | 500 | `INTERNAL_ERROR` |

As rotas não enviam diretamente `error.message`. Detalhes de falhas remotas só
são incluídos depois de reconstruídos a partir de uma allowlist de categorias
do cliente seguro; mensagens Axios, hostnames, endereços, paths e stacks ficam
fora da resposta.

- **Defesa existente:** mensagens e códigos públicos são estáveis e separados
  do objeto de erro original.
- **Defesa existente:** testes exercitam mensagem Axios/DNS simulada, caminho
  de filesystem, erro do parser JSON e stack implícita sem encontrá-los no JSON
  público.
- **Risco dependente do ambiente:** novos pontos de resposta adicionados fora
  desse fluxo ainda precisam usar a mesma separação.

### Logs

O servidor registra:

- erros de rotas e middleware com método, rota, status, categoria pública,
  contexto da operação e objeto de erro original;
- falha ao importar `config.js`;
- endereço e porta de escuta.

O frontend registra erros de API, preview, bindings e geração no console.

- **Risco dependente do ambiente:** logs podem ser coletados por plataforma,
  compartilhados com operadores ou persistidos.
- **Defesa ausente:** política explícita de redaction e classificação de dados.

## Riscos consolidados

### SSRF

- **Defesa existente:** todos os downloads do servidor aceitam somente
  HTTP/HTTPS sem credenciais, resolvem o hostname antes da conexão, rejeitam
  respostas DNS não públicas e fixam um endereço validado.
- **Defesa existente:** a classificação de `2001::/23` mantém bloqueadas as
  atribuições não públicas, mas aceita as exceções globalmente alcançáveis
  registradas pela
  [IANA](https://www.iana.org/assignments/iana-ipv6-special-registry/).
- **Defesa existente:** cada redirect repete a validação e a cadeia é limitada
  a três saltos.
- **Dependente do ambiente:** serviços internos alcançáveis, metadados de nuvem,
  DNS e regras de firewall determinam o impacto de qualquer falha ou faixa não
  classificada; o cliente desabilita proxies nas requisições.
- **Hipótese a testar:** redirects com o adaptador real, incluindo respostas DNS
  múltiplas em cada salto.

### XSS e execução de conteúdo

- **Defesa existente:** texto de notícia e campos manuais atuais usam
  `textContent`.
- **Defesa existente:** SVG local e remoto passa por parser XML estrito e
  allowlists e gramáticas restritas de valores antes de chegar ao binding;
  estilos locais simples reconhecidos são convertidos em atributos, e
  `style` arbitrário não é preservado.
- **Defesas ausentes:** sanitização de templates, sandbox, CSP e allowlists de
  bindings.
- **Dependente do ambiente:** templates/manifests/assets locais precisam ser
  comprometidos ou uma logo remota configurada precisa fornecer conteúdo
  ativo.
- **Defesa existente:** a serialização do manifest escapa `<`, U+2028 e U+2029
  antes de interpolar o valor no bootstrap; testes cobrem `</script>` e
  confirmam a reconstrução lógica do conteúdo original.
- **Hipóteses a testar:** bypass das allowlists SVG em navegador, binding
  `html`, atributos e toast. A defesa de serialização não torna confiáveis o
  HTML, o CSS ou os bindings do manifest local.

### Consumo excessivo de recursos

- **Confirmado pelo código:** não há rate limiting nem limite de concorrência;
  buffers, parsing e conversão base64 ainda consomem memória dentro dos limites.
- **Defesas existentes:** corpo JSON de 2 MB; timeout e limite de resposta para
  notícia, imagem e SVG; máximo de três redirects.
- **Dependente do ambiente:** proxy, quantidade de processos, memória, CPU e
  conectividade influenciam disponibilidade.
- **Hipóteses a testar:** memória sob concorrência, compressão, parse de HTML
  grande, cache de SVG e custo do base64.

### Vazamento de informações

- **Defesa existente:** rotas e middleware revisados não expõem diretamente
  `error.message`, paths, stacks ou mensagens do Axios/DNS.
- **Dependente do ambiente:** logs internos conservam o erro original e podem
  conter filesystem, rede e configuração; acesso e retenção dos logs continuam
  sendo responsabilidades operacionais.
- **Defesa ausente:** identificador de correlação e política central de redaction
  para logs.

## Cobertura e lacunas de verificação

A suíte atual cobre de forma unitária a validação de URL, classificação IPv4 e
IPv6 — incluindo exceções públicas em `2001::/23` —, resolução DNS simulada,
redirects, timeouts, limites, MIME e erros do cliente compartilhado. Um teste
local atravessa Axios, lookup e socket sem internet. As suítes consumidoras
simulam os três fluxos externos. Ela não cobre:

- integração real de redirects e compressão;
- decodificação completa e integridade estrutural das imagens;
- política de redaction e correlação dos logs internos;
- execução de SVG local ou remoto em navegador;
- bindings, `innerHTML` e construção do iframe em navegador real; esses fluxos
  possuem cobertura automatizada em DOM simulado;
- concorrência e consumo de memória;
- comportamento de browser na exportação.

Os testes demonstram as decisões e opções do cliente em isolamento, mas não
constituem garantia de segurança da pilha de rede completa.

## Itens deliberadamente não concluídos neste documento

Este modelo registra o estado atual. Ele não:

- define uma política futura completa;
- altera o iframe;
- estabelece limites operacionais ideais;
- comprova hipóteses que exigem testes de integração ou navegador.
