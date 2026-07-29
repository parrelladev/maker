const path = require('path');
const { createTemplatePageService } = require('./templatePageService');

function createDependencies({
  manifest = {},
  logoAsset = null,
  logoError = null,
  directories = {},
  files = {},
} = {}) {
  const templateDir = path.join('templates', 'fixture');
  const pageDir = path.join(templateDir, 'index');
  const htmlPath = path.join(pageDir, 'index.html');
  const fileSystem = {
    existsSync: jest.fn((target) => Object.hasOwn(directories, target)),
    statSync: jest.fn(() => ({ isDirectory: () => true })),
    readdirSync: jest.fn((target) => directories[target] || []),
    readFileSync: jest.fn((target) => files[target]),
  };
  const loadManifestFn = jest.fn(() => ({
    manifest,
    templateDir,
    pageDir,
    htmlPath,
  }));
  const resolveLogoAssetFn = logoError
    ? jest.fn().mockRejectedValue(logoError)
    : jest.fn().mockResolvedValue(logoAsset);
  const logger = { warn: jest.fn() };

  return {
    fileSystem,
    loadManifestFn,
    resolveLogoAssetFn,
    logger,
    templateDir,
    pageDir,
    htmlPath,
  };
}

describe('templatePageService', () => {
  test('monta o modelo preservando HTML, manifest e ordem dos grupos de CSS', async () => {
    const manifest = {
      defaultLogo: 'fixture.svg',
      logoAlt: 'Logo fixture',
      dimensions: { width: 100, height: 200 },
    };
    const deps = createDependencies({ manifest });
    const sharedCssDir = path.join(deps.templateDir, 'css');
    const secondSharedCssPath = path.join(sharedCssDir, 'second.css');
    const firstSharedCssPath = path.join(sharedCssDir, 'first.css');
    const pageCssPath = path.join(deps.pageDir, 'page.css');
    deps.fileSystem.existsSync.mockImplementation(
      (target) => target === sharedCssDir || target === deps.pageDir
    );
    deps.fileSystem.readdirSync.mockImplementation((target) =>
      target === sharedCssDir
        ? ['ignored.txt', 'second.css', 'first.css']
        : ['page.css', 'index.html']
    );
    deps.fileSystem.readFileSync.mockImplementation((target) => ({
      [deps.htmlPath]: '<main>fixture</main>',
      [secondSharedCssPath]: '.second {}',
      [firstSharedCssPath]: '.first {}',
      [pageCssPath]: '.page {}',
    })[target]);
    deps.resolveLogoAssetFn.mockResolvedValue({
      kind: 'inline-svg',
      markup: '<svg></svg>',
    });
    const { loadTemplatePage } = createTemplatePageService(deps);

    await expect(loadTemplatePage('fixture', 'index')).resolves.toEqual({
      template: 'fixture',
      page: 'index',
      manifest,
      html: '<main>fixture</main>',
      css: [
        { name: path.join('css', 'second.css'), content: '.second {}' },
        { name: path.join('css', 'first.css'), content: '.first {}' },
        { name: path.join('index', 'page.css'), content: '.page {}' },
      ],
      resolvedLogo: {
        kind: 'inline-svg',
        markup: '<svg></svg>',
      },
    });
    expect(deps.loadManifestFn).toHaveBeenCalledWith('fixture', 'index');
    expect(deps.resolveLogoAssetFn).toHaveBeenCalledWith(
      'fixture.svg',
      'Logo fixture'
    );
  });

  test.each([
    [
      'logo.png',
      { kind: 'image', src: path.join('input', 'logo.png') },
      '/input/logo.png',
    ],
    [
      'https://cdn.example/logo.png',
      { kind: 'image', src: 'https://cdn.example/logo.png' },
      'https://cdn.example/logo.png',
    ],
  ])('preserva o formato de logo de imagem para %s', async (defaultLogo, logoAsset, src) => {
    const deps = createDependencies({
      manifest: { defaultLogo },
      logoAsset,
      files: { [path.join('templates', 'fixture', 'index', 'index.html')]: '<main />' },
    });
    const { loadTemplatePage } = createTemplatePageService(deps);

    await expect(loadTemplatePage('fixture', 'index')).resolves.toMatchObject({
      resolvedLogo: { kind: 'image', src },
    });
  });

  test('retorna CSS vazio e não resolve logo quando o manifest não define defaultLogo', async () => {
    const deps = createDependencies({
      files: { [path.join('templates', 'fixture', 'index', 'index.html')]: '<main />' },
    });
    const { loadTemplatePage } = createTemplatePageService(deps);

    await expect(loadTemplatePage('fixture', 'index')).resolves.toMatchObject({
      manifest: {},
      css: [],
      resolvedLogo: null,
    });
    expect(deps.resolveLogoAssetFn).not.toHaveBeenCalled();
  });

  test('mantém resposta sem logo e registra falha de resolução', async () => {
    const logoError = new Error('logo indisponível');
    logoError.code = 'LOGO_ERROR';
    const deps = createDependencies({
      manifest: { defaultLogo: 'missing.svg' },
      logoError,
      files: { [path.join('templates', 'fixture', 'index', 'index.html')]: '<main />' },
    });
    const { loadTemplatePage } = createTemplatePageService(deps);

    await expect(loadTemplatePage('fixture', 'index')).resolves.toMatchObject({
      resolvedLogo: null,
    });
    expect(deps.logger.warn).toHaveBeenCalledWith(
      '[templates] falha ao resolver logo',
      {
        template: 'fixture',
        page: 'index',
        code: 'LOGO_ERROR',
      },
      logoError
    );
  });

  test('propaga erros de carregamento do manifest para a camada HTTP', async () => {
    const deps = createDependencies();
    const manifestError = new SyntaxError('manifest inválido');
    deps.loadManifestFn.mockImplementation(() => {
      throw manifestError;
    });
    const { loadTemplatePage } = createTemplatePageService(deps);

    await expect(loadTemplatePage('fixture', 'index')).rejects.toBe(manifestError);
    expect(deps.fileSystem.readFileSync).not.toHaveBeenCalled();
  });
});
