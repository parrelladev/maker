const path = require('path');
const {
  buildEditorCatalog,
  resolveRenderer,
} = require('./editorCatalog');

function manifest({
  brand = 'brand-a',
  family = 'padrao',
  variant = 'foto-acima',
  label = 'Foto acima',
  format = 'story',
  width = 1080,
  height = 1920,
  themes = [{ id: 'azul', label: 'Azul' }],
} = {}) {
  return {
    editor: { brand, family, variant, label },
    formats: { [format]: { dimensions: { width, height } } },
    themes,
  };
}

function page(template, name, pageManifest) {
  return { template, pages: [{ name, manifest: pageManifest }] };
}

function discovery(templates) {
  return async () => ({ templates, diagnostics: [] });
}

function brandLoader(brands = {
  'brand-a': 'Brand A',
  'brand-b': 'Brand B',
  thirdbrand: 'Third Brand',
}) {
  return async id => {
    if (!brands[id]) {
      const error = new Error(`Brand not found: ${id}`);
      error.code = 'BRAND_NOT_FOUND';
      throw error;
    }
    return { id, name: brands[id], logos: {}, fonts: {} };
  };
}

async function build(templates, options = {}) {
  return buildEditorCatalog({
    inspectTemplateCatalogFn: discovery(templates),
    loadBrandFn: brandLoader(),
    ...options,
  });
}

function getVariant(catalog, brand = 'brand-a', family = 'padrao', variant = 'foto-acima') {
  return catalog.brands.find(item => item.id === brand)
    ?.families.find(item => item.id === family)
    ?.variants.find(item => item.id === variant);
}

