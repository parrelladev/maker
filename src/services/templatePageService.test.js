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
    access: jest.fn(() => Promise.resolve()),
    stat: jest.fn((target) => {
      if (Object.hasOwn(directories, target)) {
        return Promise.resolve({ isDirectory: () => true });
      }
      return Promise.reject(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    }),
    readdir: jest.fn((target) => Promise.resolve(directories[target] || [])),
    readFile: jest.fn((target) => Promise.resolve(files[target])),
  };
  const loadManifestFn = jest.fn().mockResolvedValue({
    manifest,
    templateDir,
    pageDir,
    htmlPath,
  });
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
    deps.fileSystem.stat.mockResolvedValue({ isDirectory: () => true });
    deps.fileSystem.readdir.mockImplementation((target) =>
      Promise.resolve(target === sharedCssDir
        ? ['ignored.txt', 'second.css', 'first.css']
        : ['page.css', 'index.html'])
    );
    deps.fileSystem.readFile.mockImplementation((target) => Promise.resolve(({
      [deps.htmlPath]: '<main>fixture</main>',
      [secondSharedCssPath]: '.second {}',
      [firstSharedCssPath]: '.first {}',
      [pageCssPath]: '.page {}',
    })[target]));
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

  test('trata falha inicial de acesso ao diretório CSS como CSS ausente', async () => {
    const manifest = { name: 'Fixture' };
    const html = '<main>fixture</main>';
    const deps = createDependencies({
      manifest,
      files: { [path.join('templates', 'fixture', 'index', 'index.html')]: html },
    });
    const accessError = Object.assign(new Error('permission denied'), {
      code: 'EACCES',
    });
    deps.fileSystem.access.mockRejectedValue(accessError);
    const { loadTemplatePage } = createTemplatePageService(deps);

    await expect(loadTemplatePage('fixture', 'index')).resolves.toEqual({
      template: 'fixture',
      page: 'index',
      manifest,
      html,
      css: [],
      resolvedLogo: null,
    });
    expect(deps.fileSystem.access).toHaveBeenCalledTimes(2);
    expect(deps.fileSystem.stat).not.toHaveBeenCalled();
    expect(deps.fileSystem.readdir).not.toHaveBeenCalled();
  });

  test('propaga falha de readdir após a verificação inicial do diretório CSS', async () => {
    const deps = createDependencies({
      files: { [path.join('templates', 'fixture', 'index', 'index.html')]: '<main />' },
    });
    const readdirError = Object.assign(new Error('directory unavailable'), {
      code: 'EACCES',
    });
    deps.fileSystem.stat.mockResolvedValue({ isDirectory: () => true });
    deps.fileSystem.readdir.mockRejectedValue(readdirError);
    const { loadTemplatePage } = createTemplatePageService(deps);

    await expect(loadTemplatePage('fixture', 'index')).rejects.toBe(readdirError);
  });

  test('propaga falha de readFile durante a leitura de um CSS listado', async () => {
    const deps = createDependencies();
    const sharedCssDir = path.join(deps.templateDir, 'css');
    const cssPath = path.join(sharedCssDir, 'shared.css');
    const readError = Object.assign(new Error('stylesheet disappeared'), {
      code: 'ENOENT',
    });
    deps.fileSystem.stat.mockResolvedValue({ isDirectory: () => true });
    deps.fileSystem.readdir.mockResolvedValue(['shared.css']);
    deps.fileSystem.readFile.mockImplementation((target) => {
      if (target === deps.htmlPath) {
        return Promise.resolve('<main />');
      }
      if (target === cssPath) {
        return Promise.reject(readError);
      }
      return Promise.resolve('');
    });
    const { loadTemplatePage } = createTemplatePageService(deps);

    await expect(loadTemplatePage('fixture', 'index')).rejects.toBe(readError);
  });

  test('classifica falha de leitura do HTML obrigatório', async () => {
    const deps = createDependencies();
    const readError = Object.assign(new Error('permission denied'), {
      code: 'EACCES',
    });
    deps.fileSystem.readFile.mockRejectedValue(readError);
    const { loadTemplatePage } = createTemplatePageService(deps);

    await expect(loadTemplatePage('fixture', 'index')).rejects.toMatchObject({
      name: 'TemplateRequiredFileUnreadableError',
      code: 'TEMPLATE_FILE_UNREADABLE',
      cause: readError,
    });
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

  test('propaga falha de resolução de logo remota com categoria própria', async () => {
    const logoError = new Error('timeout remoto');
    const deps = createDependencies({
      manifest: { defaultLogo: 'https://cdn.example/logo.svg' },
      logoError,
      files: { [path.join('templates', 'fixture', 'index', 'index.html')]: '<main />' },
    });
    const { loadTemplatePage } = createTemplatePageService(deps);

    await expect(loadTemplatePage('fixture', 'index')).rejects.toMatchObject({
      name: 'TemplateRemoteAssetError',
      code: 'TEMPLATE_REMOTE_ASSET_FAILED',
      cause: logoError,
    });
    expect(deps.logger.warn).not.toHaveBeenCalled();
  });

  test('propaga erros de carregamento do manifest para a camada HTTP', async () => {
    const deps = createDependencies();
    const manifestError = new SyntaxError('manifest inválido');
    deps.loadManifestFn.mockRejectedValue(manifestError);
    const { loadTemplatePage } = createTemplatePageService(deps);

    await expect(loadTemplatePage('fixture', 'index')).rejects.toBe(manifestError);
    expect(deps.fileSystem.readFile).not.toHaveBeenCalled();
  });
});
