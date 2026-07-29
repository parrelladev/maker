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

Existem dez arquivos:

```text
src/server.test.js
src/routes/templates.test.js
src/routes/news.external.test.js
src/lib/assetResolver.external.test.js
src/lib/assetResolver.local.test.js
src/lib/imageValidator.test.js
src/lib/remoteRequestPolicy.test.js
src/lib/safeHttpClient.test.js
src/lib/svgSanitizer.test.js
src/services/newsScraper.test.js
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
perigosas, além da rejeição de XML malformado.

A suíte de `src/lib/assetResolver.local.test.js` confirma que SVG local também
é sanitizado e que arquivos acima de 1 MB são rejeitados antes da leitura.

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
timers em sucesso e erro.

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

## Módulos e comportamentos cobertos

### Cobertura direta demonstrada

| Módulo | Símbolo | Comportamento demonstrado |
| --- | --- | --- |
| `src/server.js` | `app`, middleware global e guard do entrypoint | importação sem listener, uso HTTP, interface, erros públicos, delegação após `headersSent` e inicialização direta |
| `src/routes/templates.js` | rotas de listagem e carregamento | manifest válido, ausente e inválido; HTML e CSS; logo local e ausente; caminhos inexistentes e erros públicos sem paths |
| `src/lib/manifestLoader.js` | `listTemplates` e `loadManifest` por meio das rotas | descoberta, filtragem, parsing e validação dos arquivos mínimos |
| `src/lib/assetResolver.js` | `resolveLogoAsset` | SVG local, fallback de logo ausente e download SVG remoto simulado |
| `src/lib/imageValidator.js` | `validateImageResponse` | allowlist de MIME, corpo binário, tamanho, vazio e assinaturas básicas |
| `src/lib/remoteRequestPolicy.js` | políticas de HTML, imagem e SVG | valores concretos, `User-Agent`s e imutabilidade |
| `src/lib/safeHttpClient.js` | `get`, lookup, validação e classificação | protocolos, credenciais, DNS, IPv4/IPv6, redirects, limites, contrato Axios e conexão local real |
| `src/lib/svgSanitizer.js` | `sanitizeSvg` | XML estrito, gramáticas de valores, CSS local simples, referências locais, idempotência, limite e SVGs maliciosos representativos |
| `src/routes/news.js` | validações de `/extract` e `/embed-image`; `embedImage` pela rota | validações existentes, incorporação, limites configurados, MIME, erros classificados, falha inesperada sem detalhe e bloqueios |
| `src/services/newsScraper.js` | `extractChapeu` e `fetch` | extração, configuração do cliente, respostas e bloqueios |

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
- ordem dos arquivos CSS dentro de um mesmo diretório;
- cache de logos;

### Frontend

- catálogo e seleção de templates;
- seleção e troca de tema;
- abertura e fechamento do modal;
- precedência entre valores manuais e extraídos;
- associação do cache de notícia à URL;
- respostas assíncronas atrasadas;
- restauração de botões e loading em sucesso e erro;
- cliente das APIs;
- construção do documento do iframe;
- escala do preview;
- bindings de texto, HTML, imagem e logo;
- variáveis CSS, classes e atributos;
- confiança em manifest e template;
- espera de fontes e imagens;
- bloqueio de imagens não exportáveis;
- captura com `html-to-image`;
- equivalência visual entre preview e PNG;
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

## Resultado atual

Comando:

```powershell
npm.cmd test
```

Resultado observado:

```text
Test Suites: 10 passed, 10 total
Tests:       206 passed, 206 total
Snapshots:   0 total
```

Todos os 206 testes existentes passaram. Uma requisição controlada usa a pilha
Axios/lookup/socket local; nenhuma chamada à internet é realizada.

O guard do entrypoint permite importar a aplicação sem abrir a porta configurada.
Os testes HTTP usam portas efêmeras e encerram seus servidores e processos.
