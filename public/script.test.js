const fs = require('fs');
const path = require('path');
const vm = require('vm');

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...values) {
    values.forEach(value => this.values.add(value));
  }

  remove(...values) {
    values.forEach(value => this.values.delete(value));
  }

  contains(value) {
    return this.values.has(value);
  }
}

class FakeElement {
  constructor(id = '') {
    this.id = id;
    this.value = '';
    this.innerHTML = '';
    this.textContent = '';
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.classList = new FakeClassList();
    this.listeners = {};
    this.clientWidth = 540;
    this.focus = jest.fn();
  }

  addEventListener(type, listener) {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type].push(listener);
  }

  dispatch(type, overrides = {}) {
    const event = {
      type,
      target: this,
      key: undefined,
      ...overrides
    };
    (this.listeners[type] || []).forEach(listener => listener(event));
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  remove() {}

  closest(selector) {
    if (selector === '#storyTemplateGrid') {
      return this.id === 'storyTemplateGrid' ? this : null;
    }
    if (selector === '[data-group]') {
      return this.dataset.group ? this : null;
    }
    return null;
  }
}

function createHarness() {
  jest.useFakeTimers();

  const ids = [
    'templateModal',
    'closeModal',
    'cancelBtn',
    'generateBtn',
    'loadingOverlay',
    'toastContainer',
    'newsUrl',
    'customTitle',
    'customSubtitle',
    'customImageUrl',
    'themeWrapper',
    'customTheme',
    'customTag',
    'modalTitle',
    'storyCategoryTabs',
    'storyTemplateGrid',
    'fetchDataBtn',
    'previewFrame',
    'previewPlaceholder'
  ];
  const elements = Object.fromEntries(ids.map(id => [id, new FakeElement(id)]));
  const frameDocument = {
    open: jest.fn(),
    write: jest.fn(),
    close: jest.fn()
  };
  elements.previewFrame.contentDocument = frameDocument;
  elements.previewFrame.contentWindow = { document: frameDocument };

  const documentListeners = {};
  const document = {
    getElementById: id => elements[id] || null,
    querySelector: selector => (
      selector === '.preview-frame-wrapper'
        ? new FakeElement('preview-frame-wrapper')
        : null
    ),
    createElement: () => new FakeElement(),
    addEventListener(type, listener) {
      documentListeners[type] = documentListeners[type] || [];
      documentListeners[type].push(listener);
    }
  };

  const extractNewsData = jest.fn();
  const loadManifest = jest.fn().mockResolvedValue({
    template: 'agazeta-foto-abaixo',
    page: 'index',
    manifest: {},
    css: [],
    html: ''
  });
  const windowListeners = {};
  const context = {
    console,
    document,
    URL,
    setTimeout,
    clearTimeout,
    Api: { extractNewsData, loadManifest, embedImage: jest.fn() },
    PreviewExport: { downloadPreview: jest.fn() },
    addEventListener(type, listener) {
      windowListeners[type] = windowListeners[type] || [];
      windowListeners[type].push(listener);
    }
  };
  context.window = context;
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');
  const utilsSource = fs.readFileSync(
    path.join(__dirname, 'js', 'frontend-utils.js'),
    'utf8'
  );
  vm.runInContext(utilsSource, context, {
    filename: 'public/js/frontend-utils.js'
  });
  vm.runInContext(source, context, { filename: 'public/script.js' });
  (documentListeners.DOMContentLoaded || []).forEach(listener => listener());

  function run(expression) {
    return vm.runInContext(expression, context);
  }

  function state() {
    return JSON.parse(run(`JSON.stringify({
      currentTemplate,
      currentTemplateMeta: currentTemplateMeta && {
        id: currentTemplateMeta.id,
        name: currentTemplateMeta.name,
        group: currentTemplateMeta.group
      },
      currentTheme,
      activeStoryGroup,
      lastNewsUrl,
      lastNewsData,
      currentManifestData,
      previewInitializedTemplate
    })`));
  }

  return {
    context,
    elements,
    extractNewsData,
    frameDocument,
    loadManifest,
    run,
    state
  };
}

