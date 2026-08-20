const path = require('path');
const {
  getEditorialMetadata,
  normalizeManifest,
  validateManifest,
} = require('./templateManifest');

function editorialManifest(overrides = {}) {
  return {
    editor: {
      brand: 'agazeta', family: 'padrao', variant: 'foto-acima', label: 'Foto acima',
    },
    formats: { story: { dimensions: { width: 1080, height: 1920 } } },
    ...overrides,
  };
}

describe('templateManifest', () => {
  test('aceita e normaliza manifest legado com dimensions', () => {
    const manifest = { dimensions: { width: 1080, height: 1920 } };
    expect(validateManifest(manifest)).toBe(manifest);
    expect(normalizeManifest(manifest)).toEqual({ ...manifest, editorial: null });
    expect(getEditorialMetadata(manifest)).toBeNull();
  });

  test('aceita manifest editorial e expõe representação normalizada', () => {
    expect(getEditorialMetadata(editorialManifest())).toEqual({
      editorial: editorialManifest().editor,
      formats: editorialManifest().formats,
      themes: [],
    });
  });

  test.each(['brand', 'family', 'variant', 'label'])('rejeita editor.%s vazio', (field) => {
    const manifest = editorialManifest({
      editor: { ...editorialManifest().editor, [field]: '  ' },
    });
    expect(() => validateManifest(manifest)).toThrow(`editor.${field}`);
  });

  test('rejeita formats vazio', () => {
    expect(() => validateManifest(editorialManifest({ formats: {} }))).toThrow('formats');
  });

  test.each([
    ['width zero', { width: 0, height: 100 }],
    ['height negativa', { width: 100, height: -1 }],
    ['width não numérica', { width: '1080', height: 100 }],
    ['height não numérica', { width: 100, height: '1920' }],
  ])('rejeita dimensions inválidas: %s', (_, dimensions) => {
    const manifest = editorialManifest({ formats: { story: { dimensions } } });
    expect(() => validateManifest(manifest)).toThrow('número inteiro positivo');
  });

  test('aceita themes com ids únicos e labels', () => {
    const themes = [{ id: 'preto', label: 'Preto' }, { id: 'branco', label: 'Branco' }];
    expect(validateManifest(editorialManifest({ themes }))).toBeDefined();
  });

  test('rejeita theme id vazio', () => {
    expect(() => validateManifest(editorialManifest({
      themes: [{ id: '', label: 'Sem ID' }],
    }))).toThrow('themes[0].id');
  });

  test('rejeita theme id duplicado', () => {
    expect(() => validateManifest(editorialManifest({
      themes: [{ id: 'preto', label: 'Preto' }, { id: 'preto', label: 'Outro' }],
    }))).toThrow('theme id duplicado');
  });

  test.each([
    ['foto-acima', 'story'],
    ['quote-card', 'square'],
    ['qualquer-variante-futura', 'banner'],
  ])('aceita variant %s e format arbitrário %s', (variant, formatId) => {
    const manifest = editorialManifest({
      editor: { ...editorialManifest().editor, variant },
      formats: { [formatId]: { dimensions: { width: 800, height: 800 } } },
    });
    expect(() => validateManifest(manifest)).not.toThrow();
  });

  test('formats prevalece sobre dimensions legado na normalização', () => {
    const normalized = normalizeManifest(editorialManifest({ dimensions: { width: 1, height: 1 } }));
    expect(normalized.dimensions).toEqual({ width: 1080, height: 1920 });
  });

  test('não escolhe implicitamente dimensions quando há múltiplos formatos', () => {
    const normalized = normalizeManifest(editorialManifest({
      dimensions: { width: 1, height: 1 },
      formats: {
        story: { dimensions: { width: 1080, height: 1920 } },
        square: { dimensions: { width: 1080, height: 1080 } },
      },
    }));
    expect(normalized).not.toHaveProperty('dimensions');
  });

  test('metadados editoriais não copiam identidade e assets da marca', () => {
    const metadata = getEditorialMetadata(editorialManifest({
      defaultLogo: 'logo-a-gazeta.svg', fonts: ['Maga'],
    }));
    expect(metadata.editorial).toEqual(editorialManifest().editor);
    expect(metadata.editorial).not.toHaveProperty('defaultLogo');
    expect(metadata.editorial).not.toHaveProperty('fonts');
  });

  test('primeiro manifest real convertido obedece ao contrato', () => {
    const manifest = require(path.resolve('templates/agazeta-foto-acima/index/manifest.json'));
    const normalized = normalizeManifest(manifest);
    expect(normalized.editorial).toMatchObject({
      brand: 'agazeta', family: 'padrao', variant: 'foto-acima',
    });
    expect(normalized.formats.story.dimensions).toEqual({ width: 1080, height: 1920 });
    expect(normalized.dimensions).toEqual(normalized.formats.story.dimensions);
    expect(normalized.brandAssets).toEqual({
      logo: 'primary',
      fonts: [
        { alias: 'headline.black', family: 'Maga Black', weight: 900, style: 'normal' },
        { alias: 'body.italic', family: 'Montserrat', weight: 400, style: 'italic' },
      ],
    });
    expect(normalized).not.toHaveProperty('defaultLogo');
  });

  test('segundo manifest real convertido declara a variante foto-abaixo', () => {
    const manifest = require(path.resolve('templates/agazeta-foto-abaixo/index/manifest.json'));
    const normalized = normalizeManifest(manifest);

    expect(normalized.editorial).toEqual({
      brand: 'agazeta', family: 'padrao', variant: 'foto-abaixo', label: 'Foto abaixo',
    });
    expect(normalized.formats).toEqual({
      story: { dimensions: { width: 1080, height: 1920 } },
    });
    expect(normalized.themes).toEqual([
      { id: 'azul', label: 'Azul' },
      { id: 'branco', label: 'Branco' },
      { id: 'preto', label: 'Preto' },
    ]);
    expect(normalized.brandAssets).toEqual({
      logo: 'primary',
      fonts: [
        { alias: 'headline.black', family: 'Maga Black', weight: 900, style: 'normal' },
        { alias: 'body.italic', family: 'Montserrat', weight: 400, style: 'italic' },
      ],
    });
    expect(normalized).not.toHaveProperty('defaultLogo');
  });

  test('rejeita contrato incompleto de assets de marca', () => {
    expect(() => validateManifest(editorialManifest({
      brandAssets: { logo: 'primary', fonts: [{ alias: 'headline.black' }] },
    }))).toThrow('brandAssets.fonts[0].family');
  });
});
