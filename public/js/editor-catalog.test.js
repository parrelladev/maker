const Catalog = require('./editor-catalog');

const catalog = {
  brands: [{
    id: 'brand-x', name: 'Brand X', families: [
      { id: 'empty', label: 'empty', variants: [{ id: 'feed-only', label: 'Feed', formats: [{ id: 'feed', themes: [] }] }] },
      { id: 'family-y', label: 'family-y', variants: [
        { id: 'variant-a', label: 'Variant A', formats: [{ id: 'story', themes: [{ id: 'green', label: 'Green' }, { id: 'dark', label: 'Dark' }] }] },
        { id: 'variant-z', label: 'Variant Z', formats: [{ id: 'story', themes: [{ id: 'blue', label: 'Blue' }] }] },
      ] },
    ],
  }, { id: 'brand-feed', name: 'Feed only', families: [{ id: 'f', variants: [] }] }],
};

describe('helpers do catálogo editorial no frontend', () => {
  test('escolhe genericamente a primeira configuração Story válida', () => {
    const selection = Catalog.chooseDefault(catalog, 'story');
    expect([selection.brand.id, selection.family.id, selection.variant.id, selection.theme.id])
      .toEqual(['brand-x', 'family-y', 'variant-a', 'green']);
  });

  test('filtra variantes por metadata de formato e devolve seus temas', () => {
    const family = Catalog.findFamily(Catalog.findBrand(catalog, 'brand-x'), 'family-y');
    expect(Catalog.getVariants(family, 'story').map(item => item.id)).toEqual(['variant-a', 'variant-z']);
    expect(Catalog.getFormat(family.variants[0], 'story').themes.map(item => item.id)).toEqual(['green', 'dark']);
  });

  test('trocas de brand/family nunca inventam fallback incompatível', () => {
    expect(Catalog.chooseForBrand(catalog, 'brand-feed', 'story')).toBeNull();
    expect(Catalog.chooseForFamily(catalog, 'brand-x', 'empty', 'story')).toBeNull();
    expect(Catalog.chooseForFamily(catalog, 'brand-x', 'family-y', 'story').variant.id).toBe('variant-a');
  });

  test('catálogo vazio não produz seleção', () => {
    expect(Catalog.chooseDefault({ brands: [] }, 'story')).toBeNull();
  });
});
