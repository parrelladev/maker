const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadApi(fetch) {
  const window = { fetch };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'api.js'), 'utf8'), { window, fetch, console });
  return window.Api;
}

describe('API editorial do frontend', () => {
  test('obtém o catálogo sem transformar o payload', async () => {
    const payload = { brands: [{ id: 'brand-x' }] };
    const api = loadApi(jest.fn().mockResolvedValue({ ok: true, json: async () => payload }));
    await expect(api.getEditorCatalog()).resolves.toBe(payload);
  });

  test('resolve renderer enviando somente a seleção recebida', async () => {
    const fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ template: 'renderer', page: 'index' }) });
    const api = loadApi(fetch);
    const selection = { brand: 'x', family: 'y', variant: 'z', format: 'story' };
    await api.resolveEditorRenderer(selection);
    expect(fetch).toHaveBeenCalledWith('/api/editor/resolve', expect.objectContaining({
      method: 'POST', body: JSON.stringify(selection),
    }));
  });

  test('produz erro previsível com código público', async () => {
    const api = loadApi(jest.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Falhou', code: 'CATALOG_FAIL' }) }));
    await expect(api.getEditorCatalog()).rejects.toMatchObject({ message: 'Falhou', code: 'CATALOG_FAIL' });
  });
});