describe('contrato de estado de public/script.js', () => {
  test('lê um snapshot normalizado dos dados atuais do formulário de geração', () => {
    const harness = createHarness();
    harness.run(`openModal('layout-hz')`);
    harness.elements.newsUrl.value = '  https://example.com/noticia  ';
    harness.elements.customTitle.value = '  Título manual  ';
    harness.elements.customSubtitle.value = '  Subtítulo manual  ';
    harness.elements.customTag.value = '  Categoria manual  ';
    harness.elements.customImageUrl.value = '  imagem-manual  ';

    const result = harness.run('readGenerationFormData()');

    expect(result).toEqual({
      newsUrl: 'https://example.com/noticia',
      manualTitle: 'Título manual',
      manualSubtitle: 'Subtítulo manual',
      manualCategory: 'Categoria manual',
      manualImage: 'imagem-manual',
      resolvedImage: '',
      theme: 'rosa',
      template: 'layout-hz'
    });
  });

  test('abre o modal com template, metadados, tema padrão e preview reiniciado', () => {
    const harness = createHarness();

    harness.run(`openModal('agazeta-foto-abaixo')`);

    expect(harness.state()).toEqual({
      currentTemplate: 'agazeta-foto-abaixo',
      currentTemplateMeta: {
        id: 'agazeta-foto-abaixo',
        name: 'A Gazeta - Foto abaixo',
        group: 'Principais'
      },
      currentTheme: 'azul',
      activeStoryGroup: 'Principais',
      lastNewsUrl: null,
      lastNewsData: null,
      currentManifestData: null,
      previewInitializedTemplate: null
    });
    expect(harness.elements.templateModal.classList.contains('show')).toBe(true);
    expect(harness.elements.themeWrapper.style.display).toBe('');
    expect(harness.elements.newsUrl.focus).toHaveBeenCalled();
    expect(harness.frameDocument.write).toHaveBeenLastCalledWith(
      '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body></body></html>'
    );
  });

  test('fecha o modal e invalida seleção, tema, notícia e preview', () => {
    const harness = createHarness();
    harness.run(`openModal('layout-hz')`);
    harness.run(`lastNewsUrl = 'https://example.com/a'; lastNewsData = { h1: 'A' };
      currentManifestData = { manifest: { name: 'HZ' } };
      previewInitializedTemplate = currentTemplate;`);

    harness.run('closeModalHandler()');

    expect(harness.state()).toEqual({
      currentTemplate: null,
      currentTemplateMeta: null,
      currentTheme: null,
      activeStoryGroup: 'Principais',
      lastNewsUrl: null,
      lastNewsData: null,
      currentManifestData: null,
      previewInitializedTemplate: null
    });
    expect(harness.elements.templateModal.classList.contains('show')).toBe(false);
    expect(harness.elements.customTheme.innerHTML).toBe('');
    expect(harness.elements.themeWrapper.style.display).toBe('none');
  });

  test('troca de template substitui seleção e limpa notícia e preview anteriores', () => {
    const harness = createHarness();
    harness.run(`openModal('agazeta-foto-abaixo');
      lastNewsUrl = 'https://example.com/a';
      lastNewsData = { h1: 'A' };
      currentManifestData = { manifest: { name: 'A' } };
      previewInitializedTemplate = currentTemplate;
      openModal('rede-gazeta');`);

    expect(harness.state()).toEqual({
      currentTemplate: 'rede-gazeta',
      currentTemplateMeta: {
        id: 'rede-gazeta',
        name: 'Rede Gazeta',
        group: 'Especiais'
      },
      currentTheme: null,
      activeStoryGroup: 'Principais',
      lastNewsUrl: null,
      lastNewsData: null,
      currentManifestData: null,
      previewInitializedTemplate: null
    });
  });

  test('troca de tema preserva template, notícia, manifest e template do preview', () => {
    const harness = createHarness();
    harness.run(`openModal('agazeta-foto-abaixo');
      lastNewsUrl = 'https://example.com/a';
      lastNewsData = { h1: 'A' };
      currentManifestData = { manifest: { name: 'A' } };
      previewInitializedTemplate = currentTemplate;`);
    harness.elements.customTheme.value = 'preto';

    harness.elements.customTheme.dispatch('change');

    expect(harness.state()).toMatchObject({
      currentTemplate: 'agazeta-foto-abaixo',
      currentTheme: 'preto',
      lastNewsUrl: 'https://example.com/a',
      lastNewsData: { h1: 'A' },
      currentManifestData: { manifest: { name: 'A' } },
      previewInitializedTemplate: 'agazeta-foto-abaixo'
    });
    expect(harness.elements.modalTitle.textContent).toContain('(Preto)');
  });

  test('troca de grupo altera somente o filtro ativo do catálogo', () => {
    const harness = createHarness();
    harness.run(`openModal('agazeta-foto-abaixo')`);
    const tab = new FakeElement();
    tab.dataset.group = 'Especiais';

    harness.elements.storyCategoryTabs.dispatch('click', { target: tab });

    expect(harness.state()).toMatchObject({
      currentTemplate: 'agazeta-foto-abaixo',
      currentTheme: 'azul',
      activeStoryGroup: 'Especiais',
      lastNewsUrl: null,
      lastNewsData: null,
      currentManifestData: null,
      previewInitializedTemplate: null
    });
  });

  test('inicializa manifest e iframe uma vez e os reaproveita para o mesmo template', async () => {
    const harness = createHarness();
    const manifestData = {
      template: 'agazeta-foto-abaixo',
      page: 'index',
      manifest: { name: 'A Gazeta' },
      css: [],
      html: '<main></main>'
    };
    harness.loadManifest.mockResolvedValue(manifestData);
    harness.run(`openModal('agazeta-foto-abaixo')`);
    harness.frameDocument.write.mockClear();

    const first = await harness.run('ensurePreviewInitialized()');
    const reused = await harness.run('ensurePreviewInitialized()');

    expect(first).toEqual(manifestData);
    expect(reused).toEqual(manifestData);
    expect(harness.loadManifest).toHaveBeenCalledTimes(1);
    expect(harness.frameDocument.write).toHaveBeenCalledTimes(1);
    expect(harness.state()).toMatchObject({
      currentManifestData: manifestData,
      previewInitializedTemplate: 'agazeta-foto-abaixo'
    });
  });

  test('abertura limpa todos os campos editáveis', () => {
    const harness = createHarness();
    [
      'newsUrl',
      'customTitle',
      'customSubtitle',
      'customImageUrl',
      'customTag'
    ].forEach(id => {
      harness.elements[id].value = `valor-${id}`;
    });

    harness.run(`openModal('fonte-hub')`);

    expect([
      harness.elements.newsUrl.value,
      harness.elements.customTitle.value,
      harness.elements.customSubtitle.value,
      harness.elements.customImageUrl.value,
      harness.elements.customTag.value
    ]).toEqual(['', '', '', '', '']);
  });

  test('reaproveita notícia para a mesma URL e substitui o cache para URL diferente', async () => {
    const harness = createHarness();
    harness.extractNewsData
      .mockResolvedValueOnce({ h1: 'Primeira' })
      .mockResolvedValueOnce({ h1: 'Segunda' });

    const first = await harness.run(`getOrExtractNewsData('https://example.com/a')`);
    const reused = await harness.run(`getOrExtractNewsData('https://example.com/a')`);
    const replaced = await harness.run(`getOrExtractNewsData('https://example.com/b')`);

    expect(first).toEqual({ h1: 'Primeira' });
    expect(reused).toEqual({ h1: 'Primeira' });
    expect(replaced).toEqual({ h1: 'Segunda' });
    expect(harness.extractNewsData).toHaveBeenCalledTimes(2);
    expect(harness.state()).toMatchObject({
      lastNewsUrl: 'https://example.com/b',
      lastNewsData: { h1: 'Segunda' }
    });
  });

  test('resposta atrasada substitui o cache mesmo quando pertence à URL solicitada antes', async () => {
    const harness = createHarness();
    let resolveFirst;
    let resolveSecond;
    harness.extractNewsData
      .mockImplementationOnce(() => new Promise(resolve => {
        resolveFirst = resolve;
      }))
      .mockImplementationOnce(() => new Promise(resolve => {
        resolveSecond = resolve;
      }));

    const firstRequest = harness.run(`getOrExtractNewsData('https://example.com/a')`);
    const secondRequest = harness.run(`getOrExtractNewsData('https://example.com/b')`);

    resolveSecond({ h1: 'Segunda' });
    await secondRequest;
    resolveFirst({ h1: 'Primeira atrasada' });
    await firstRequest;

    expect(harness.state()).toMatchObject({
      lastNewsUrl: 'https://example.com/a',
      lastNewsData: { h1: 'Primeira atrasada' }
    });
  });

  test('reabrir após fechar começa uma sessão limpa com o novo template', () => {
    const harness = createHarness();
    harness.run(`openModal('layout-hz');
      lastNewsUrl = 'https://example.com/a';
      lastNewsData = { h1: 'A' };`);
    harness.elements.customTitle.value = 'Título anterior';

    harness.run(`closeModalHandler(); openModal('agazeta-foto-acima')`);

    expect(harness.state()).toMatchObject({
      currentTemplate: 'agazeta-foto-acima',
      currentTemplateMeta: {
        id: 'agazeta-foto-acima',
        name: 'A Gazeta - Foto acima',
        group: 'Principais'
      },
      currentTheme: 'azul',
      lastNewsUrl: null,
      lastNewsData: null,
      currentManifestData: null,
      previewInitializedTemplate: null
    });
    expect(harness.elements.customTitle.value).toBe('');
    expect(harness.elements.templateModal.classList.contains('show')).toBe(true);
  });
});

