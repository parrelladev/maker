const path = require('path');

const originalCwd = process.cwd();
const fixtureWorkspace = path.resolve('test/fixtures/editor-catalog-integration');

describe('editorCatalog com filesystem e loaders reais', () => {
  let catalog;
  let registeredBrands;
  let resolveRenderer;

  beforeAll(async () => {
    process.chdir(fixtureWorkspace);
    jest.resetModules();

    const { createBrandRegistry } = require('./brandRegistry');
    const { inspectTemplateCatalog } = require('./manifestLoader');
    const editorCatalog = require('./editorCatalog');
    const registry = createBrandRegistry({ brandRoot: path.join(fixtureWorkspace, 'brands') });

    registeredBrands = await registry.listBrands();
    catalog = await editorCatalog.buildEditorCatalog({
      inspectTemplateCatalogFn: inspectTemplateCatalog,
      loadBrandFn: registry.loadBrand,
    });
    resolveRenderer = editorCatalog.resolveRenderer;
  });

  afterAll(() => {
    process.chdir(originalCwd);
    jest.resetModules();
  });

  test('deriva a hierarquia completa de brand.json e manifests descobertos no filesystem', () => {
    expect(registeredBrands).toEqual([
      { id: 'brand-a', name: 'Brand A from brand.json' },
      { id: 'brand-b', name: 'Brand B from brand.json' },
      { id: 'thirdbrand', name: 'Third Brand' },
    ]);
    expect(catalog).toEqual({
      brands: [
        {
          id: 'brand-a',
          name: 'Brand A from brand.json',
          families: [{
            id: 'padrao',
            label: 'padrao',
            variants: [{
              id: 'foto-acima',
              label: 'Foto acima',
              formats: [
                {
                  id: 'feed',
                  dimensions: { width: 1080, height: 1350 },
                  themes: [{ id: 'paper', label: 'Paper' }],
                },
                {
                  id: 'story',
                  dimensions: { width: 1080, height: 1920 },
                  themes: [
                    { id: 'azul', label: 'Azul' },
                    { id: 'preto', label: 'Preto' },
                  ],
                },
              ],
            }],
          }],
        },
        {
          id: 'brand-b',
          name: 'Brand B from brand.json',
          families: [{
            id: 'padrao',
            label: 'padrao',
            variants: [{
              id: 'texto',
              label: 'Texto',
              formats: [{
                id: 'story',
                dimensions: { width: 1080, height: 1920 },
                themes: [],
              }],
            }],
          }],
        },
        {
          id: 'thirdbrand',
          name: 'Third Brand',
          families: [{
            id: 'especial',
            label: 'especial',
            variants: [{
              id: 'quote-card',
              label: 'Quote card',
              formats: [{
                id: 'square',
                dimensions: { width: 900, height: 900 },
                themes: [{ id: 'green', label: 'Green' }],
              }],
            }],
          }],
        },
      ],
    });
  });

  test.each([
    [
      { brand: 'brand-a', family: 'padrao', variant: 'foto-acima', format: 'story' },
      {
        template: 'brand-a-story', page: 'index',
        dimensions: { width: 1080, height: 1920 },
        themes: [
          { id: 'azul', label: 'Azul' },
          { id: 'preto', label: 'Preto' },
        ],
      },
    ],
    [
      { brand: 'brand-a', family: 'padrao', variant: 'foto-acima', format: 'feed' },
      {
        template: 'brand-a-feed', page: 'index',
        dimensions: { width: 1080, height: 1350 },
        themes: [{ id: 'paper', label: 'Paper' }],
      },
    ],
    [
      { brand: 'thirdbrand', family: 'especial', variant: 'quote-card', format: 'square' },
      {
        template: 'thirdbrand-square', page: 'index',
        dimensions: { width: 900, height: 900 },
        themes: [{ id: 'green', label: 'Green' }],
      },
    ],
  ])('resolve renderer descoberto por arquivos para %j', (selection, expected) => {
    expect(resolveRenderer(catalog, selection)).toEqual(expected);
  });

  test.each([
    { brand: 'missing', family: 'padrao', variant: 'foto-acima', format: 'story' },
    { brand: 'brand-a', family: 'missing', variant: 'foto-acima', format: 'story' },
    { brand: 'brand-a', family: 'padrao', variant: 'missing', format: 'story' },
    { brand: 'brand-a', family: 'padrao', variant: 'foto-acima', format: 'missing' },
  ])('rejeita seleção inexistente sem fallback: %j', selection => {
    expect(() => resolveRenderer(catalog, selection)).toThrow(expect.objectContaining({
      code: 'EDITOR_CATALOG_RENDERER_NOT_FOUND',
    }));
  });

  test('não serializa raízes, diretórios físicos ou rendererRefs', () => {
    const serialized = JSON.stringify(catalog);
    expect(serialized).not.toContain(fixtureWorkspace);
    expect(serialized).not.toContain('\\');
    expect(serialized).not.toContain('/tmp/');
    expect(serialized).not.toContain('editor-catalog-integration');
    expect(serialized).not.toContain('rendererRef');
    expect(serialized).not.toContain('templates/');
    expect(serialized).not.toContain('brands/');
  });
});
