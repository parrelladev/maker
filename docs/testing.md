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

Existem três arquivos:

```text
src/server.test.js
src/routes/templates.test.js
src/services/newsScraper.test.js
```

A suíte de `server.test.js` verifica:

1. importar a aplicação sem chamar `app.listen`;
2. usar o app em um servidor HTTP local com porta efêmera;
3. `GET /` retornando a interface HTML;
4. manter registradas `GET /api/templates` e `POST /api/news/extract`;
5. URL obrigatória em `POST /api/news/extract`;
6. URL ausente e protocolo inválido em `POST /api/news/embed-image`;
7. JSON malformado convertido em resposta 500 pelo middleware global;
8. iniciar o servidor ao executar `src/server.js` como entrypoint.

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

A suíte importa `extractChapeu` de `src/services/newsScraper.js`, cria fragmentos
HTML em memória com Cheerio e verifica três comportamentos:

1. extrai o chapéu da seção imediatamente anterior à seção do título no layout
   atual da A Gazeta;
2. preserva a extração pelo seletor legado
   `label.text-tw-theme-box-kicker-default[id^="kicker-"]`;
3. retorna `null` quando há apenas conteúdo comum antes do título.

## Módulos e comportamentos cobertos

### Cobertura direta demonstrada

| Módulo | Símbolo | Comportamento demonstrado |
| --- | --- | --- |
| `src/server.js` | `app`, middleware global e guard do entrypoint | importação sem listener, uso HTTP, interface, erro de JSON e inicialização direta |
| `src/routes/templates.js` | rotas de listagem e carregamento | manifest válido, ausente e inválido; HTML e CSS; logo local e ausente; caminhos inexistentes |
| `src/lib/manifestLoader.js` | `listTemplates` e `loadManifest` por meio das rotas | descoberta, filtragem, parsing e validação dos arquivos mínimos |
| `src/lib/assetResolver.js` | `resolveLogoAsset` por meio da rota | SVG local e fallback de logo ausente |
| `src/routes/news.js` | validações de `/extract` e `/embed-image` | URL obrigatória, URL de imagem ausente e protocolo inválido |
| `src/services/newsScraper.js` | `extractChapeu` | layout atual, layout legado e ausência de correspondência |

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
- `fetch` e sua chamada ao Axios;
- timeout e User-Agent;
- erros HTTP, de rede e de parsing;
- documentos vazios ou malformados;
- URLs de imagem relativas.

## Comportamentos importantes sem cobertura

### Backend

- resolução de `PORT` e `config.js`;
- limite de 2 MB do parser JSON;
- ordem completa dos middlewares e caminhos negativos de arquivos estáticos;
- sucesso e falhas remotas de `POST /api/news/extract`;
- sucesso e resposta 422 de `POST /api/news/embed-image`;
- ordem dos arquivos CSS dentro de um mesmo diretório;
- cache de logos;
- SVG remoto;
- incorporação de imagem como data URL;
- validação de tipo de conteúdo MIME;
- timeouts, limites de resposta e redirects;
- proteção contra SSRF.

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

- protocolos e tipos aceitos como URL;
- loopback, link-local, redes privadas e endereços reservados;
- resolução DNS e redirects para destinos não públicos;
- limites de respostas remotas;
- respostas comprimidas;
- timeouts;
- MIME e conteúdo real de imagens;
- exposição de detalhes internos;
- SVG ativo e `innerHTML`;
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
- `axios` e `newsScraper` são mockados em `server.test.js`; o filesystem e as
  dependências do browser não possuem mocks ou pontos de injeção configurados.
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
Test Suites: 3 passed, 3 total
Tests:       20 passed, 20 total
Snapshots:   0 total
```

Todos os testes existentes passaram. Esse resultado confirma os oito cenários
da aplicação Express, os nove cenários de fixtures de templates e os três
cenários de `extractChapeu` descritos neste documento.

O guard do entrypoint permite importar a aplicação sem abrir a porta configurada.
Os testes HTTP usam portas efêmeras e encerram seus servidores e processos.