describe('precedência dos dados usados na arte', () => {
  function buildData(harness, manifestData = { manifest: {}, resolvedLogo: null }, override = null) {
    return harness.run(
      `buildPreviewData(${JSON.stringify(manifestData)}, ${JSON.stringify(override)})`
    );
  }

  function setMatchingExtractedData(harness) {
    harness.elements.newsUrl.value = 'https://example.com/noticia';
    harness.run(`
      lastNewsUrl = 'https://example.com/noticia';
      lastNewsData = {
        h1: 'Título extraído',
        h2: 'Subtítulo extraído',
        chapeu: 'Categoria extraída',
        bg: 'https://example.com/extraida.jpg'
      };
    `);
  }

  test('valores manuais vencem os valores extraídos', () => {
    const harness = createHarness();
    setMatchingExtractedData(harness);
    harness.elements.customTitle.value = 'Título manual';
    harness.elements.customSubtitle.value = 'Subtítulo manual';
    harness.elements.customTag.value = 'Categoria manual';
    harness.elements.customImageUrl.value = 'https://example.com/manual.jpg';

    expect(buildData(harness)).toMatchObject({
      h1: 'Título manual',
      h2: 'Subtítulo manual',
      tag: 'Categoria manual',
      chapeu: 'Categoria extraída',
      bg: 'https://example.com/manual.jpg',
      resolvedBg: 'https://example.com/manual.jpg'
    });
  });

  test('valores extraídos vencem os fallbacks vazios', () => {
    const harness = createHarness();
    setMatchingExtractedData(harness);

    expect(buildData(harness)).toMatchObject({
      h1: 'Título extraído',
      h2: 'Subtítulo extraído',
      tag: 'Categoria extraída',
      chapeu: 'Categoria extraída',
      bg: 'https://example.com/extraida.jpg',
      resolvedBg: 'https://example.com/extraida.jpg'
    });
  });

  test('ignora os dados da última notícia quando a URL atual não corresponde', () => {
    const harness = createHarness();
    harness.elements.newsUrl.value = 'https://example.com/atual';
    harness.run(`
      lastNewsUrl = 'https://example.com/anterior';
      lastNewsData = {
        h1: 'Título anterior',
        h2: 'Subtítulo anterior',
        chapeu: 'Categoria anterior',
        bg: 'https://example.com/anterior.jpg'
      };
    `);

    expect(buildData(harness)).toMatchObject({
      h1: '',
      h2: '',
      tag: '',
      chapeu: null,
      bg: '',
      resolvedBg: ''
    });
  });

  test('override da exportação vence a imagem manual e a extraída', () => {
    const harness = createHarness();
    setMatchingExtractedData(harness);
    harness.elements.customImageUrl.value = 'https://example.com/manual.jpg';

    expect(buildData(
      harness,
      { manifest: {}, resolvedLogo: null },
      'data:image/jpeg;base64,/9j/T1ZFUlJJREU='
    )).toMatchObject({
      bg: 'data:image/jpeg;base64,/9j/T1ZFUlJJREU=',
      resolvedBg: 'data:image/jpeg;base64,/9j/T1ZFUlJJREU='
    });
  });

  test.each([
    ['rosa', 'rosa', '../css/theme-rosa.css'],
    [null, null, null]
  ])(
    'incorpora o tema atual %s no payload',
    (currentThemeValue, expectedName, expectedStylesheet) => {
      const harness = createHarness();
      harness.run(`currentTheme = ${JSON.stringify(currentThemeValue)}`);

      expect(buildData(harness)).toMatchObject({
        themeName: expectedName,
        themeStylesheet: expectedStylesheet
      });
    }
  );

  test.each([
    [
      { kind: 'inline-svg', markup: '<svg><title>Logo resolvida</title></svg>' },
      { kind: 'inline-svg', markup: '<svg><title>Logo resolvida</title></svg>' }
    ],
    [
      { kind: 'image', src: '/input/logo-resolvida.png' },
      { kind: 'image', src: '/input/logo-resolvida.png' }
    ]
  ])('logo resolvida %j vence o fallback do manifest', (resolvedLogo, expected) => {
    const harness = createHarness();

    const result = buildData(harness, {
      manifest: {
        logoField: 'brand',
        defaultLogo: 'logo-fallback.svg'
      },
      resolvedLogo
    });

    expect(result).toMatchObject({
      brand: 'logo-fallback.svg',
      resolvedLogo: expected
    });
  });

  test.each([
    ['logo-local.svg', '/input/logo-local.svg'],
    ['https://cdn.example/logo.png', 'https://cdn.example/logo.png']
  ])(
    'usa o fallback atual para a logo não resolvida %s',
    (defaultLogo, expectedSrc) => {
      const harness = createHarness();

      expect(buildData(harness, {
        manifest: { defaultLogo },
        resolvedLogo: null
      })).toMatchObject({
        logo: defaultLogo,
        resolvedLogo: { kind: 'image', src: expectedSrc }
      });
    }
  );

  test('ausência de valores preserva todos os fallbacks atuais', () => {
    const harness = createHarness();

    expect(buildData(harness)).toEqual({
      h1: '',
      h2: '',
      tag: '',
      chapeu: null,
      bg: '',
      resolvedBg: '',
      themeName: null,
      themeStylesheet: null,
      logo: 'logo-a-gazeta',
      resolvedLogo: {
        kind: 'image',
        src: '/input/logo-a-gazeta'
      }
    });
  });
});

