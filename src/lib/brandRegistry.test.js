const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const {
  createBrandRegistry,
  loadBrand: loadDefaultBrand,
  resolveBrandFont: resolveDefaultBrandFont,
  resolveBrandLogo: resolveDefaultBrandLogo
} = require('./brandRegistry');

const fixtureRoot = path.resolve('test/fixtures/brand-registry/brands');

describe('brandRegistry', () => {
  const registry = createBrandRegistry({ brandRoot: fixtureRoot });

  test('lista marcas validas em ordem e sem expor paths', async () => {
    const logger = { warn: jest.fn() };
    const brands = await registry.listBrands({ logger });

    expect(brands).toEqual([
      { id: 'fixture-brand-a', name: 'Fixture Brand A' },
      { id: 'fixture-brand-b', name: 'Fixture Brand B' }
    ]);
    expect(JSON.stringify(brands)).not.toContain(path.resolve('.'));
  });

  test('carrega marca valida com id, name e aliases relativos', async () => {
    await expect(registry.loadBrand('fixture-brand-a')).resolves.toEqual({
      id: 'fixture-brand-a',
      name: 'Fixture Brand A',
      logos: { primary: 'logos/primary.svg' },
      fonts: { headline: { bold: 'fonts/headline-bold.woff2' } }
    });
  });

  test('resolve logo valida dentro da pasta da marca', async () => {
    const logoPath = await registry.resolveBrandLogo('fixture-brand-a', 'primary');

    expect(logoPath).toBe(path.join(fixtureRoot, 'fixture-brand-a', 'logos', 'primary.svg'));
  });

  test('resolve alias aninhado de fonte dentro da pasta da marca', async () => {
    const fontPath = await registry.resolveBrandFont('fixture-brand-a', 'headline.bold');

    expect(fontPath).toBe(path.join(fixtureRoot, 'fixture-brand-a', 'fonts', 'headline-bold.woff2'));
  });

  test('gera erro explicito para alias de logo inexistente', async () => {
    await expect(registry.resolveBrandLogo('fixture-brand-a', 'compact')).rejects.toMatchObject({
      code: 'BRAND_LOGO_NOT_FOUND'
    });
  });

  test.each(['headline.regular', 'body.bold'])('gera erro explicito para fonte inexistente: %s', async alias => {
    await expect(registry.resolveBrandFont('fixture-brand-a', alias)).rejects.toMatchObject({
      code: 'BRAND_FONT_NOT_FOUND'
    });
  });

  test.each(['headline', 'headline.bold.extra', '', null])('gera erro explicito para alias de fonte invalido: %p', async alias => {
    await expect(registry.resolveBrandFont('fixture-brand-a', alias)).rejects.toMatchObject({
      code: 'BRAND_FONT_ALIAS_INVALID'
    });
  });

  test('gera erro previsivel para marca inexistente', async () => {
    await expect(registry.loadBrand('missing-brand')).rejects.toMatchObject({
      code: 'BRAND_NOT_FOUND'
    });
  });

  test.each([
    '../fixture-brand-a',
    '..\\fixture-brand-a',
    'fixture/brand',
    'fixture\\brand',
    '.',
    '..',
    '',
    'brand\0id',
    'C:\\brand'
  ])('rejeita brandId inseguro antes de carregar o manifest: %p', async brandId => {
    await expect(registry.loadBrand(brandId)).rejects.toMatchObject({
      code: 'BRAND_ID_INVALID'
    });
  });

  test('rejeita path de logo que escapa da pasta da marca', async () => {
    await expect(registry.loadBrand('escaping-logo')).rejects.toMatchObject({
      code: 'BRAND_ASSET_PATH_INVALID'
    });
    await expect(registry.resolveBrandLogo('escaping-logo', 'primary')).rejects.toMatchObject({
      code: 'BRAND_ASSET_PATH_INVALID'
    });
  });

  test('rejeita path de fonte que escapa da pasta da marca', async () => {
    await expect(registry.loadBrand('escaping-font')).rejects.toMatchObject({
      code: 'BRAND_ASSET_PATH_INVALID'
    });
    await expect(registry.resolveBrandFont('escaping-font', 'headline.bold')).rejects.toMatchObject({
      code: 'BRAND_ASSET_PATH_INVALID'
    });
  });

  test('manifest malformado nao entra silenciosamente na listagem', async () => {
    const logger = { warn: jest.fn() };
    const brands = await registry.listBrands({ logger });

    expect(brands).not.toContainEqual(expect.objectContaining({ id: 'malformed' }));
    expect(logger.warn).toHaveBeenCalledWith(
      '[brands] brand ignored during listing',
      { brandId: 'malformed', code: 'BRAND_MANIFEST_INVALID' }
    );
  });

  test('marcas carregadas nao compartilham estado mutavel', async () => {
    const first = await registry.loadBrand('fixture-brand-a');
    const firstReloaded = await registry.loadBrand('fixture-brand-a');
    const second = await registry.loadBrand('fixture-brand-b');

    expect(first).not.toBe(second);
    expect(first.logos).not.toBe(second.logos);
    expect(first.fonts).not.toBe(second.fonts);
    expect(first.fonts.headline).not.toBe(firstReloaded.fonts.headline);

    first.logos.primary = 'changed.svg';
    first.fonts.headline.bold = 'changed.woff2';
    expect(firstReloaded.logos.primary).toBe('logos/primary.svg');
    expect(firstReloaded.fonts.headline.bold).toBe('fonts/headline-bold.woff2');
    expect(second.logos.symbol).toBe('logos/symbol.svg');
    expect(second.fonts.body.regular).toBe('fonts/body-regular.woff2');
  });

  test('adiciona segunda marca sem alterar a implementacao do registry', async () => {
    await expect(registry.loadBrand('fixture-brand-b')).resolves.toMatchObject({
      id: 'fixture-brand-b',
      logos: { symbol: 'logos/symbol.svg' },
      fonts: { body: { regular: 'fonts/body-regular.woff2' } }
    });
    await expect(registry.resolveBrandLogo('fixture-brand-b', 'symbol')).resolves
      .toBe(path.join(fixtureRoot, 'fixture-brand-b', 'logos', 'symbol.svg'));
  });

  test('registry padrao carrega e resolve os assets reais de A Gazeta', async () => {
    await expect(loadDefaultBrand('agazeta')).resolves.toMatchObject({
      id: 'agazeta',
      name: 'A Gazeta',
      logos: { primary: 'logos/primary.svg' },
      fonts: {
        headline: { black: 'fonts/headline-black.woff2' },
        body: { italic: 'fonts/body-italic.woff2' }
      }
    });
    await expect(resolveDefaultBrandLogo('agazeta', 'primary')).resolves
      .toBe(path.resolve('brands/agazeta/logos/primary.svg'));
    await expect(resolveDefaultBrandFont('agazeta', 'headline.black')).resolves
      .toBe(path.resolve('brands/agazeta/fonts/headline-black.woff2'));
  });

  test('registry padrao lista HZ e resolve seus assets sem cruzar aliases com A Gazeta', async () => {
    const { listBrands } = require('./brandRegistry');

    await expect(listBrands()).resolves.toEqual([
      { id: 'agazeta', name: 'A Gazeta' },
      { id: 'hz', name: 'HZ' }
    ]);
    await expect(loadDefaultBrand('hz')).resolves.toEqual({
      id: 'hz',
      name: 'HZ',
      logos: { primary: 'logos/primary.png' },
      fonts: {
        headline: { black: 'fonts/headline-black.woff2' },
        body: { italic: 'fonts/body-italic.woff2' }
      }
    });

    const [hzLogo, hzHeadline, hzBody, agazetaLogo, agazetaHeadline] = await Promise.all([
      resolveDefaultBrandLogo('hz', 'primary'),
      resolveDefaultBrandFont('hz', 'headline.black'),
      resolveDefaultBrandFont('hz', 'body.italic'),
      resolveDefaultBrandLogo('agazeta', 'primary'),
      resolveDefaultBrandFont('agazeta', 'headline.black')
    ]);

    expect(hzLogo).toBe(path.resolve('brands/hz/logos/primary.png'));
    expect(hzHeadline).toBe(path.resolve('brands/hz/fonts/headline-black.woff2'));
    expect(hzBody).toBe(path.resolve('brands/hz/fonts/body-italic.woff2'));
    expect(hzLogo).not.toBe(agazetaLogo);
    expect(hzHeadline).not.toBe(agazetaHeadline);
    await expect(resolveDefaultBrandLogo('hz', 'secondary')).rejects.toMatchObject({
      code: 'BRAND_LOGO_NOT_FOUND'
    });
  });

  test('assets HZ preservam o PNG e os bytes das fontes comprovados no renderer legado', async () => {
    const digest = async filePath => crypto
      .createHash('sha256')
      .update(await fs.readFile(path.resolve(filePath)))
      .digest('hex');
    const logo = await fs.readFile(path.resolve('brands/hz/logos/primary.png'));

    expect(logo.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(logo.readUInt32BE(16)).toBe(2697);
    expect(logo.readUInt32BE(20)).toBe(1080);
    await expect(digest('brands/hz/fonts/headline-black.woff2'))
      .resolves.toBe(await digest('templates/layout-hz/fonts/Maga-Black.woff2'));
    await expect(digest('brands/hz/fonts/body-italic.woff2'))
      .resolves.toBe(await digest('templates/layout-hz/fonts/Montserrat-Italic.woff2'));
  });
});
