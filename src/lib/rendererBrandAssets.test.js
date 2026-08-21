const path = require('path');
const { createRendererBrandAssetResolver } = require('./rendererBrandAssets');

function createResolver(overrides = {}) {
  const logoPath = path.resolve('brands/agazeta/logos/primary.svg');
  const fontPaths = {
    'headline.black': path.resolve('brands/agazeta/fonts/headline-black.woff2'),
    'body.italic': path.resolve('brands/agazeta/fonts/body-italic.woff2'),
  };
  const fileSystem = {
    readFile: jest.fn(async (assetPath) => assetPath === logoPath
      ? '<svg viewBox="0 0 1 1"></svg>'
      : Buffer.from(`font:${assetPath}`)),
  };
  const dependencies = {
    fileSystem,
    resolveBrandLogoFn: jest.fn().mockResolvedValue(logoPath),
    resolveBrandFontFn: jest.fn(async (_brand, alias) => fontPaths[alias]),
    sanitizeSvgFn: jest.fn(markup => markup),
    ...overrides,
  };
  return { ...createRendererBrandAssetResolver(dependencies), dependencies };
}

describe('rendererBrandAssets', () => {
  const brandAssets = {
    logo: 'primary',
    fonts: [
      { alias: 'headline.black', family: 'Maga Black', weight: 900, style: 'normal' },
      { alias: 'body.italic', family: 'Montserrat', weight: 400, style: 'italic' },
    ],
  };

  test('resolve aliases de logo e fontes sem publicar paths absolutos', async () => {
    const { resolveRendererBrandAssets, dependencies } = createResolver();
    const result = await resolveRendererBrandAssets({ brandId: 'agazeta', brandAssets });

    expect(dependencies.resolveBrandLogoFn).toHaveBeenCalledWith('agazeta', 'primary');
    expect(dependencies.resolveBrandFontFn).toHaveBeenCalledWith('agazeta', 'headline.black');
    expect(dependencies.resolveBrandFontFn).toHaveBeenCalledWith('agazeta', 'body.italic');
    expect(result.resolvedLogo).toEqual({
      kind: 'inline-svg', markup: '<svg viewBox="0 0 1 1"></svg>',
    });
    expect(result.fontCss).toContain('font-family: "Maga Black"');
    expect(result.fontCss).toContain('font-family: "Montserrat"');
    expect(result.fontCss).toContain('data:font/woff2;base64,');
    expect(JSON.stringify(result)).not.toContain(path.resolve('.'));
  });

  test.each([
    ['logo', { resolveBrandLogoFn: jest.fn().mockRejectedValue(Object.assign(new Error(), { code: 'BRAND_LOGO_NOT_FOUND' })) }],
    ['fonte', { resolveBrandFontFn: jest.fn().mockRejectedValue(Object.assign(new Error(), { code: 'BRAND_FONT_NOT_FOUND' })) }],
  ])('propaga alias inexistente de %s explicitamente', async (_kind, overrides) => {
    const { resolveRendererBrandAssets } = createResolver(overrides);
    await expect(resolveRendererBrandAssets({ brandId: 'agazeta', brandAssets }))
      .rejects.toMatchObject({ code: expect.stringMatching(/^BRAND_(LOGO|FONT)_NOT_FOUND$/) });
  });

  test('resolve PNG confinado pelo registry como imagem sem sanitizacao SVG', async () => {
    const logoPath = path.resolve('brands/hz/logos/primary.png');
    const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('fixture')]);
    const { resolveRendererBrandAssets, dependencies } = createResolver({
      resolveBrandLogoFn: jest.fn().mockResolvedValue(logoPath),
      fileSystem: { readFile: jest.fn().mockResolvedValue(png) },
    });
    const result = await resolveRendererBrandAssets({
      brandId: 'hz', brandAssets: { logo: 'primary', fonts: [] },
    });
    expect(result.resolvedLogo).toEqual({
      kind: 'image', src: `data:image/png;base64,${png.toString('base64')}`,
    });
    expect(dependencies.sanitizeSvgFn).not.toHaveBeenCalled();
  });

  test.each([
    ['assinatura invalida', Buffer.from('not-png'), '.png'],
    ['extensao nao suportada', Buffer.from('image'), '.jpg'],
  ])('rejeita logo de imagem com %s', async (_label, data, extension) => {
    const { resolveRendererBrandAssets } = createResolver({
      resolveBrandLogoFn: jest.fn().mockResolvedValue(
        path.resolve(`brands/hz/logos/primary${extension}`)
      ),
      fileSystem: { readFile: jest.fn().mockResolvedValue(data) },
    });
    await expect(resolveRendererBrandAssets({
      brandId: 'hz', brandAssets: { logo: 'primary', fonts: [] },
    })).rejects.toMatchObject({ code: expect.stringMatching(/^RENDERER_BRAND_LOGO_/) });
  });
});