describe('validacoes atuais da geracao', () => {
  test.each([
    {
      name: 'template ausente',
      prepare: () => {},
      message: 'Escolha um template antes de gerar a arte',
      focusField: null
    },
    {
      name: 'URL da noticia ausente',
      prepare: harness => harness.run(`openModal('layout-hz')`),
      message: 'Por favor, insira o link da not\u00edcia',
      focusField: 'newsUrl'
    },
    {
      name: 'URL da noticia invalida',
      prepare: harness => {
        harness.run(`openModal('layout-hz')`);
        harness.elements.newsUrl.value = 'noticia invalida';
      },
      message: 'Por favor, insira um link v\u00e1lido',
      focusField: 'newsUrl'
    },
    {
      name: 'imagem manual invalida',
      prepare: harness => {
        harness.run(`openModal('layout-hz')`);
        harness.elements.newsUrl.value = 'https://example.com/noticia';
        harness.elements.customImageUrl.value = 'imagem invalida';
      },
      message: 'Informe um link de imagem v\u00e1lido (http ou https).',
      focusField: 'customImageUrl'
    }
  ])('bloqueia $name antes de iniciar efeitos assincronos', async ({
    prepare,
    message,
    focusField
  }) => {
    const harness = createHarness();
    prepare(harness);
    Object.values(harness.elements).forEach(element => element.focus.mockClear());

    await harness.run('generateArtWithPreviewFlow()');

    expect(harness.elements.toastContainer.children).toHaveLength(1);
    expect(harness.elements.toastContainer.children[0].innerHTML).toContain(message);
    expect(harness.loadManifest).not.toHaveBeenCalled();
    expect(harness.extractNewsData).not.toHaveBeenCalled();
    expect(harness.elements.loadingOverlay.classList.contains('show')).toBe(false);
    expect(harness.elements.generateBtn.disabled).not.toBe(true);
    if (focusField) {
      expect(harness.elements[focusField].focus).toHaveBeenCalledTimes(1);
    }
  });

  test.each([
    {
      name: 'categoria efetiva ausente',
      extractedData: { bg: 'data:image/png;base64,AA==' },
      message: 'Por favor, insira a categoria da not\u00edcia',
      focusField: 'customTag'
    },
    {
      name: 'imagem efetiva ausente',
      extractedData: { chapeu: 'Categoria extra\u00edda' },
      message: 'N\u00e3o encontramos uma imagem v\u00e1lida. Informe um link de imagem ou tente novamente.',
      focusField: 'customImageUrl'
    }
  ])('bloqueia $name apos a extracao e restaura o loading', async ({
    extractedData,
    message,
    focusField
  }) => {
    const harness = createHarness();
    harness.run(`openModal('layout-hz')`);
    harness.elements.newsUrl.value = 'https://example.com/noticia';
    harness.extractNewsData.mockResolvedValue(extractedData);

    await harness.run('generateArtWithPreviewFlow()');

    expect(harness.loadManifest).toHaveBeenCalledWith('layout-hz', 'index');
    expect(harness.extractNewsData).toHaveBeenCalledWith('https://example.com/noticia');
    expect(harness.elements.toastContainer.children).toHaveLength(1);
    expect(harness.elements.toastContainer.children[0].innerHTML).toContain(message);
    expect(harness.elements[focusField].focus).toHaveBeenCalledTimes(1);
    expect(harness.elements.loadingOverlay.classList.contains('show')).toBe(false);
    expect(harness.elements.generateBtn.disabled).toBe(false);
    expect(harness.context.PreviewExport.downloadPreview).not.toHaveBeenCalled();
  });

  test('preserva dados manuais no preview exportado durante uma geracao valida', async () => {
    const harness = createHarness();
    const updatePreview = jest.fn();
    harness.elements.previewFrame.contentWindow.__updatePreview = updatePreview;
    harness.run(`openModal('layout-hz')`);
    harness.elements.newsUrl.value = 'https://example.com/noticia';
    harness.elements.customTag.value = 'Categoria manual';
    harness.elements.customImageUrl.value = 'https://example.com/manual.jpg';
    harness.extractNewsData.mockResolvedValue({
      chapeu: 'Categoria extraida',
      bg: 'https://example.com/extraida.jpg'
    });
    harness.context.Api.embedImage.mockResolvedValue('data:image/png;base64,TUFOVUFM');

    await harness.run('generateArtWithPreviewFlow()');

    expect(harness.context.Api.embedImage)
      .toHaveBeenCalledWith('https://example.com/manual.jpg');
    expect(updatePreview).toHaveBeenCalledWith(expect.objectContaining({
      tag: 'Categoria manual',
      bg: 'data:image/png;base64,TUFOVUFM',
      resolvedBg: 'data:image/png;base64,TUFOVUFM'
    }));
    expect(harness.context.PreviewExport.downloadPreview).toHaveBeenCalledWith(
      harness.elements.previewFrame,
      expect.anything(),
      expect.any(String)
    );
    expect(harness.elements.loadingOverlay.classList.contains('show')).toBe(false);
    expect(harness.elements.generateBtn.disabled).toBe(false);
  });

  test('gera com data URL JPEG extraida e usa a mesma imagem no preview exportado', async () => {
    const harness = createHarness();
    const updatePreview = jest.fn();
    const embeddedImage = 'data:image/jpeg;base64,/9j/AA==';
    harness.elements.previewFrame.contentWindow.__updatePreview = updatePreview;
    harness.run(`openModal('agazeta-foto-abaixo')`);
    harness.elements.newsUrl.value = 'https://www.agazeta.com.br/noticia';
    harness.extractNewsData.mockResolvedValue({
      chapeu: 'Cotidiano',
      bg: embeddedImage
    });

    await harness.run('generateArtWithPreviewFlow()');

    expect(updatePreview).toHaveBeenCalledWith(expect.objectContaining({
      tag: 'Cotidiano',
      bg: embeddedImage,
      resolvedBg: embeddedImage
    }));
    expect(harness.context.Api.embedImage).not.toHaveBeenCalled();
    expect(harness.context.PreviewExport.downloadPreview).toHaveBeenCalledWith(
      harness.elements.previewFrame,
      expect.anything(),
      'agazeta-foto-abaixo-index.png'
    );
    expect(harness.elements.toastContainer.children).toHaveLength(1);
    expect(harness.elements.toastContainer.children[0].innerHTML)
      .not.toContain('Informe um link de imagem v\u00e1lido (http ou https).');
    expect(harness.elements.loadingOverlay.classList.contains('show')).toBe(false);
    expect(harness.elements.generateBtn.disabled).toBe(false);
  });

  test('gera depois que a busca preenche o campo de imagem com data URL JPEG extraida', async () => {
    const harness = createHarness();
    const updatePreview = jest.fn();
    const embeddedImage = 'data:image/jpeg;base64,/9j/AA==';
    harness.elements.previewFrame.contentWindow.__updatePreview = updatePreview;
    harness.run(`openModal('agazeta-foto-abaixo')`);
    harness.elements.newsUrl.value = 'https://www.agazeta.com.br/noticia';
    harness.extractNewsData.mockResolvedValue({
      chapeu: 'Cotidiano',
      bg: embeddedImage
    });

    await harness.run('handleFetchNewsAndPreview()');
    await harness.run('generateArtWithPreviewFlow()');

    expect(harness.elements.customImageUrl.value).toBe(embeddedImage);
    expect(harness.context.PreviewExport.downloadPreview).toHaveBeenCalled();
    expect(harness.elements.toastContainer.children.at(-1).innerHTML)
      .not.toContain('Informe um link de imagem v\u00e1lido (http ou https).');
    expect(harness.elements.loadingOverlay.classList.contains('show')).toBe(false);
    expect(harness.elements.generateBtn.disabled).toBe(false);
  });

  test('reutiliza a imagem extraida do cache em geracoes sucessivas', async () => {
    const harness = createHarness();
    const embeddedImage = 'data:image/jpeg;base64,/9j/AA==';
    harness.elements.previewFrame.contentWindow.__updatePreview = jest.fn();
    harness.run(`openModal('agazeta-foto-abaixo')`);
    harness.elements.newsUrl.value = 'https://www.agazeta.com.br/noticia';
    harness.extractNewsData.mockResolvedValue({
      chapeu: 'Cotidiano',
      bg: embeddedImage
    });

    await harness.run('handleFetchNewsAndPreview()');
    await harness.run('generateArtWithPreviewFlow()');
    await harness.run('generateArtWithPreviewFlow()');

    expect(harness.extractNewsData).toHaveBeenCalledTimes(1);
    expect(harness.context.Api.embedImage).not.toHaveBeenCalled();
    expect(harness.context.PreviewExport.downloadPreview).toHaveBeenCalledTimes(2);
  });

  test('editar data URL extraida invalida sua origem automatica e bloqueia a geracao', async () => {
    const harness = createHarness();
    harness.run(`openModal('agazeta-foto-abaixo')`);
    harness.elements.newsUrl.value = 'https://www.agazeta.com.br/noticia';
    harness.extractNewsData.mockResolvedValue({
      chapeu: 'Cotidiano',
      bg: 'data:image/jpeg;base64,/9j/AA=='
    });

    await harness.run('handleFetchNewsAndPreview()');
    harness.elements.customImageUrl.value = 'data:image/jpeg;base64,/9j/BB==';
    harness.elements.customImageUrl.dispatch('input');
    await harness.run('generateArtWithPreviewFlow()');

    expect(harness.elements.toastContainer.children.at(-1).innerHTML)
      .toContain('Informe um link de imagem v\u00e1lido (http ou https).');
    expect(harness.elements.customImageUrl.focus).toHaveBeenCalled();
    expect(harness.context.PreviewExport.downloadPreview).not.toHaveBeenCalled();
  });

  test('editar imagem extraida para HTTP usa o fluxo manual e valida o JPEG incorporado', async () => {
    const harness = createHarness();
    const embeddedManualImage = 'data:image/jpeg;base64,/9j/TUFOVUFM';
    const updatePreview = jest.fn();
    harness.elements.previewFrame.contentWindow.__updatePreview = updatePreview;
    harness.run(`openModal('agazeta-foto-abaixo')`);
    harness.elements.newsUrl.value = 'https://www.agazeta.com.br/noticia';
    harness.extractNewsData.mockResolvedValue({
      chapeu: 'Cotidiano',
      bg: 'data:image/jpeg;base64,/9j/AA=='
    });
    harness.context.Api.embedImage.mockResolvedValue(embeddedManualImage);

    await harness.run('handleFetchNewsAndPreview()');
    harness.elements.customImageUrl.value = 'https://example.com/manual.jpg';
    harness.elements.customImageUrl.dispatch('input');
    await harness.run('generateArtWithPreviewFlow()');

    expect(harness.context.Api.embedImage)
      .toHaveBeenCalledWith('https://example.com/manual.jpg');
    expect(updatePreview).toHaveBeenLastCalledWith(expect.objectContaining({
      bg: embeddedManualImage,
      resolvedBg: embeddedManualImage
    }));
    expect(harness.context.PreviewExport.downloadPreview).toHaveBeenCalled();
    expect(harness.elements.loadingOverlay.classList.contains('show')).toBe(false);
    expect(harness.elements.generateBtn.disabled).toBe(false);
  });

  test('fechar e abrir outro template elimina a origem automatica anterior', async () => {
    const harness = createHarness();
    const embeddedImage = 'data:image/jpeg;base64,/9j/AA==';
    harness.run(`openModal('agazeta-foto-abaixo')`);
    harness.elements.newsUrl.value = 'https://www.agazeta.com.br/noticia';
    harness.extractNewsData.mockResolvedValue({
      chapeu: 'Cotidiano',
      bg: embeddedImage
    });

    await harness.run('handleFetchNewsAndPreview()');
    harness.run(`closeModalHandler(); openModal('layout-hz')`);
    harness.elements.newsUrl.value = 'https://example.com/outra-noticia';
    harness.elements.customImageUrl.value = embeddedImage;
    await harness.run('generateArtWithPreviewFlow()');

    expect(harness.elements.toastContainer.children.at(-1).innerHTML)
      .toContain('Informe um link de imagem v\u00e1lido (http ou https).');
    expect(harness.context.PreviewExport.downloadPreview).not.toHaveBeenCalled();
  });

  test('alterar a URL da noticia limpa a imagem automatica associada ao cache anterior', async () => {
    const harness = createHarness();
    harness.run(`openModal('agazeta-foto-abaixo')`);
    harness.elements.newsUrl.value = 'https://www.agazeta.com.br/noticia';
    harness.extractNewsData.mockResolvedValue({
      chapeu: 'Cotidiano',
      bg: 'data:image/jpeg;base64,/9j/AA=='
    });

    await harness.run('handleFetchNewsAndPreview()');
    harness.elements.newsUrl.value = 'https://example.com/outra-noticia';
    harness.elements.newsUrl.dispatch('input');

    expect(harness.elements.customImageUrl.value).toBe('');
    expect(harness.run('readGenerationFormData()')).toMatchObject({
      newsUrl: 'https://example.com/outra-noticia',
      manualImage: '',
      resolvedImage: ''
    });
  });

  test('rejeita data URL JPEG digitada diretamente como imagem manual', async () => {
    const harness = createHarness();
    harness.run(`openModal('layout-hz')`);
    harness.elements.newsUrl.value = 'https://example.com/noticia';
    harness.elements.customImageUrl.value = 'data:image/jpeg;base64,/9j/AA==';

    await harness.run('generateArtWithPreviewFlow()');

    expect(harness.elements.toastContainer.children).toHaveLength(1);
    expect(harness.elements.toastContainer.children[0].innerHTML)
      .toContain('Informe um link de imagem v\u00e1lido (http ou https).');
    expect(harness.elements.customImageUrl.focus).toHaveBeenCalledTimes(1);
    expect(harness.loadManifest).not.toHaveBeenCalled();
    expect(harness.extractNewsData).not.toHaveBeenCalled();
    expect(harness.context.PreviewExport.downloadPreview).not.toHaveBeenCalled();
    expect(harness.elements.loadingOverlay.classList.contains('show')).toBe(false);
    expect(harness.elements.generateBtn.disabled).not.toBe(true);
  });
});

