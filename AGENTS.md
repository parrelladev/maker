# AGENTS.md — Maker

## Objetivo do projeto

Maker é uma aplicação Node.js/Express com frontend em JavaScript puro que:

1. lista templates HTML/CSS;
2. extrai dados de uma notícia;
3. aplica esses dados ao DOM de um iframe;
4. apresenta um preview;
5. exporta o mesmo DOM como PNG no navegador.

A aplicação está funcional. O objetivo das mudanças é melhorar segurança, legibilidade, testabilidade e manutenibilidade sem alterar o comportamento esperado.

## Princípio principal

Preserve o comportamento existente.

Não faça reescritas completas, migrações de framework ou grandes mudanças arquiteturais sem uma solicitação explícita.

Prefira refatorações incrementais, verificáveis e reversíveis.

## Antes de modificar código

Para cada tarefa:

1. Leia este arquivo.
2. Leia `README.md`.
3. Leia os documentos relevantes em `docs/`.
4. Inspecione os arquivos afetados e seus chamadores.
5. Identifique os testes existentes.
6. Execute os testes antes da mudança para estabelecer uma baseline.
7. Descreva sucintamente o comportamento atual e o plano da alteração.
8. Somente depois modifique o código.

Não suponha comportamento que não esteja demonstrado pelo código, pelos testes ou pela documentação.

## Escopo das mudanças

Cada tarefa deve resolver apenas um problema principal.

Não combine no mesmo trabalho:

* correção de segurança;
* reorganização arquitetural;
* renomeação ampla;
* alteração visual;
* mudança de regra de negócio;
* atualização extensa de dependências.

Alterações adicionais só são permitidas quando forem necessárias para completar a tarefa com segurança.

## Regras de refatoração

* Preserve APIs e contratos existentes, salvo instrução explícita em contrário.
* Não introduza abstrações genéricas para apenas uma ocorrência.
* Não divida funções apenas para reduzir quantidade de linhas.
* Extraia funções quando isso eliminar responsabilidade, estado ou regra duplicada.
* Prefira funções puras para transformação e validação de dados.
* Torne dependências explícitas por parâmetros ou objetos de contexto.
* Evite novo estado global.
* Não introduza um framework frontend como parte de uma refatoração localizada.
* Não substitua JavaScript simples por padrões complexos sem benefício demonstrável.
* Não faça alterações cosméticas extensas junto com mudanças comportamentais.
* Preserve a ordem de precedência entre dados manuais e dados extraídos.
* Preserve a equivalência entre o preview e o PNG exportado.

## Segurança

Toda URL fornecida pelo usuário deve ser considerada não confiável.

Antes de implementar ou alterar downloads realizados pelo servidor:

* aceite somente HTTP e HTTPS;
* bloqueie loopback, link-local, redes privadas e endereços reservados;
* valide o destino após cada redirecionamento;
* aplique timeout;
* aplique limite de bytes;
* valide o tipo de conteúdo;
* não confie apenas em regex da URL;
* não exponha caminhos internos ou mensagens sensíveis nas respostas HTTP.

Não reduza controles de segurança para manter compatibilidade sem registrar claramente o conflito.

## Frontend

O frontend atualmente depende de:

* estado da seleção do template;
* estado do tema;
* dados extraídos da notícia;
* campos editados manualmente;
* manifest;
* documento do iframe;
* runtime de bindings;
* exportação com `html-to-image`.

Ao modificar o frontend:

* documente quais estados são lidos e alterados;
* preserve a precedência dos campos manuais;
* evite dependência de ordem não documentada;
* trate respostas assíncronas atrasadas;
* garanta que loading e botões sejam restaurados em caso de erro;
* não silencie erros com `catch(() => {})` sem justificativa;
* mantenha o preview consistente com o conteúdo exportado.

## Backend

Rotas HTTP devem ser finas.

Elas devem preferencialmente:

1. validar a entrada;
2. chamar um serviço;
3. converter resultados e erros para HTTP.

Leitura de arquivos, downloads, parsing e transformação devem ficar em serviços ou bibliotecas testáveis quando a extração reduzir responsabilidades reais.

## Testes

O comando principal é:

```bash
npm test
```

Antes de finalizar:

1. execute os testes relacionados;
2. execute a suíte completa;
3. registre os comandos executados;
4. informe qualquer teste não executado e o motivo.

Para refatorações de código sem cobertura suficiente, adicione primeiro testes de caracterização.

Testes de caracterização devem registrar o comportamento atual, ainda que ele não represente o design ideal.

Não altere testes somente para fazer uma implementação incorreta passar.

## Validações mínimas

Conforme os arquivos afetados, verifique:

* extração de título, subtítulo, chapéu e imagem;
* precedência entre valor manual e extraído;
* cache associado à URL correta;
* carregamento e resolução de manifests;
* ordem dos arquivos CSS;
* bindings de texto, HTML, imagem, logo, classes, atributos e variáveis CSS;
* loading restaurado em sucesso e erro;
* exportação bloqueada quando imagens não são exportáveis;
* bloqueio de URLs privadas em requisições do servidor.

## Critério de conclusão

Uma tarefa só está concluída quando:

* o escopo solicitado foi implementado;
* o comportamento preservado está coberto por testes;
* os testes passam;
* não há logs temporários ou código morto;
* o diff não contém mudanças não relacionadas;
* riscos e limitações foram explicitados;
* a documentação relevante foi atualizada;
* o resultado pode ser revisado como uma unidade pequena.

## Formato do relatório final

Ao concluir uma tarefa, informe:

1. comportamento anterior;
2. mudança realizada;
3. arquivos alterados;
4. testes adicionados ou ajustados;
5. comandos executados e resultados;
6. riscos residuais;
7. itens deliberadamente deixados fora do escopo.

Nunca declare que algo está seguro, correto ou coberto sem evidência de testes ou inspeção.
