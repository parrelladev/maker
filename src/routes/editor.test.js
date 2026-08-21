const express = require('express');
const http = require('http');
const { EditorCatalogError } = require('../lib/editorCatalog');
const { createEditorRouter } = require('./editor');

async function withServer(router, callback) {
  const app = express();
  app.use(express.json());
  app.use('/api/editor', router);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('API editorial', () => {
  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  test('publica HZ Story no catalogo e resolve o renderer real sem fallback para Feed', async () => {
    await withServer(createEditorRouter(), async baseUrl => {
      const catalogResponse = await fetch(`${baseUrl}/api/editor/catalog`);
      const catalog = await catalogResponse.json();
      const hz = catalog.brands.find(brand => brand.id === 'hz');
      expect(hz.families[0].variants[0].formats).toEqual([expect.objectContaining({
        id: 'story', dimensions: { width: 1080, height: 1920 },
        themes: [{ id: 'rosa', label: 'Rosa' }, { id: 'amarelo', label: 'Amarelo' }],
      })]);

      const selection = { brand: 'hz', family: 'noticia', variant: 'foto-card' };
      const story = await fetch(`${baseUrl}/api/editor/resolve`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...selection, format: 'story' }),
      });
      expect(story.status).toBe(200);
      expect(await story.json()).toMatchObject({
        template: 'layout-hz', page: 'index', dimensions: { width: 1080, height: 1920 },
      });

      const feed = await fetch(`${baseUrl}/api/editor/resolve`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...selection, format: 'feed' }),
      });
      expect(feed.status).toBe(404);
      expect(await feed.json()).toMatchObject({ code: 'EDITOR_RENDERER_NOT_FOUND' });
    });
  });

  test('expõe somente o catálogo público e reutiliza a instância na resolução', async () => {
    const catalog = { brands: [{ id: 'brand-x', name: 'X', families: [] }] };
    const buildCatalog = jest.fn().mockResolvedValue(catalog);
    const resolve = jest.fn().mockReturnValue({ template: 'renderer-x', page: 'index', dimensions: { width: 1, height: 2 }, themes: [] });
    await withServer(createEditorRouter({ buildCatalog, resolve }), async baseUrl => {
      const publicCatalog = await (await fetch(`${baseUrl}/api/editor/catalog`)).json();
      const resolved = await (await fetch(`${baseUrl}/api/editor/resolve`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brand: 'brand-x', family: 'y', variant: 'z', format: 'story' }),
      })).json();
      expect(publicCatalog).toEqual(catalog);
      expect(JSON.stringify(publicCatalog)).not.toMatch(/renderer|root|path|template/i);
      expect(resolved.template).toBe('renderer-x');
      expect(resolve).toHaveBeenCalledWith(catalog, expect.objectContaining({ format: 'story' }));
      expect(buildCatalog).toHaveBeenCalledTimes(1);
    });
  });

  test('rejeita seleção incompleta e traduz renderer inexistente', async () => {
    const resolve = jest.fn(() => { throw new EditorCatalogError('EDITOR_CATALOG_RENDERER_NOT_FOUND', 'interno'); });
    await withServer(createEditorRouter({ buildCatalog: async () => ({ brands: [] }), resolve }), async baseUrl => {
      const invalid = await fetch(`${baseUrl}/api/editor/resolve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      expect(invalid.status).toBe(400);
      const missing = await fetch(`${baseUrl}/api/editor/resolve`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brand: 'x', family: 'y', variant: 'z', format: 'story' }),
      });
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({ error: 'Renderer editorial não encontrado', code: 'EDITOR_RENDERER_NOT_FOUND' });
    });
  });

  test('falha de catálogo não vaza diagnóstico e permite nova tentativa', async () => {
    const buildCatalog = jest.fn().mockRejectedValueOnce(new Error('C:\\secret')).mockResolvedValueOnce({ brands: [] });
    await withServer(createEditorRouter({ buildCatalog }), async baseUrl => {
      const first = await fetch(`${baseUrl}/api/editor/catalog`);
      expect(first.status).toBe(500);
      expect(JSON.stringify(await first.json())).not.toContain('secret');
      expect((await fetch(`${baseUrl}/api/editor/catalog`)).status).toBe(200);
    });
  });
});
