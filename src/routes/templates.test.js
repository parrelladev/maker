const http = require('http');
const path = require('path');

jest.mock('axios');

const originalCwd = process.cwd();
const fixtureWorkspace = path.resolve('test/fixtures/template-workspace');

async function withTemplateServer(callback, createLoadError) {
  jest.resetModules();
  if (createLoadError) {
    const templatePageErrors = require('../lib/templatePageErrors');
    const loadError = createLoadError(templatePageErrors);
    jest.doMock('../services/templatePageService', () => ({
      loadTemplatePage: jest.fn().mockRejectedValue(loadError),
    }));
  }
  const express = require('express');
  const templatesRouter = require('./templates');
  const app = express();
  app.use('/api/templates', templatesRouter);

  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const { port } = server.address();
    return await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    jest.dontMock('../services/templatePageService');
  }
}

describe('rotas de templates com fixtures mínimas', () => {
  beforeEach(() => {
    process.chdir(fixtureWorkspace);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    jest.restoreAllMocks();
    jest.resetModules();
  });

  afterAll(() => {
    process.chdir(originalCwd);
  });

  test('lista somente páginas com manifest e HTML válidos', async () => {
    await withTemplateServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/templates`);
      const templates = await response.json();
      const fixture = templates.find((entry) => entry.template === 'fixture');
      const pagesByName = [...fixture.pages].sort((a, b) => a.name.localeCompare(b.name));

      expect(response.status).toBe(200);
      expect(pagesByName).toEqual([
        {
          name: 'missing-logo',
          defaultLogo: 'missing-logo.svg',
          dimensions: { width: 320, height: 480 },
        },
        {
          name: 'valid',
          logoField: 'logo',
          defaultLogo: 'fixture-logo.svg',
          dimensions: { width: 320, height: 480 },
        },
      ]);
      expect(console.warn).toHaveBeenCalledTimes(3);
      expect(console.warn).toHaveBeenCalledWith(
        '[templates] página ignorada na listagem',
        expect.objectContaining({
          template: 'fixture',
          page: 'invalid-manifest',
          code: 'TEMPLATE_MANIFEST_INVALID',
        })
      );
    });
  });

  test('expõe diagnósticos internos para cada motivo de página inválida', async () => {
    jest.resetModules();
    const { inspectTemplateCatalog } = require('../lib/manifestLoader');

    const catalog = await inspectTemplateCatalog();

    expect(catalog.diagnostics).toEqual(expect.arrayContaining([
      {
        template: 'fixture',
        page: 'missing-manifest',
        code: 'TEMPLATE_MANIFEST_MISSING',
      },
      {
        template: 'fixture',
        page: 'invalid-manifest',
        code: 'TEMPLATE_MANIFEST_INVALID',
      },
      {
        template: 'fixture',
        page: 'missing-html',
        code: 'TEMPLATE_HTML_MISSING',
      },
    ]));
    expect(catalog.diagnostics).toHaveLength(3);
  });

  test('carrega HTML, CSS compartilhado, CSS da página e logo local', async () => {
    await withTemplateServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/templates/fixture/valid`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.manifest.name).toBe('Fixture válida');
      expect(body.html).toContain('Fixture válida');
      expect(body.css.map((file) => ({ ...file, content: file.content.trim() }))).toEqual([
        { name: path.join('css', 'shared.css'), content: '.shared { color: navy; }' },
        { name: path.join('valid', 'page.css'), content: '.page { color: white; }' },
      ]);
      expect(body.resolvedLogo.kind).toBe('inline-svg');
      expect(body.resolvedLogo.markup).toContain('<title>Fixture logo</title>');
      expect(require('axios').get).not.toHaveBeenCalled();
    });
  });

  test('retorna lista de CSS vazia quando template e página não possuem CSS', async () => {
    await withTemplateServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/templates/no-css/index`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.css).toEqual([]);
    });
  });

  test('mantém o template carregável quando a logo local está ausente', async () => {
    await withTemplateServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/templates/fixture/missing-logo`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.resolvedLogo).toBeNull();
    });
  });

  test.each([
    '/api/templates/template-inexistente/index',
    '/api/templates/fixture/pagina-inexistente',
  ])('retorna 404 estável para diretório inexistente em %s', async (route) => {
    await withTemplateServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}${route}`);
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body).toEqual({
        error: 'Template não encontrado',
        code: 'TEMPLATE_NOT_FOUND',
      });
      expect(JSON.stringify(body)).not.toContain(fixtureWorkspace);
      expect(console.error).toHaveBeenCalled();
    });
  });

  test.each([
    'missing-manifest',
    'missing-html',
  ])('retorna 404 estável para %s', async (page) => {
    await withTemplateServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/templates/fixture/${page}`);
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body).toEqual({
        error: 'Template não encontrado',
        code: 'TEMPLATE_NOT_FOUND',
      });
      expect(JSON.stringify(body)).not.toMatch(
        /template-workspace|manifest\.json|index\.html|Unexpected token/i
      );
      expect(console.error).toHaveBeenCalled();
    });
  });

  test('retorna 500 estável para manifest JSON inválido', async () => {
    await withTemplateServer(async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/templates/fixture/invalid-manifest`
      );
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body).toEqual({
        error: 'Template inválido',
        code: 'TEMPLATE_INVALID',
      });
      expect(JSON.stringify(body)).not.toMatch(
        /template-workspace|manifest\.json|Unexpected token|position \d+/i
      );
      expect(console.error).toHaveBeenCalled();
    });
  });

  test('retorna 500 específico para arquivo obrigatório ilegível', async () => {
    await withTemplateServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/templates/fixture/valid`);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body).toEqual({
        error: 'Não foi possível ler um arquivo obrigatório do template',
        code: 'TEMPLATE_FILE_UNREADABLE',
      });
      expect(JSON.stringify(body)).not.toMatch(/EACCES|template-workspace/i);
      expect(console.error).toHaveBeenCalled();
    }, ({ TemplateRequiredFileUnreadableError }) => (
      new TemplateRequiredFileUnreadableError('EACCES em caminho interno')
    ));
  });

  test('retorna 502 específico para falha de asset remoto', async () => {
    await withTemplateServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/templates/fixture/valid`);
      const body = await response.json();

      expect(response.status).toBe(502);
      expect(body).toEqual({
        error: 'Não foi possível resolver um asset remoto do template',
        code: 'TEMPLATE_REMOTE_ASSET_FAILED',
      });
      expect(JSON.stringify(body)).not.toMatch(/cdn\.example|timeout/i);
      expect(console.error).toHaveBeenCalled();
    }, ({ TemplateRemoteAssetError }) => (
      new TemplateRemoteAssetError('timeout em https://cdn.example/logo.svg')
    ));
  });

  test('retorna 500, e não 404, para erro interno inesperado', async () => {
    await withTemplateServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/templates/fixture/valid`);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body).toEqual({
        error: 'Não foi possível carregar o template',
        code: 'TEMPLATE_LOAD_FAILED',
      });
      expect(JSON.stringify(body)).not.toContain('falha inesperada');
      expect(console.error).toHaveBeenCalled();
    }, () => new Error('falha inesperada'));
  });
});