describe('contratos das transformações usadas por public/script.js', () => {
  test.each([
    ['http://example.com/noticia', true],
    ['https://example.com/noticia', true],
    ['não é uma URL', false]
  ])('valida a URL %s', (value, expected) => {
    const harness = createHarness();

    expect(harness.run(`isHttpUrl(${JSON.stringify(value)})`)).toBe(expected);
  });

  test.each([
    ['success', 'check-circle'],
    ['error', 'exclamation-circle'],
    ['warning', 'info-circle']
  ])('escolhe o ícone atual para toast %s', (type, icon) => {
    const harness = createHarness();

    harness.run(`showToast('Mensagem', ${JSON.stringify(type)})`);

    expect(harness.elements.toastContainer.children[0].innerHTML)
      .toContain(`fa-${icon}`);
  });

  test('remove espaços dos campos manuais e preserva sua precedência', () => {
    const harness = createHarness();
    harness.elements.newsUrl.value = '  https://example.com/noticia  ';
    harness.elements.customTitle.value = '  Título manual  ';
    harness.elements.customSubtitle.value = '   ';
    harness.elements.customTag.value = '  Categoria manual  ';
    harness.elements.customImageUrl.value = '  https://example.com/manual.jpg  ';
    harness.run(`
      lastNewsUrl = 'https://example.com/noticia';
      lastNewsData = {
        h1: 'Título extraído',
        h2: 'Subtítulo extraído',
        chapeu: 'Categoria extraída',
        bg: 'https://example.com/extraida.jpg'
      };
    `);

    const result = harness.run(`buildPreviewData({
      manifest: {},
      resolvedLogo: null
    })`);

    expect(result).toMatchObject({
      h1: 'Título manual',
      h2: 'Subtítulo extraído',
      tag: 'Categoria manual',
      bg: 'https://example.com/manual.jpg'
    });
  });
});
