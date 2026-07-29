const http = require('http');
const path = require('path');

jest.mock('axios');

const originalCwd = process.cwd();
const fixtureWorkspace = path.resolve('test/fixtures/template-workspace');

async function withTemplateServer(callback) {
  jest.resetModules();
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

  test('lista manifest válido, omite manifest ausente e preserva JSON inválido', async () => {
    await withTemplateServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/templates`);
      const templates = await response.json();
      const fixture = templates.find((entry) => entry.template === 'fixture');
      const pagesByName = [...fixture.pages].sort((a, b) => a.name.localeCompare(b.name));

      expect(response.status).toBe(200);
      expect(pagesByName).toEqual([
        { name: 'invalid-manifest' },
        {
          name: 'missing-html',
          dimensions: { width: 320, height: 480 },
        },
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
    });
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
});
