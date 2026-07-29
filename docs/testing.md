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

- não acessa a rede;
- não depende de relógio;
- não grava no filesystem;
- não inicia o Express;
- não abre navegador;
- não usa fixtures externas.

Não há configuração de limite mínimo de cobertura, snapshots ou setup global.

## Testes existentes

Existe um único arquivo:

```text
src/services/newsScraper.test.js
```

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

- composição e inicialização do Express;
- resolução de `PORT` e `config.js`;
- parser JSON e limite de 2 MB;
- arquivos estáticos;
- contratos, status e mensagens das rotas;
- `GET /api/templates`;
- `GET /api/templates/:template/:page`;
- `POST /api/news/extract`;
- `POST /api/news/embed-image`;
- listagem e carregamento de manifests;
- manifests inexistentes ou com JSON inválido;
- presença de `index.html`;
- ordem dos arquivos CSS;
- resolução e cache de logos;
- SVG local e remoto;
- incorporação de imagem como data URL;
- validação de tipo de conteúdo;
- timeouts, limites e redirects;
- caminhos negativos e middleware global de erro.

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
- Não há `supertest` ou harness equivalente para exercitar o Express.
- `src/server.js` chama `app.listen` ao ser importado, o que dificulta testes
  isolados da aplicação HTTP.
- Axios, filesystem e dependências do browser não possuem mocks ou pontos de
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
Test Suites: 1 passed, 1 total
Tests:       3 passed, 3 total
Snapshots:   0 total
```

Todos os testes existentes passaram. Esse resultado confirma somente os três
cenários de `extractChapeu` descritos neste documento.

Nenhum ajuste de código, script, dependência ou teste foi necessário para obter
uma execução determinística da suíte existente.