describe('editorCatalog', () => {
  test('propaga capabilities no catÃ¡logo e no resolve sem expor paths', async () => {
    const input = manifest();
    input.formats.story.capabilities = { imageAdjustments: { zoom: true, position: true } };
    const catalog = await build([page('renderer-a', 'story-page', input)]);
    const format = getVariant(catalog).formats[0];
    expect(format.capabilities).toEqual({ imageAdjustments: { zoom: true, position: true } });
    expect(format).not.toHaveProperty('template');
    expect(resolveRenderer(catalog, {
      brand: 'brand-a', family: 'padrao', variant: 'foto-acima', format: 'story',
    }).capabilities).toEqual({ imageAdjustments: { zoom: true, position: true } });
  });
  test('constrói catálogo vazio sem manifests editoriais', async () => {
    await expect(build([])).resolves.toEqual({ brands: [] });
  });

  test('ignora manifests legados sem inferir identidade pelo path', async () => {
    const catalog = await build([page('brand-a', 'foto-acima', {
      dimensions: { width: 1080, height: 1920 },
    })]);
    expect(catalog).toEqual({ brands: [] });
  });

  test('usa getEditorialMetadata como fronteira canônica', async () => {
    const unsafeManifest = new Proxy({}, {
      get(_target, property) {
        if (property === 'editor' || property === 'editorial') {
          throw new Error('acesso editorial direto');
        }
        return undefined;
      },
    });
    const getEditorialMetadataFn = jest.fn(() => ({
      editorial: { brand: 'brand-a', family: 'padrao', variant: 'foto-acima', label: 'Foto acima' },
      formats: { story: { dimensions: { width: 1080, height: 1920 } } },
      themes: [],
    }));
    const catalog = await build([page('renderer', 'page', unsafeManifest)], {
      getEditorialMetadataFn,
    });
    expect(getEditorialMetadataFn).toHaveBeenCalledWith(unsafeManifest);
    expect(getVariant(catalog).formats).toHaveLength(1);
  });

  test('deriva marca, nome, family, variant, formato, dimensões e temas', async () => {
    const catalog = await build([page('renderer-a', 'story', manifest({
      themes: [
        { id: 'preto', label: 'Preto' },
        { id: 'azul', label: 'Azul' },
      ],
    }))]);
    expect(catalog).toEqual({
      brands: [{
        id: 'brand-a',
        name: 'Brand A',
        families: [{
          id: 'padrao',
          label: 'padrao',
          variants: [{
            id: 'foto-acima',
            label: 'Foto acima',
            formats: [{
              id: 'story',
              dimensions: { width: 1080, height: 1920 },
              themes: [
                { id: 'preto', label: 'Preto' },
                { id: 'azul', label: 'Azul' },
              ],
            }],
          }],
        }],
      }],
    });
  });

  test('agrega dois formatos de renderers distintos na mesma variant', async () => {
    const catalog = await build([
      page('renderer-a', 'story', manifest()),
      page('renderer-b', 'feed', manifest({ format: 'feed', width: 1080, height: 1350 })),
    ]);
    expect(getVariant(catalog).formats.map(format => format.id)).toEqual(['feed', 'story']);
    expect(getVariant(catalog).id).toBe('foto-acima');
  });

  test('mantém variants, families e families homônimas de marcas distintas separadas', async () => {
    const catalog = await build([
      page('one', 'a', manifest()),
      page('two', 'b', manifest({ variant: 'texto', label: 'Texto' })),
      page('three', 'c', manifest({ family: 'especial' })),
      page('four', 'd', manifest({ brand: 'brand-b' })),
    ]);
    expect(getVariant(catalog)).toBeDefined();
    expect(getVariant(catalog, 'brand-a', 'padrao', 'texto')).toBeDefined();
    expect(getVariant(catalog, 'brand-a', 'especial')).toBeDefined();
    expect(getVariant(catalog, 'brand-b', 'padrao')).toBeDefined();
  });

  test('aceita combinação extensível thirdbrand/especial/quote-card/square/green', async () => {
    const catalog = await build([page('quote-renderer', 'index', manifest({
      brand: 'thirdbrand',
      family: 'especial',
      variant: 'quote-card',
      label: 'Quote card',
      format: 'square',
      width: 900,
      height: 900,
      themes: [{ id: 'green', label: 'Green' }],
    }))]);
    expect(getVariant(catalog, 'thirdbrand', 'especial', 'quote-card').formats).toEqual([{
      id: 'square',
      dimensions: { width: 900, height: 900 },
      themes: [{ id: 'green', label: 'Green' }],
    }]);
  });

  test('resolve renderer sem usar tema e devolve uma cópia da referência', async () => {
    const catalog = await build([page('renderer-a', 'story-page', manifest())]);
    const selection = { brand: 'brand-a', family: 'padrao', variant: 'foto-acima', format: 'story' };
    const first = resolveRenderer(catalog, selection);
    expect(first).toEqual({
      template: 'renderer-a',
      page: 'story-page',
      dimensions: { width: 1080, height: 1920 },
      themes: [
        { id: 'azul', label: 'Azul' },
      ],
    });
    first.template = 'alterado';
    first.dimensions.width = 1;
    expect(resolveRenderer(catalog, selection)).toEqual({
      template: 'renderer-a',
      page: 'story-page',
      dimensions: { width: 1080, height: 1920 },
      themes: [
        { id: 'azul', label: 'Azul' },
      ],
    });
  });

  test('rejeita resolução inexistente sem fallback', async () => {
    const catalog = await build([page('renderer-a', 'story', manifest())]);
    expect(() => resolveRenderer(catalog, {
      brand: 'brand-a', family: 'padrao', variant: 'foto-acima', format: 'banner',
    })).toThrow(expect.objectContaining({ code: 'EDITOR_CATALOG_RENDERER_NOT_FOUND' }));
  });

  test('rejeita marca desconhecida com diagnóstico de configuração', async () => {
    await expect(build([page('renderer', 'page', manifest({ brand: 'missing' }))]))
      .rejects.toMatchObject({
        code: 'EDITOR_CATALOG_UNKNOWN_BRAND',
        details: { brand: 'missing', reference: { template: 'renderer', page: 'page' } },
      });
  });

  test('detecta labels divergentes para a mesma variant', async () => {
    await expect(build([
      page('renderer-a', 'story', manifest()),
      page('renderer-b', 'feed', manifest({ format: 'feed', label: 'Imagem acima' })),
    ])).rejects.toMatchObject({
      code: 'EDITOR_CATALOG_VARIANT_LABEL_CONFLICT',
      details: { labels: ['Foto acima', 'Imagem acima'] },
    });
  });

  test('detecta renderers diferentes para a mesma combinação', async () => {
    await expect(build([
      page('renderer-b', 'page-b', manifest()),
      page('renderer-a', 'page-a', manifest()),
    ])).rejects.toMatchObject({
      code: 'EDITOR_CATALOG_RENDERER_CONFLICT',
      details: {
        brand: 'brand-a', family: 'padrao', variant: 'foto-acima', format: 'story',
        references: [
          { template: 'renderer-a', page: 'page-a' },
          { template: 'renderer-b', page: 'page-b' },
        ],
      },
    });
  });

  test('ordem de descoberta não altera o catálogo público', async () => {
    const entries = [
      page('z', 'b', manifest({ brand: 'brand-b', variant: 'zeta', label: 'Zeta' })),
      page('a', 'a', manifest({ themes: [{ id: 'z', label: 'Z' }, { id: 'a', label: 'A' }] })),
      page('m', 'c', manifest({ family: 'especial', format: 'banner' })),
    ];
    expect(await build(entries)).toEqual(await build([...entries].reverse()));
  });

  test('catálogo público serializado não expõe paths nem referência técnica', async () => {
    const catalog = await build([page('renderer-a', 'story', manifest())]);
    const serialized = JSON.stringify(catalog);
    expect(serialized).not.toContain('renderer-a');
    expect(serialized).not.toContain(path.resolve('.'));
    expect(serialized).not.toContain('rendererRef');
  });

  test('constrói o primeiro catálogo editorial real', async () => {
    const catalog = await buildEditorCatalog();
    const variant = getVariant(catalog, 'agazeta', 'padrao', 'foto-acima');
    expect(catalog.brands.find(brand => brand.id === 'agazeta').name).toBe('A Gazeta');
    expect(variant.formats.find(format => format.id === 'story')).toMatchObject({
      dimensions: { width: 1080, height: 1920 },
      themes: [
        { id: 'azul', label: 'Azul' },
        { id: 'branco', label: 'Branco' },
        { id: 'preto', label: 'Preto' },
      ],
    });
  });
});
