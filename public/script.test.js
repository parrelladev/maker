const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

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
    this.clientHeight = 960;
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

class BindingElement extends FakeElement {
  constructor(tagName = 'div') {
    super();
    this.tagName = tagName.toUpperCase();
    this.attributes = {};
    this.src = '';
    this.style.setProperty = (name, value) => {
      this.style[name] = value;
    };
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }
}

function createHarness({ autoResolveRuntime = true } = {}) {
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
  elements.themeOptions = new FakeElement('themeOptions');
  const frameDocument = {
    open: jest.fn(),
    write: jest.fn(),
    close: jest.fn(() => {
      if (autoResolveRuntime) {
        elements.previewFrame.contentWindow.__resolvePreviewRuntimeReady?.();
      }
    })
  };
  elements.previewFrame.contentDocument = frameDocument;
  elements.previewFrame.contentWindow = { document: frameDocument };

  const previewWrapper = new FakeElement('preview-frame-wrapper');
  const previewContainer = new FakeElement('preview-container');
  const documentListeners = {};
  const document = {
    getElementById: id => elements[id] || null,
    querySelector: selector => {
      if (selector === '.preview-frame-wrapper') {
        return previewWrapper;
      }
      if (selector === '.preview-container') {
        return previewContainer;
      }
      if (selector === '[data-control="themes"]') {
        return elements.themeOptions;
      }
      return null;
    },
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
    console: {
      ...console,
      error: jest.fn()
    },
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
    previewContainer,
    previewWrapper,
    extractNewsData,
    frameDocument,
    loadManifest,
    run,
    state
  };
}

async function createBindingRuntimeHarness(
  manifest,
  targetsBySelector = {}
) {
  const parentHarness = createHarness({ autoResolveRuntime: false });
  parentHarness.loadManifest.mockResolvedValue({
    template: 'binding-fixture',
    page: 'index',
    manifest,
    css: [],
    html: ''
  });

  const documentElement = new BindingElement('html');
  documentElement.clientWidth = 1080;
  const body = new BindingElement('body');
  const head = new BindingElement('head');
  const frameDocument = parentHarness.frameDocument;
  Object.assign(frameDocument, {
    body,
    documentElement,
    head,
    createElement(tagName) {
      return new BindingElement(tagName);
    },
    querySelectorAll(selector) {
      return targetsBySelector[selector] || [];
    }
  });

  const context = {
    console: {
      ...console,
      error: jest.fn()
    },
    document: frameDocument,
    innerHeight: 1920,
    innerWidth: 1080,
    setTimeout,
    clearTimeout,
    addEventListener: jest.fn()
  };
  context.window = context;
  parentHarness.elements.previewFrame.contentDocument = frameDocument;
  parentHarness.elements.previewFrame.contentWindow = context;
  vm.createContext(context);

  const documentWritten = createDeferred();
  frameDocument.write.mockImplementation(html => {
    documentWritten.resolve(html);
  });
  const initialization = parentHarness.run(`
    currentTemplate = 'binding-fixture';
    ensurePreviewInitialized();
  `);
  const iframeHtml = await documentWritten.promise;
  const inlineScripts = Array.from(
    iframeHtml.matchAll(/<script>([\s\S]*?)<\/script>/g),
    match => match[1]
  );
  if (inlineScripts.length !== 1) {
    throw new Error('Bootstrap do runtime não encontrado no documento do iframe');
  }
  const runtimeSource = fs.readFileSync(
    path.join(__dirname, 'js', 'preview-runtime.js'),
    'utf8'
  );
  let runtimeScript = null;

  function runBootstrap() {
    vm.runInContext(inlineScripts[0], context, {
      filename: 'preview-runtime-bootstrap.js'
    });
    runtimeScript = head.children.at(-1);
    return runtimeScript;
  }

  function loadRuntime() {
    vm.runInContext(runtimeSource, context, {
      filename: 'public/js/preview-runtime.js'
    });
    runtimeScript.dispatch('load');
  }

  return {
    context,
    documentElement,
    failRuntimeInitialization() {
      context.PreviewRuntime = {
        initialize() {
          throw new Error('falha interna');
        },
        update: jest.fn(),
        applyScale: jest.fn(),
        handleResize: jest.fn()
      };
      runtimeScript.dispatch('load');
    },
    failRuntimeInvalidApi() {
      context.PreviewRuntime = {};
      runtimeScript.dispatch('load');
    },
    failRuntimeLoad() {
      runtimeScript.dispatch('error');
    },
    initialization,
    loadRuntime,
    parentHarness,
    runBootstrap,
    update(data) {
      context.__updatePreview(data);
    }
  };
}

async function createReadyBindingRuntimeHarness(
  manifest,
  targetsBySelector = {},
  { pendingUpdatesBeforeRuntime = [] } = {}
) {
  const harness = await createBindingRuntimeHarness(manifest, targetsBySelector);
  harness.runBootstrap();
  pendingUpdatesBeforeRuntime.forEach(data => {
    harness.update(data);
  });
  harness.loadRuntime();
  await harness.initialization;
  return harness;
}

describe('runtime de bindings carregado por public/script.js', () => {
  test('mantém readiness pendente até carregar, inicializar e drenar a fila', async () => {
    const target = new BindingElement();
    const runtime = await createBindingRuntimeHarness({
      bindings: [
        { selector: '#title', field: 'title' }
      ]
    }, {
      '#title': [target]
    });
    let ready = false;
    runtime.initialization.then(() => {
      ready = true;
    });

    runtime.runBootstrap();
    runtime.update({ title: 'Título pendente' });
    await Promise.resolve();

    expect(ready).toBe(false);
    expect(target.textContent).toBe('');

    runtime.loadRuntime();
    await runtime.initialization;

    expect(ready).toBe(true);
    expect(target.textContent).toBe('Título pendente');
    expect(runtime.context.__updatePreview)
      .toBe(runtime.context.PreviewRuntime.update);
  });

  test('rejeita readiness quando um payload enfileirado não pode ser aplicado', async () => {
    const runtime = await createBindingRuntimeHarness({
      bindings: [
        { selector: '[', field: 'title' }
      ]
    });
    runtime.parentHarness.frameDocument.querySelectorAll = () => {
      throw new Error('selector inválido');
    };

    runtime.runBootstrap();
    runtime.update({ title: 'Não aplicado' });
    runtime.loadRuntime();

    await expect(runtime.initialization)
      .rejects.toThrow('Falha ao inicializar o runtime do preview');
    expect(runtime.parentHarness.state()).toMatchObject({
      currentManifestData: null,
      previewInitializedTemplate: null
    });
  });

  test('permite retry depois de falha de binding durante readiness', async () => {
    const runtime = await createBindingRuntimeHarness({
      bindings: [{ selector: '[', field: 'title' }]
    });
    runtime.parentHarness.frameDocument.querySelectorAll = () => {
      throw new Error('selector inválido');
    };
    runtime.runBootstrap();
    runtime.update({ title: 'Não aplicado' });
    runtime.loadRuntime();
    await expect(runtime.initialization).rejects.toThrow();

    runtime.parentHarness.loadManifest.mockResolvedValue({
      template: 'binding-fixture',
      page: 'index',
      manifest: {},
      css: [],
      html: ''
    });
    runtime.parentHarness.frameDocument.querySelectorAll = () => [];
    const retryDocument = createDeferred();
    runtime.parentHarness.frameDocument.write.mockImplementation(html => {
      retryDocument.resolve(html);
    });

    const retry = runtime.parentHarness.run('ensurePreviewInitialized()');
    const retryHtml = await retryDocument.promise;
    const retryBootstrap = Array.from(
      retryHtml.matchAll(/<script>([\s\S]*?)<\/script>/g),
      match => match[1]
    )[0];
    vm.runInContext(retryBootstrap, runtime.context, {
      filename: 'preview-runtime-retry-bootstrap.js'
    });
    runtime.context.document.head.children.at(-1).dispatch('load');

    await expect(retry).resolves.toMatchObject({
      template: 'binding-fixture',
      page: 'index'
    });
    expect(runtime.parentHarness.state()).toMatchObject({
      currentManifestData: expect.any(Object),
      previewInitializedTemplate: 'binding-fixture'
    });
  });

  test.each([
    '</script>',
    '</script><script>window.__manifestInjection = true</script>'
  ])('escapa fechamento de script ao serializar o manifest: %s', async value => {
    const target = new BindingElement();
    const runtime = await createBindingRuntimeHarness({
      bindings: [{ selector: '#title', value }]
    }, {
      '#title': [target]
    });
    const iframeHtml = runtime.parentHarness.frameDocument.write.mock.calls[0][0];

    expect(iframeHtml).not.toContain(`"value":${JSON.stringify(value)}`);
    runtime.runBootstrap();
    runtime.loadRuntime();
    await runtime.initialization;
    runtime.update({});

    expect(target.textContent).toBe(value);
  });

  test.each([
    '<script>',
    '\u2028',
    '\u2029',
    'aspas: " e barra: \\'
  ])('mantém bootstrap sintaticamente válido com manifest contendo %s', async value => {
    const target = new BindingElement();
    const runtime = await createReadyBindingRuntimeHarness({
      bindings: [{ selector: '#title', value }]
    }, {
      '#title': [target]
    });

    runtime.update({});

    expect(target.textContent).toBe(value);
  });

  test.each([
    ['carregamento', runtime => runtime.failRuntimeLoad()],
    ['inicialização', runtime => runtime.failRuntimeInitialization()],
    ['contrato da API', runtime => runtime.failRuntimeInvalidApi()]
  ])('rejeita readiness quando falha %s do módulo', async (_, failRuntime) => {
    const runtime = await createBindingRuntimeHarness({});
    runtime.runBootstrap();
    const rejection = expect(runtime.initialization)
      .rejects.toThrow('Falha ao inicializar o runtime do preview');

    failRuntime(runtime);

    await rejection;
    expect(runtime.parentHarness.state()).toMatchObject({
      currentManifestData: null,
      previewInitializedTemplate: null
    });
  });

  test('expõe API explícita e mantém __updatePreview como contrato do iframe', async () => {
    const runtime = await createReadyBindingRuntimeHarness({});

    expect(runtime.context.PreviewRuntime).toEqual(expect.objectContaining({
      initialize: expect.any(Function),
      update: expect.any(Function),
      applyScale: expect.any(Function),
      handleResize: expect.any(Function)
    }));
    expect(runtime.context.__updatePreview)
      .toBe(runtime.context.PreviewRuntime.update);
  });

  test('aplica em ordem atualizações recebidas enquanto o módulo está carregando', async () => {
    const textTarget = new BindingElement();
    const classTarget = new BindingElement();

    await createReadyBindingRuntimeHarness({
      bindings: [
        { selector: '#title', field: 'title' }
      ],
      classes: [
        { selector: '#card', field: 'className' }
      ]
    }, {
      '#title': [textTarget],
      '#card': [classTarget]
    }, {
      pendingUpdatesBeforeRuntime: [
        { title: 'Primeira', className: 'first' },
        { title: 'Segunda', className: 'second' }
      ]
    });

    expect(textTarget.textContent).toBe('Segunda');
    expect(classTarget.classList.contains('first')).toBe(true);
    expect(classTarget.classList.contains('second')).toBe(true);
  });

  test('aplica texto, HTML e imagem, incluindo campo aninhado e múltiplos alvos', async () => {
    const textTargets = [new BindingElement(), new BindingElement()];
    const htmlTarget = new BindingElement();
    const imageTarget = new BindingElement('img');
    const runtime = await createReadyBindingRuntimeHarness({
      bindings: [
        { selector: '.title', type: 'text', field: 'article.title' },
        { selector: '#summary', type: 'html', field: 'summary' },
        { selector: '#photo', type: 'image', field: 'image' }
      ]
    }, {
      '.title': textTargets,
      '#summary': [htmlTarget],
      '#photo': [imageTarget]
    });

    runtime.update({
      article: { title: 'Título aninhado' },
      summary: '<strong>Resumo</strong>',
      image: 'https://example.com/photo.jpg'
    });

    expect(textTargets.map(element => element.textContent))
      .toEqual(['Título aninhado', 'Título aninhado']);
    expect(htmlTarget.innerHTML).toBe('<strong>Resumo</strong>');
    expect(imageTarget.src).toBe('https://example.com/photo.jpg');
  });

  test('aplica logo como SVG inline, src de img e background', async () => {
    const inlineTarget = new BindingElement();
    const imageTarget = new BindingElement('img');
    const backgroundTarget = new BindingElement();
    const runtime = await createReadyBindingRuntimeHarness({
      bindings: [
        { selector: '#inline-logo', type: 'logo', field: 'inlineLogo' },
        { selector: '#image-logo', type: 'logo', field: 'imageLogo' },
        { selector: '#background-logo', type: 'logo', field: 'backgroundLogo' }
      ]
    }, {
      '#inline-logo': [inlineTarget],
      '#image-logo': [imageTarget],
      '#background-logo': [backgroundTarget]
    });

    runtime.update({
      inlineLogo: {
        kind: 'inline-svg',
        markup: '<svg viewBox="0 0 1 1"><path /></svg>'
      },
      imageLogo: { src: '/input/image-logo.png' },
      backgroundLogo: { src: '/input/background-logo.png' }
    });

    expect(inlineTarget.innerHTML)
      .toBe('<svg viewBox="0 0 1 1"><path /></svg>');
    expect(imageTarget.src).toBe('/input/image-logo.png');
    expect(backgroundTarget.style.backgroundImage)
      .toBe('url(/input/background-logo.png)');
  });

  test('aplica variável CSS, classes, atributos e valor fixo do manifest', async () => {
    const cssTarget = new BindingElement();
    const classTarget = new BindingElement();
    const attributeTarget = new BindingElement();
    const fixedTarget = new BindingElement();
    const runtime = await createReadyBindingRuntimeHarness({
      bindings: [
        {
          selector: '#fixed',
          type: 'text',
          field: 'ignored',
          value: 'Valor fixo'
        }
      ],
      cssVars: [
        { selector: '#card', name: '--accent', field: 'theme.accent' },
        { name: '--root-gap', value: 12 }
      ],
      classes: [
        { selector: '#card-class', field: 'theme.classes' }
      ],
      attributes: [
        { selector: '#link', name: 'aria-label', field: 'label' }
      ]
    }, {
      '#card': [cssTarget],
      '#card-class': [classTarget],
      '#link': [attributeTarget],
      '#fixed': [fixedTarget]
    });

    runtime.update({
      ignored: 'Valor dos dados',
      theme: {
        accent: '#ff00aa',
        classes: 'featured compact'
      },
      label: 'Abrir notícia'
    });

    expect(cssTarget.style['--accent']).toBe('#ff00aa');
    expect(runtime.documentElement.style['--root-gap']).toBe('12');
    expect(classTarget.classList.contains('featured')).toBe(true);
    expect(classTarget.classList.contains('compact')).toBe(true);
    expect(attributeTarget.attributes['aria-label']).toBe('Abrir notícia');
    expect(fixedTarget.textContent).toBe('Valor fixo');
  });

  test('ignora campo ausente e selector sem alvos', async () => {
    const existingTarget = new BindingElement();
    existingTarget.textContent = 'Texto anterior';
    const runtime = await createReadyBindingRuntimeHarness({
      bindings: [
        { selector: '#existing', field: 'missing' },
        { selector: '#not-found', value: 'Sem alvo' }
      ]
    }, {
      '#existing': [existingTarget]
    });

    runtime.update({});
    expect(runtime.context.console.error).not.toHaveBeenCalled();
    expect(existingTarget.textContent).toBe('Texto anterior');
  });

  test('aceita manifest sem arrays opcionais', async () => {
    const runtime = await createReadyBindingRuntimeHarness({});

    expect(() => runtime.update({ title: 'Sem bindings' })).not.toThrow();
    expect(runtime.context.console.error).not.toHaveBeenCalled();
  });

  test('executa atualização mais de uma vez sobre os mesmos alvos', async () => {
    const textTarget = new BindingElement();
    const classTarget = new BindingElement();
    const runtime = await createReadyBindingRuntimeHarness({
      bindings: [
        { selector: '#title', field: 'title' }
      ],
      classes: [
        { selector: '#card', field: 'className' }
      ]
    }, {
      '#title': [textTarget],
      '#card': [classTarget]
    });

    runtime.update({ title: 'Primeiro', className: 'first' });
    runtime.update({ title: 'Segundo', className: 'second' });

    expect(textTarget.textContent).toBe('Segundo');
    expect(classTarget.classList.contains('first')).toBe(true);
    expect(classTarget.classList.contains('second')).toBe(true);
  });

  test('registra resize e reaplica a escala com as dimensões do manifest', async () => {
    const runtime = await createReadyBindingRuntimeHarness({
      dimensions: {
        width: 540,
        height: 960
      }
    });
    const resizeListener = runtime.context.addEventListener.mock.calls
      .find(([eventName]) => eventName === 'resize')[1];

    expect(resizeListener).toBe(runtime.context.PreviewRuntime.handleResize);
    expect(runtime.context.addEventListener)
      .toHaveBeenCalledWith('load', runtime.context.PreviewRuntime.applyScale);

    runtime.context.innerWidth = 540;
    runtime.context.innerHeight = 960;
    runtime.context.PreviewRuntime.applyScale();
    expect(runtime.documentElement.style.transform).toBe('scale(1)');

    runtime.context.innerWidth = 270;
    runtime.context.innerHeight = 960;
    resizeListener();

    expect(runtime.documentElement.style.transform).toBe('scale(0.5)');
    expect(runtime.documentElement.style.transformOrigin).toBe('top left');
    expect(runtime.documentElement.style.width).toBe('540px');
    expect(runtime.documentElement.style.height).toBe('960px');
  });

  test('propaga falha de escala quando ela ocorre durante update', async () => {
    const runtime = await createReadyBindingRuntimeHarness({});
    Object.defineProperty(runtime.documentElement.style, 'transformOrigin', {
      configurable: true,
      set() {
        throw new Error('falha de escala');
      }
    });

    expect(() => runtime.update({})).toThrow('Falha ao aplicar escala de preview');
    expect(runtime.context.console.error).toHaveBeenCalled();
  });

  test('não registra listeners duplicados ao inicializar novamente', async () => {
    const runtime = await createReadyBindingRuntimeHarness({});
    const listenerCalls = runtime.context.addEventListener.mock.calls.length;

    runtime.context.PreviewRuntime.initialize({});

    expect(runtime.context.addEventListener).toHaveBeenCalledTimes(listenerCalls);
  });

  test('reutiliza preview pronto sem reinjetar documento ou listeners', async () => {
    const target = new BindingElement();
    const runtime = await createReadyBindingRuntimeHarness({
      bindings: [
        { selector: '#title', field: 'title' }
      ]
    }, {
      '#title': [target]
    });
    const writeCalls = runtime.parentHarness.frameDocument.write.mock.calls.length;
    const listenerCalls = runtime.context.addEventListener.mock.calls.length;

    const reused = await runtime.parentHarness.run('ensurePreviewInitialized()');
    runtime.update({ title: 'Preview reutilizado' });

    expect(reused.manifest.bindings).toHaveLength(1);
    expect(runtime.parentHarness.frameDocument.write).toHaveBeenCalledTimes(writeCalls);
    expect(runtime.context.addEventListener).toHaveBeenCalledTimes(listenerCalls);
    expect(target.textContent).toBe('Preview reutilizado');
  });
});

describe('readiness editorial e exportação legada', () => {
  test('content-sync compoe com editor-preview, news-import e export', () => {
    const harness = createHarness();
    harness.run(`
      window.LegacyEditorBridge.setContentSyncPending(true);
      window.LegacyEditorBridge.setEditorPreviewReady(false);
      window.LegacyEditorBridge.setNewsImportPending(true);
      showLoading();
      window.LegacyEditorBridge.setContentSyncPending(false);
      window.LegacyEditorBridge.setEditorPreviewReady(true);
      window.LegacyEditorBridge.setNewsImportPending(false);
    `);
    expect(harness.elements.generateBtn.disabled).toBe(true);
    harness.run('hideLoading()');
    expect(harness.elements.generateBtn.disabled).toBe(false);
  });

  test('guarda programatica impede export durante content-sync', async () => {
    const harness = createHarness();
    harness.run('window.LegacyEditorBridge.setContentSyncPending(true)');
    await harness.run('generateArtWithPreviewFlow()');
    expect(harness.context.PreviewExport.downloadPreview).not.toHaveBeenCalled();
    expect(harness.elements.toastContainer.children.at(-1).innerHTML)
      .toContain('Aguarde o preview ficar pronto para baixar');
  });

  test('bridge real usa publication content e nao inputs divergentes no payload', async () => {
    const harness = createHarness();
    harness.run(`openModal('agazeta-foto-abaixo')`);
    harness.elements.customTitle.value = 'Titulo DOM antigo';
    harness.elements.customSubtitle.value = 'Sub DOM antigo';
    harness.elements.customTag.value = 'Tag DOM antiga';
    harness.elements.customImageUrl.value = 'https://example.com/dom.jpg';
    harness.elements.previewFrame.contentWindow.__updatePreview = jest.fn();
    await harness.run(`window.LegacyEditorBridge.applyPublicationContent({ content: {
      url: 'https://example.com/b', title: 'Publication title',
      subtitle: 'Publication subtitle', tag: 'Publication tag',
      image: 'https://example.com/publication.jpg'
    } })`);
    expect(harness.elements.previewFrame.contentWindow.__updatePreview).toHaveBeenCalledTimes(1);
    expect(harness.elements.previewFrame.contentWindow.__updatePreview.mock.calls[0][0]).toMatchObject({
      h1: 'Publication title', h2: 'Publication subtitle', tag: 'Publication tag',
      bg: 'https://example.com/publication.jpg'
    });
  });

  test('URL nova invalida provenance extraida e remove a imagem antiga do payload', async () => {
    const harness = createHarness();
    harness.run(`openModal('agazeta-foto-abaixo')`);
    harness.elements.previewFrame.contentWindow.__updatePreview = jest.fn();
    await harness.run(`window.LegacyEditorBridge.applyPublicationContent({
      content: { url: 'https://example.com/a', title: 'A', subtitle: '', tag: '', image: 'data:image/jpeg;base64,QQ==' },
      importedImage: { url: 'https://example.com/a', value: 'data:image/jpeg;base64,QQ==' }
    })`);
    const reconciled = await harness.run(`window.LegacyEditorBridge.reconcilePublicationContent({
      changedField: 'url',
      content: { url: 'https://example.com/b', title: 'A', subtitle: '', tag: '', image: 'data:image/jpeg;base64,QQ==' }
    })`);
    expect(reconciled.image).toBe('');
    await harness.run(`window.LegacyEditorBridge.applyPublicationContent({ content: ${JSON.stringify(reconciled)} })`);
    expect(harness.elements.previewFrame.contentWindow.__updatePreview.mock.calls.at(-1)[0].bg).toBe('');
    expect(JSON.parse(harness.run('JSON.stringify(resolvedImageFieldState)'))).toEqual({ source: null, value: null, newsUrl: null });
  });

  test('titulo manual posterior chega ao payload real e nao restaura importado', async () => {
    const harness = createHarness();
    harness.run(`openModal('agazeta-foto-abaixo')`);
    harness.elements.previewFrame.contentWindow.__updatePreview = jest.fn();
    await harness.run(`window.LegacyEditorBridge.applyPublicationContent({ content: {
      url: 'https://example.com/a', title: 'Titulo importado', subtitle: '', tag: '', image: ''
    } })`);
    harness.elements.customTitle.value = 'Titulo DOM antigo';
    await harness.run(`window.LegacyEditorBridge.applyPublicationContent({ content: {
      url: 'https://example.com/a', title: 'Titulo manual', subtitle: '', tag: '', image: ''
    } })`);
    expect(harness.elements.previewFrame.contentWindow.__updatePreview.mock.calls.at(-1)[0].h1).toBe('Titulo manual');
  });
  test('news-import compoe com editor-preview e export', () => {
    const harness = createHarness();
    harness.run(`
      window.LegacyEditorBridge.setNewsImportPending(true);
      window.LegacyEditorBridge.setEditorPreviewReady(false);
      showLoading();
      window.LegacyEditorBridge.setNewsImportPending(false);
    `);
    expect(harness.elements.generateBtn.disabled).toBe(true);
    harness.run('window.LegacyEditorBridge.setEditorPreviewReady(true)');
    expect(harness.elements.generateBtn.disabled).toBe(true);
    harness.run('hideLoading()');
    expect(harness.elements.generateBtn.disabled).toBe(false);
  });

  test('ponte aplica provenance da imagem importada vinculada a URL exata', async () => {
    const harness = createHarness();
    await harness.run(`window.LegacyEditorBridge.applyPublicationContent({
      content: { url: 'https://example.com/a', image: 'data:image/jpeg;base64,QQ==' },
      importedImage: { url: 'https://example.com/a', value: 'data:image/jpeg;base64,QQ==' }
    })`);
    expect(JSON.parse(harness.run('JSON.stringify(resolvedImageFieldState)'))).toEqual({
      source: 'extracted', value: 'data:image/jpeg;base64,QQ==', newsUrl: 'https://example.com/a'
    });
  });
  test('guarda de profundidade impede download enquanto o preview editorial não está pronto', async () => {
    const harness = createHarness();
    harness.run('window.LegacyEditorBridge.setEditorPreviewReady(false)');

    await harness.run('generateArtWithPreviewFlow()');

    expect(harness.elements.generateBtn.disabled).toBe(true);
    expect(harness.context.PreviewExport.downloadPreview).not.toHaveBeenCalled();
    expect(harness.elements.toastContainer.children.at(-1).innerHTML)
      .toContain('Aguarde o preview ficar pronto para baixar');
  });

  test('razões independentes não reabilitam o botão enquanto outra operação o bloqueia', () => {
    const harness = createHarness();

    harness.run(`
      window.LegacyEditorBridge.setEditorPreviewReady(false);
      showLoading();
      window.LegacyEditorBridge.setEditorPreviewReady(true);
    `);
    expect(harness.elements.generateBtn.disabled).toBe(true);

    harness.run('hideLoading()');
    expect(harness.elements.generateBtn.disabled).toBe(false);

    harness.run(`
      showLoading();
      window.LegacyEditorBridge.setEditorPreviewReady(false);
      hideLoading();
    `);
    expect(harness.elements.generateBtn.disabled).toBe(true);

    harness.run('window.LegacyEditorBridge.setEditorPreviewReady(true)');
    expect(harness.elements.generateBtn.disabled).toBe(false);
  });
});

describe('contrato de estado de public/script.js', () => {
  test('reduz o preview pela altura disponível sem cortar a arte', () => {
    const harness = createHarness();
    harness.previewContainer.clientHeight = 400;

    harness.run('resizePreviewFrame()');

    expect(harness.previewWrapper.style.width).toBe('225px');
    expect(harness.previewWrapper.style.height).toBe('400px');
    expect(harness.elements.previewFrame.style.transform)
      .toBe('translate(-50%, -50%) scale(0.20833333333333334)');
  });

  test('inicialização oculta apenas o controle legado e preserva as opções visuais de tema', () => {
    const harness = createHarness();

    const themeOptions = harness.context.document.querySelector('[data-control="themes"]');

    expect(harness.elements.themeWrapper.style.display).toBe('none');
    expect(harness.elements.customTheme).toBeDefined();
    expect(themeOptions).toBe(harness.elements.themeOptions);
    expect(themeOptions.style.display).not.toBe('none');
  });

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

  test.each([
    { h1: 'Título parcial' },
    { h2: 'Subtítulo parcial' },
    { chapeu: 'Categoria parcial' },
    { bg: 'data:image/png;base64,QQ==' }
  ])('cacheia resultado parcial legítimo: %o', async partialData => {
    const harness = createHarness();
    harness.extractNewsData.mockResolvedValue(partialData);

    const first = await harness.run(`getOrExtractNewsData('https://example.com/a')`);
    const reused = await harness.run(`getOrExtractNewsData('https://example.com/a')`);

    expect(first).toEqual(partialData);
    expect(reused).toEqual(partialData);
    expect(harness.extractNewsData).toHaveBeenCalledTimes(1);
  });

  test('resultado vazio não substitui cache válido anterior', async () => {
    const harness = createHarness();
    harness.run(`
      lastNewsUrl = 'https://example.com/a';
      lastNewsData = { h1: 'Cache válido' };
    `);
    harness.extractNewsData.mockResolvedValue({});

    const result = await harness.run(
      `getOrExtractNewsData('https://example.com/b')`
    );

    expect(result).toEqual({});
    expect(harness.state()).toMatchObject({
      lastNewsUrl: 'https://example.com/a',
      lastNewsData: { h1: 'Cache válido' }
    });
  });

  test.each([null, undefined, {}])(
    'não reutiliza resultado sem conteúdo útil: %p',
    async emptyData => {
      const harness = createHarness();
      harness.extractNewsData
        .mockResolvedValueOnce(emptyData)
        .mockResolvedValueOnce({ h1: 'Retry válido' });

      await harness.run(`getOrExtractNewsData('https://example.com/a')`);
      const retry = await harness.run(
        `getOrExtractNewsData('https://example.com/a')`
      );

      expect(retry).toEqual({ h1: 'Retry válido' });
      expect(harness.extractNewsData).toHaveBeenCalledTimes(2);
    }
  );

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

describe('descarte de buscas de notícia obsoletas', () => {
  function startFetch(harness, url) {
    harness.elements.newsUrl.value = url;
    return harness.run('handleFetchNewsAndPreview()');
  }

  function newsData(label) {
    return {
      h1: `Título ${label}`,
      h2: `Subtítulo ${label}`,
      chapeu: `Categoria ${label}`,
      bg: `data:image/png;base64,${label === 'A' ? 'QQ==' : 'Qg=='}`
    };
  }

  test('mantém B quando A lenta resolve depois de B rápida', async () => {
    const harness = createHarness();
    const extractionA = createDeferred();
    const extractionB = createDeferred();
    harness.run(`openModal('layout-hz')`);
    harness.elements.previewFrame.contentWindow.__updatePreview = jest.fn();
    harness.extractNewsData
      .mockReturnValueOnce(extractionA.promise)
      .mockReturnValueOnce(extractionB.promise);

    const fetchA = startFetch(harness, 'https://example.com/a');
    const fetchB = startFetch(harness, 'https://example.com/b');
    extractionB.resolve(newsData('B'));
    await fetchB;
    extractionA.resolve(newsData('A'));
    await fetchA;

    expect(harness.elements.customTitle.value).toBe('Título B');
    expect(harness.elements.customSubtitle.value).toBe('Subtítulo B');
    expect(harness.elements.customTag.value).toBe('Categoria B');
    expect(harness.state()).toMatchObject({
      lastNewsUrl: 'https://example.com/b',
      lastNewsData: newsData('B')
    });
  });

  test('preserva o comportamento nominal quando A resolve antes de iniciar B', async () => {
    const harness = createHarness();
    harness.run(`openModal('layout-hz')`);
    harness.elements.previewFrame.contentWindow.__updatePreview = jest.fn();
    harness.extractNewsData
      .mockResolvedValueOnce(newsData('A'))
      .mockResolvedValueOnce(newsData('B'));

    await startFetch(harness, 'https://example.com/a');
    harness.elements.customTitle.value = '';
    harness.elements.customSubtitle.value = '';
    harness.elements.customTag.value = '';
    harness.elements.customImageUrl.value = '';
    await startFetch(harness, 'https://example.com/b');

    expect(harness.elements.customTitle.value).toBe('Título B');
    expect(harness.state()).toMatchObject({ lastNewsUrl: 'https://example.com/b' });
    expect(harness.elements.toastContainer.children).toHaveLength(2);
  });

  test('ignora rejeição de A depois de B concluir', async () => {
    const harness = createHarness();
    const extractionA = createDeferred();
    const extractionB = createDeferred();
    harness.run(`openModal('layout-hz')`);
    harness.elements.previewFrame.contentWindow.__updatePreview = jest.fn();
    harness.extractNewsData
      .mockReturnValueOnce(extractionA.promise)
      .mockReturnValueOnce(extractionB.promise);

    const fetchA = startFetch(harness, 'https://example.com/a');
    const fetchB = startFetch(harness, 'https://example.com/b');
    extractionB.resolve(newsData('B'));
    await fetchB;
    extractionA.reject(new Error('falha antiga'));
    await fetchA;

    expect(harness.elements.customTitle.value).toBe('Título B');
    expect(harness.elements.toastContainer.children).toHaveLength(1);
    expect(harness.context.console.error).not.toHaveBeenCalledWith(
      'Erro ao buscar dados da notícia:', expect.anything()
    );
  });

  test('A não restaura o botão enquanto B ainda está pendente', async () => {
    const harness = createHarness();
    const extractionA = createDeferred();
    const extractionB = createDeferred();
    harness.run(`openModal('layout-hz')`);
    harness.extractNewsData
      .mockReturnValueOnce(extractionA.promise)
      .mockReturnValueOnce(extractionB.promise);

    const fetchA = startFetch(harness, 'https://example.com/a');
    const fetchB = startFetch(harness, 'https://example.com/b');
    extractionA.resolve(newsData('A'));
    await fetchA;
    expect(harness.elements.fetchDataBtn.disabled).toBe(true);

    extractionB.resolve(newsData('B'));
    await fetchB;
    expect(harness.elements.fetchDataBtn.disabled).toBe(false);
  });

  test('ignora A depois que o modal é fechado e reaberto', async () => {
    const harness = createHarness();
    const extractionA = createDeferred();
    harness.run(`openModal('layout-hz')`);
    const updatePreview = jest.fn();
    harness.elements.previewFrame.contentWindow.__updatePreview = updatePreview;
    harness.extractNewsData.mockReturnValue(extractionA.promise);

    const fetchA = startFetch(harness, 'https://example.com/a');
    harness.run(`closeModalHandler(); openModal('rede-gazeta')`);
    harness.elements.customTitle.value = 'Nova sessão';
    extractionA.resolve(newsData('A'));
    await fetchA;

    expect(harness.elements.customTitle.value).toBe('Nova sessão');
    expect(harness.state()).toMatchObject({ lastNewsUrl: null, lastNewsData: null });
    expect(updatePreview).not.toHaveBeenCalled();
    expect(harness.elements.toastContainer.children).toHaveLength(0);
  });

  test('ignora A quando a URL é editada durante a requisição', async () => {
    const harness = createHarness();
    const extractionA = createDeferred();
    harness.run(`openModal('layout-hz')`);
    harness.extractNewsData.mockReturnValue(extractionA.promise);

    const fetchA = startFetch(harness, 'https://example.com/a');
    harness.elements.newsUrl.value = 'https://example.com/b';
    extractionA.resolve(newsData('A'));
    await fetchA;

    expect(harness.elements.customTitle.value).toBe('');
    expect(harness.state()).toMatchObject({ lastNewsUrl: null, lastNewsData: null });
    expect(harness.elements.toastContainer.children).toHaveLength(0);
  });

  test('preserva a proveniência da imagem de B quando A resolve depois', async () => {
    const harness = createHarness();
    const extractionA = createDeferred();
    const extractionB = createDeferred();
    harness.run(`openModal('layout-hz')`);
    harness.elements.previewFrame.contentWindow.__updatePreview = jest.fn();
    harness.extractNewsData
      .mockReturnValueOnce(extractionA.promise)
      .mockReturnValueOnce(extractionB.promise);

    const fetchA = startFetch(harness, 'https://example.com/a');
    const fetchB = startFetch(harness, 'https://example.com/b');
    extractionB.resolve(newsData('B'));
    await fetchB;
    extractionA.resolve(newsData('A'));
    await fetchA;

    const provenance = JSON.parse(harness.run(
      'JSON.stringify(resolvedImageFieldState)'
    ));
    expect(provenance).toEqual({
      source: 'extracted',
      value: newsData('B').bg,
      newsUrl: 'https://example.com/b'
    });
  });

  test('A antiga não atualiza o preview novamente depois de B', async () => {
    const harness = createHarness();
    const extractionA = createDeferred();
    const extractionB = createDeferred();
    const updatePreview = jest.fn();
    harness.run(`openModal('layout-hz')`);
    harness.elements.previewFrame.contentWindow.__updatePreview = updatePreview;
    harness.extractNewsData
      .mockReturnValueOnce(extractionA.promise)
      .mockReturnValueOnce(extractionB.promise);

    const fetchA = startFetch(harness, 'https://example.com/a');
    const fetchB = startFetch(harness, 'https://example.com/b');
    extractionB.resolve(newsData('B'));
    await fetchB;
    expect(updatePreview).toHaveBeenCalledTimes(1);
    extractionA.resolve(newsData('A'));
    await fetchA;

    expect(updatePreview).toHaveBeenCalledTimes(1);
  });

  test('não anuncia sucesso quando a aplicação ao preview da busca atual falha', async () => {
    const harness = createHarness();
    harness.run(`openModal('layout-hz')`);
    harness.elements.previewFrame.contentWindow.__updatePreview = jest.fn(() => {
      throw new Error('binding inválido');
    });
    harness.extractNewsData.mockResolvedValue(newsData('A'));

    await startFetch(harness, 'https://example.com/a');

    expect(harness.elements.toastContainer.children).toHaveLength(1);
    expect(harness.elements.toastContainer.children[0].innerHTML)
      .toContain('Erro ao buscar dados da notícia: binding inválido');
    expect(harness.elements.toastContainer.children[0].innerHTML)
      .not.toContain('Dados da notícia carregados');
    expect(harness.elements.fetchDataBtn.disabled).toBe(false);
  });

  test('ignora falha de preview quando a busca se torna obsoleta durante a aplicação', async () => {
    const harness = createHarness();
    harness.run(`openModal('layout-hz')`);
    harness.extractNewsData.mockResolvedValue(newsData('A'));
    harness.elements.previewFrame.contentWindow.__updatePreview = jest.fn(() => {
      harness.elements.newsUrl.value = 'https://example.com/b';
      throw new Error('binding da busca antiga');
    });

    await startFetch(harness, 'https://example.com/a');

    expect(harness.elements.toastContainer.children).toHaveLength(0);
    expect(harness.context.console.error).not.toHaveBeenCalled();
  });

  test('trata explicitamente falha de atualização auxiliar do preview', async () => {
    const harness = createHarness();
    harness.run(`openModal('layout-hz')`);
    harness.elements.previewFrame.contentWindow.__updatePreview = jest.fn();
    await harness.run('updatePreview()');
    harness.elements.previewFrame.contentWindow.__updatePreview = jest.fn(() => {
      throw new Error('falha auxiliar');
    });

    harness.elements.customTitle.dispatch('input');
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.context.console.error).toHaveBeenCalledTimes(1);
    expect(harness.context.console.error).toHaveBeenCalledWith(
      'Erro ao atualizar preview:',
      expect.objectContaining({ message: 'falha auxiliar' })
    );
    expect(harness.elements.toastContainer.children).toHaveLength(0);
  });

  test('preserva atualização auxiliar válida da sessão atual', async () => {
    const harness = createHarness();
    harness.run(`openModal('layout-hz')`);
    harness.elements.previewFrame.contentWindow.__updatePreview = jest.fn();
    await harness.run('updatePreview()');
    const updatePreview = jest.fn();
    harness.elements.previewFrame.contentWindow.__updatePreview = updatePreview;

    harness.elements.customTitle.value = 'Título atual';
    harness.elements.customTitle.dispatch('input');
    await Promise.resolve();
    await Promise.resolve();

    expect(updatePreview).toHaveBeenCalledWith(expect.objectContaining({
      h1: 'Título atual'
    }));
    expect(harness.context.console.error).not.toHaveBeenCalled();
    expect(harness.elements.toastContainer.children).toHaveLength(0);
  });

  test('ignora falha auxiliar de preview pertencente a uma sessão antiga', async () => {
    const harness = createHarness({ autoResolveRuntime: false });
    const documentWritten = createDeferred();
    harness.run(`openModal('layout-hz')`);
    harness.frameDocument.write.mockImplementation(html => {
      if (html.includes('preview-runtime.js')) documentWritten.resolve();
    });

    harness.elements.customTitle.dispatch('input');
    await documentWritten.promise;
    const rejectOldRuntime = harness.elements.previewFrame.contentWindow
      .__rejectPreviewRuntimeReady;

    harness.run(`closeModalHandler(); openModal('rede-gazeta')`);
    rejectOldRuntime(new Error('runtime da sessão antiga'));
    for (let index = 0; index < 5; index += 1) {
      await Promise.resolve();
    }

    expect(harness.context.console.error).not.toHaveBeenCalled();
    expect(harness.elements.toastContainer.children).toHaveLength(0);
  });

  test('ignora falha auxiliar de uma inicialização substituída na mesma sessão', async () => {
    const harness = createHarness({ autoResolveRuntime: false });
    const firstDocumentWritten = createDeferred();
    const secondDocumentWritten = createDeferred();
    harness.run(`openModal('layout-hz')`);
    harness.frameDocument.write
      .mockImplementationOnce(() => firstDocumentWritten.resolve())
      .mockImplementationOnce(() => secondDocumentWritten.resolve());

    harness.elements.customTitle.dispatch('input');
    await firstDocumentWritten.promise;
    const rejectFirstRuntime = harness.elements.previewFrame.contentWindow
      .__rejectPreviewRuntimeReady;

    harness.elements.customSubtitle.dispatch('input');
    await secondDocumentWritten.promise;
    const rejectSecondRuntime = harness.elements.previewFrame.contentWindow
      .__rejectPreviewRuntimeReady;
    rejectFirstRuntime(new Error('runtime da inicialização substituída'));
    for (let index = 0; index < 5; index += 1) {
      await Promise.resolve();
    }

    expect(harness.context.console.error).not.toHaveBeenCalled();
    expect(harness.elements.toastContainer.children).toHaveLength(0);
    expect(harness.state()).toMatchObject({
      currentTemplate: 'layout-hz',
      currentManifestData: null,
      previewInitializedTemplate: null
    });

    rejectSecondRuntime(new Error('runtime da inicialização atual'));
    for (let index = 0; index < 5; index += 1) {
      await Promise.resolve();
    }

    expect(harness.context.console.error).toHaveBeenCalledTimes(1);
    expect(harness.context.console.error).toHaveBeenCalledWith(
      'Erro ao atualizar preview:',
      expect.objectContaining({ message: 'Falha ao inicializar o runtime do preview' })
    );
    expect(harness.elements.toastContainer.children).toHaveLength(0);
  });

  test('não aplica atualização auxiliar antiga que resolve depois da mais nova existir', async () => {
    const harness = createHarness({ autoResolveRuntime: false });
    const firstDocumentWritten = createDeferred();
    const secondDocumentWritten = createDeferred();
    harness.run(`openModal('layout-hz')`);
    harness.frameDocument.write
      .mockImplementationOnce(() => firstDocumentWritten.resolve())
      .mockImplementationOnce(() => secondDocumentWritten.resolve());

    harness.elements.customTitle.value = 'Título A';
    harness.elements.customTitle.dispatch('input');
    await firstDocumentWritten.promise;
    const resolveFirstRuntime = harness.elements.previewFrame.contentWindow
      .__resolvePreviewRuntimeReady;

    harness.elements.customTitle.value = 'Título B';
    harness.elements.customTitle.dispatch('input');
    await secondDocumentWritten.promise;
    const resolveSecondRuntime = harness.elements.previewFrame.contentWindow
      .__resolvePreviewRuntimeReady;
    const updatePreview = jest.fn();
    harness.elements.previewFrame.contentWindow.__updatePreview = updatePreview;

    resolveFirstRuntime();
    for (let index = 0; index < 5; index += 1) {
      await Promise.resolve();
    }
    expect(updatePreview).not.toHaveBeenCalled();

    resolveSecondRuntime();
    for (let index = 0; index < 5; index += 1) {
      await Promise.resolve();
    }
    expect(updatePreview).toHaveBeenCalledTimes(1);
    expect(updatePreview).toHaveBeenCalledWith(expect.objectContaining({ h1: 'Título B' }));
    expect(harness.context.console.error).not.toHaveBeenCalled();
  });

  test('somente a terceira de três falhas auxiliares é considerada atual', async () => {
    const harness = createHarness();
    const updateA = createDeferred();
    const updateB = createDeferred();
    const updateC = createDeferred();
    harness.run(`openModal('layout-hz')`);
    harness.context.controlledUpdatePreview = jest.fn()
      .mockReturnValueOnce(updateA.promise)
      .mockReturnValueOnce(updateB.promise)
      .mockReturnValueOnce(updateC.promise);
    harness.run('updatePreview = controlledUpdatePreview');

    harness.elements.customTitle.dispatch('input');
    harness.elements.customSubtitle.dispatch('input');
    harness.elements.customTag.dispatch('input');
    updateA.reject(new Error('falha A'));
    updateB.reject(new Error('falha B'));
    updateC.reject(new Error('falha C'));
    for (let index = 0; index < 5; index += 1) {
      await Promise.resolve();
    }

    expect(harness.context.console.error).toHaveBeenCalledTimes(1);
    expect(harness.context.console.error).toHaveBeenCalledWith(
      'Erro ao atualizar preview:',
      expect.objectContaining({ message: 'falha C' })
    );
    expect(harness.elements.toastContainer.children).toHaveLength(0);
  });

  test('permite retry depois que a busca atual falha', async () => {
    const harness = createHarness();
    harness.run(`openModal('layout-hz')`);
    harness.elements.previewFrame.contentWindow.__updatePreview = jest.fn();
    harness.extractNewsData
      .mockRejectedValueOnce(new Error('falha atual'))
      .mockResolvedValueOnce(newsData('B'));

    await startFetch(harness, 'https://example.com/a');
    expect(harness.elements.fetchDataBtn.disabled).toBe(false);
    expect(harness.elements.toastContainer.children.at(-1).innerHTML)
      .toContain('falha atual');

    await startFetch(harness, 'https://example.com/b');
    expect(harness.elements.customTitle.value).toBe('Título B');
    expect(harness.elements.fetchDataBtn.disabled).toBe(false);
    expect(harness.state()).toMatchObject({ lastNewsUrl: 'https://example.com/b' });
  });

  test('permite retry na mesma URL quando o cliente traduz a falha para objeto vazio', async () => {
    const harness = createHarness();
    harness.run(`openModal('layout-hz')`);
    harness.elements.previewFrame.contentWindow.__updatePreview = jest.fn();
    harness.extractNewsData
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(newsData('B'));

    await startFetch(harness, 'https://example.com/a');
    expect(harness.state()).toMatchObject({ lastNewsUrl: null, lastNewsData: null });
    expect(harness.elements.fetchDataBtn.disabled).toBe(false);
    await startFetch(harness, 'https://example.com/a');
    await startFetch(harness, 'https://example.com/a');

    expect(harness.extractNewsData).toHaveBeenCalledTimes(2);
    expect(harness.elements.customTitle.value).toBe('Título B');
    expect(harness.state()).toMatchObject({
      lastNewsUrl: 'https://example.com/a',
      lastNewsData: newsData('B')
    });
    expect(JSON.parse(harness.run('JSON.stringify(resolvedImageFieldState)')))
      .toEqual({
        source: 'extracted',
        value: newsData('B').bg,
        newsUrl: 'https://example.com/a'
      });
    expect(harness.elements.fetchDataBtn.disabled).toBe(false);
  });

  test('resposta obsoleta vazia não altera cache nem UI de B', async () => {
    const harness = createHarness();
    const extractionA = createDeferred();
    const extractionB = createDeferred();
    harness.run(`openModal('layout-hz')`);
    harness.elements.previewFrame.contentWindow.__updatePreview = jest.fn();
    harness.extractNewsData
      .mockReturnValueOnce(extractionA.promise)
      .mockReturnValueOnce(extractionB.promise);

    const fetchA = startFetch(harness, 'https://example.com/a');
    const fetchB = startFetch(harness, 'https://example.com/b');
    extractionB.resolve(newsData('B'));
    await fetchB;
    extractionA.resolve({});
    await fetchA;

    expect(harness.elements.customTitle.value).toBe('Título B');
    expect(harness.state()).toMatchObject({
      lastNewsUrl: 'https://example.com/b',
      lastNewsData: newsData('B')
    });
    expect(harness.elements.toastContainer.children).toHaveLength(1);
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
  function preparePendingGeneration(harness, {
    template = 'layout-hz',
    url = 'https://example.com/a'
  } = {}) {
    const extraction = createDeferred();
    harness.run(`openModal(${JSON.stringify(template)})`);
    harness.elements.newsUrl.value = url;
    harness.extractNewsData.mockReturnValue(extraction.promise);
    harness.elements.previewFrame.contentWindow.__updatePreview = jest.fn();

    return {
      extraction,
      generation: harness.run('generateArtWithPreviewFlow()')
    };
  }

  function expectNoSuccessToast(harness) {
    const messages = harness.elements.toastContainer.children
      .map(toast => toast.innerHTML);
    expect(messages.some(message => message.includes('Arte gerada e download iniciado!')))
      .toBe(false);
  }

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

  test('aplica antes da exportacao o mesmo payload completo construido para o preview', async () => {
    const harness = createHarness();
    const updatePreview = jest.fn();
    const embeddedImage = 'data:image/png;base64,TUFOVUFM';
    const manifestData = {
      template: 'layout-hz',
      page: 'index',
      manifest: {
        logoField: 'brand',
        defaultLogo: 'logo-fallback.svg'
      },
      resolvedLogo: {
        kind: 'inline-svg',
        markup: '<svg><title>Logo resolvida</title></svg>'
      },
      css: [],
      html: ''
    };
    harness.elements.previewFrame.contentWindow.__updatePreview = updatePreview;
    harness.loadManifest.mockResolvedValue(manifestData);
    harness.context.Api.embedImage.mockResolvedValue(embeddedImage);
    harness.run(`openModal('layout-hz')`);
    harness.elements.newsUrl.value = 'https://example.com/noticia';
    harness.elements.customTitle.value = 'Titulo manual';
    harness.elements.customImageUrl.value = 'https://example.com/manual.jpg';
    harness.extractNewsData.mockResolvedValue({
      h1: 'Titulo extraido',
      h2: 'Subtitulo extraido',
      chapeu: 'Categoria extraida',
      bg: 'https://example.com/extraida.jpg'
    });

    await harness.run('generateArtWithPreviewFlow()');

    const expectedPayload = harness.run(
      `buildPreviewData(${JSON.stringify(manifestData)}, ${JSON.stringify(embeddedImage)})`
    );
    expect(updatePreview).toHaveBeenLastCalledWith(expectedPayload);
    expect(expectedPayload).toMatchObject({
      h1: 'Titulo manual',
      h2: 'Subtitulo extraido',
      tag: 'Categoria extraida',
      bg: embeddedImage,
      resolvedBg: embeddedImage,
      themeName: 'rosa',
      themeStylesheet: '../css/theme-rosa.css',
      brand: 'logo-fallback.svg',
      resolvedLogo: manifestData.resolvedLogo
    });
    expect(updatePreview.mock.invocationCallOrder.at(-1))
      .toBeLessThan(harness.context.PreviewExport.downloadPreview.mock.invocationCallOrder[0]);
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

  test('descarta a geracao quando a URL muda durante a extracao', async () => {
    const harness = createHarness();
    const { extraction, generation } = preparePendingGeneration(harness);
    await Promise.resolve();

    harness.elements.newsUrl.value = 'https://example.com/b';
    harness.elements.newsUrl.dispatch('input');
    extraction.resolve({
      chapeu: 'Categoria de A',
      bg: 'data:image/png;base64,QQ=='
    });
    await generation;

    expect(harness.state()).toMatchObject({
      lastNewsUrl: null,
      lastNewsData: null
    });
    expect(harness.elements.customTag.value).toBe('');
    expect(harness.elements.customImageUrl.value).toBe('');
    expect(harness.elements.previewFrame.contentWindow.__updatePreview).not.toHaveBeenCalled();
    expect(harness.context.PreviewExport.downloadPreview).not.toHaveBeenCalled();
    expectNoSuccessToast(harness);
    expect(harness.elements.toastContainer.children).toHaveLength(0);
    expect(harness.elements.loadingOverlay.classList.contains('show')).toBe(false);
    expect(harness.elements.generateBtn.disabled).toBe(false);
  });

  test('descarta a geracao quando o template muda durante a extracao', async () => {
    const harness = createHarness();
    const { extraction, generation } = preparePendingGeneration(harness);
    await Promise.resolve();

    harness.run(`openModal('rede-gazeta')`);
    extraction.resolve({
      chapeu: 'Categoria antiga',
      bg: 'data:image/png;base64,QQ=='
    });
    await generation;

    expect(harness.state()).toMatchObject({
      currentTemplate: 'rede-gazeta',
      lastNewsUrl: null,
      lastNewsData: null
    });
    expect(harness.elements.customTag.value).toBe('');
    expect(harness.elements.customImageUrl.value).toBe('');
    expect(harness.elements.previewFrame.contentWindow.__updatePreview).not.toHaveBeenCalled();
    expect(harness.context.PreviewExport.downloadPreview).not.toHaveBeenCalled();
    expectNoSuccessToast(harness);
    expect(harness.elements.toastContainer.children).toHaveLength(0);
    expect(harness.elements.loadingOverlay.classList.contains('show')).toBe(false);
    expect(harness.elements.generateBtn.disabled).toBe(false);
  });

  test('descarta a geracao de uma sessao fechada e reaberta', async () => {
    const harness = createHarness();
    const { extraction, generation } = preparePendingGeneration(harness);
    await Promise.resolve();

    harness.run(`closeModalHandler(); openModal('agazeta-foto-acima')`);
    extraction.resolve({
      chapeu: 'Categoria da sessao anterior',
      bg: 'data:image/png;base64,QQ=='
    });
    await generation;

    expect(harness.state()).toMatchObject({
      currentTemplate: 'agazeta-foto-acima',
      lastNewsUrl: null,
      lastNewsData: null
    });
    expect(harness.elements.customTag.value).toBe('');
    expect(harness.elements.customImageUrl.value).toBe('');
    expect(harness.elements.previewFrame.contentWindow.__updatePreview).not.toHaveBeenCalled();
    expect(harness.context.PreviewExport.downloadPreview).not.toHaveBeenCalled();
    expectNoSuccessToast(harness);
    expect(harness.elements.toastContainer.children).toHaveLength(0);
    expect(harness.elements.loadingOverlay.classList.contains('show')).toBe(false);
    expect(harness.elements.generateBtn.disabled).toBe(false);
  });

  test('ignora rejeicao da extracao depois de fechar e reabrir o modal', async () => {
    const harness = createHarness();
    const extraction = createDeferred();
    const extractionStarted = createDeferred();
    harness.run(`openModal('layout-hz')`);
    harness.elements.newsUrl.value = 'https://example.com/a';
    harness.extractNewsData.mockImplementation(() => {
      extractionStarted.resolve();
      return extraction.promise;
    });
    harness.elements.previewFrame.contentWindow.__updatePreview = jest.fn();

    const generation = harness.run('generateArtWithPreviewFlow()');
    await extractionStarted.promise;
    harness.run(`closeModalHandler(); openModal('agazeta-foto-acima')`);
    extraction.reject(new Error('falha da sessao anterior'));
    await generation;

    expect(harness.elements.toastContainer.children).toHaveLength(0);
    expect(harness.elements.customTitle.value).toBe('');
    expect(harness.elements.customTag.value).toBe('');
    expect(harness.elements.customImageUrl.value).toBe('');
    expect(harness.elements.previewFrame.contentWindow.__updatePreview).not.toHaveBeenCalled();
    expect(harness.context.PreviewExport.downloadPreview).not.toHaveBeenCalled();
    expect(harness.state()).toMatchObject({
      currentTemplate: 'agazeta-foto-acima',
      lastNewsUrl: null,
      lastNewsData: null
    });
  });

  test('ignora rejeicao de embedImage da geracao anterior sem remover o loading da atual', async () => {
    const harness = createHarness();
    const embedA = createDeferred();
    const embedStartedA = createDeferred();
    const extractionB = createDeferred();
    const extractionStartedB = createDeferred();
    harness.run(`openModal('layout-hz')`);
    harness.elements.previewFrame.contentWindow.__updatePreview = jest.fn();
    harness.extractNewsData
      .mockResolvedValueOnce({
        chapeu: 'Categoria A',
        bg: 'https://example.com/a.jpg'
      })
      .mockImplementationOnce(() => {
        extractionStartedB.resolve();
        return extractionB.promise;
      });
    harness.context.Api.embedImage.mockImplementation(() => {
      embedStartedA.resolve();
      return embedA.promise;
    });

    harness.elements.newsUrl.value = 'https://example.com/a';
    const generationA = harness.run('generateArtWithPreviewFlow()');
    await embedStartedA.promise;
    harness.elements.newsUrl.value = 'https://example.com/b';
    harness.elements.newsUrl.dispatch('input');
    const generationB = harness.run('generateArtWithPreviewFlow()');
    await extractionStartedB.promise;

    embedA.reject(new Error('falha da geracao A'));
    await generationA;

    expect(harness.elements.toastContainer.children).toHaveLength(0);
    expect(harness.context.PreviewExport.downloadPreview).not.toHaveBeenCalled();
    expect(harness.elements.loadingOverlay.classList.contains('show')).toBe(true);
    expect(harness.elements.generateBtn.disabled).toBe(true);

    extractionB.resolve({
      chapeu: 'Categoria B',
      bg: 'data:image/png;base64,Qg=='
    });
    await generationB;

    expect(harness.context.PreviewExport.downloadPreview).toHaveBeenCalledTimes(1);
    expect(harness.elements.toastContainer.children).toHaveLength(1);
    expect(harness.elements.toastContainer.children[0].innerHTML)
      .toContain('Arte gerada e download iniciado!');
    expect(harness.elements.loadingOverlay.classList.contains('show')).toBe(false);
    expect(harness.elements.generateBtn.disabled).toBe(false);
  });

  test('ignora rejeicao do download depois de trocar a sessao do modal', async () => {
    const harness = createHarness();
    const download = createDeferred();
    const downloadStarted = createDeferred();
    harness.run(`openModal('layout-hz')`);
    harness.elements.newsUrl.value = 'https://example.com/a';
    harness.elements.previewFrame.contentWindow.__updatePreview = jest.fn();
    harness.extractNewsData.mockResolvedValue({
      chapeu: 'Categoria A',
      bg: 'data:image/png;base64,QQ=='
    });
    harness.context.PreviewExport.downloadPreview.mockImplementation(() => {
      downloadStarted.resolve();
      return download.promise;
    });

    const generation = harness.run('generateArtWithPreviewFlow()');
    await downloadStarted.promise;
    harness.run(`closeModalHandler(); openModal('rede-gazeta')`);
    download.reject(new Error('falha do download anterior'));
    await generation;

    expect(harness.elements.toastContainer.children).toHaveLength(0);
    expect(harness.elements.customTitle.value).toBe('');
    expect(harness.elements.customTag.value).toBe('');
    expect(harness.elements.customImageUrl.value).toBe('');
    expect(harness.state()).toMatchObject({
      currentTemplate: 'rede-gazeta',
      lastNewsUrl: null,
      lastNewsData: null
    });
    expect(harness.elements.loadingOverlay.classList.contains('show')).toBe(false);
    expect(harness.elements.generateBtn.disabled).toBe(false);
  });

  test('usa snapshot consistente e deixa edicoes posteriores para a proxima geracao', async () => {
    const harness = createHarness();
    const extraction = createDeferred();
    harness.run(`openModal('layout-hz')`);
    harness.elements.newsUrl.value = 'https://example.com/a';
    harness.elements.customTitle.value = 'Titulo inicial';
    harness.extractNewsData.mockReturnValue(extraction.promise);
    harness.elements.previewFrame.contentWindow.__updatePreview = jest.fn();
    const generation = harness.run('generateArtWithPreviewFlow()');
    await Promise.resolve();

    harness.elements.customTitle.value = 'Titulo posterior';
    harness.elements.customTag.value = 'Categoria posterior';
    harness.run(`currentTheme = 'preto'`);
    extraction.resolve({
      h1: 'Titulo extraido',
      chapeu: 'Categoria extraida',
      bg: 'data:image/png;base64,QQ=='
    });
    await generation;

    expect(harness.elements.previewFrame.contentWindow.__updatePreview)
      .toHaveBeenCalledWith(expect.objectContaining({
        h1: 'Titulo inicial',
        tag: 'Categoria extraida',
        themeName: 'rosa'
      }));
    expect(harness.elements.customTitle.value).toBe('Titulo posterior');
    expect(harness.elements.customTag.value).toBe('Categoria posterior');
  });

  test('somente a geracao mais nova pode atualizar cache, preview e exportacao', async () => {
    const harness = createHarness();
    const extractionA = createDeferred();
    const extractionB = createDeferred();
    const extractionStartedA = createDeferred();
    const extractionStartedB = createDeferred();
    const updatePreview = jest.fn();
    harness.run(`openModal('layout-hz')`);
    harness.elements.previewFrame.contentWindow.__updatePreview = updatePreview;
    harness.extractNewsData
      .mockImplementationOnce(() => {
        extractionStartedA.resolve();
        return extractionA.promise;
      })
      .mockImplementationOnce(() => {
        extractionStartedB.resolve();
        return extractionB.promise;
      });

    harness.elements.newsUrl.value = 'https://example.com/a';
    const generationA = harness.run('generateArtWithPreviewFlow()');
    await extractionStartedA.promise;
    expect(harness.extractNewsData).toHaveBeenCalledTimes(1);
    harness.elements.newsUrl.value = 'https://example.com/b';
    harness.elements.newsUrl.dispatch('input');
    const generationB = harness.run('generateArtWithPreviewFlow()');
    await extractionStartedB.promise;
    expect(harness.extractNewsData).toHaveBeenCalledTimes(2);

    extractionB.resolve({
      chapeu: 'Categoria B',
      bg: 'data:image/png;base64,Qg=='
    });
    await generationB;
    extractionA.resolve({
      chapeu: 'Categoria A',
      bg: 'data:image/png;base64,QQ=='
    });
    await generationA;

    expect(harness.state()).toMatchObject({
      lastNewsUrl: 'https://example.com/b',
      lastNewsData: {
        chapeu: 'Categoria B',
        bg: 'data:image/png;base64,Qg=='
      }
    });
    expect(harness.elements.customTag.value).toBe('Categoria B');
    expect(updatePreview).toHaveBeenCalledTimes(1);
    expect(updatePreview).toHaveBeenCalledWith(expect.objectContaining({
      tag: 'Categoria B',
      bg: 'data:image/png;base64,Qg=='
    }));
    expect(harness.context.PreviewExport.downloadPreview).toHaveBeenCalledTimes(1);
    expect(harness.elements.loadingOverlay.classList.contains('show')).toBe(false);
    expect(harness.elements.generateBtn.disabled).toBe(false);
  });

  test('aguarda readiness e aplica o payload antes de iniciar a exportação', async () => {
    const harness = createHarness();
    const readiness = createDeferred();
    const readinessStarted = createDeferred();
    const events = [];
    harness.run(`openModal('layout-hz')`);
    harness.elements.newsUrl.value = 'https://example.com/noticia';
    harness.extractNewsData.mockResolvedValue({
      chapeu: 'Categoria',
      bg: 'data:image/png;base64,QQ=='
    });
    harness.context.waitForRuntime = jest.fn(async ({ manifestData }) => {
      readinessStarted.resolve();
      await readiness.promise;
      events.push('runtime-ready');
      return manifestData;
    });
    harness.run('ensurePreviewInitialized = waitForRuntime');
    harness.elements.previewFrame.contentWindow.__updatePreview = jest.fn(() => {
      events.push('payload-applied');
    });
    harness.context.PreviewExport.downloadPreview.mockImplementation(() => {
      events.push('download-started');
    });

    const generation = harness.run('generateArtWithPreviewFlow()');
    await readinessStarted.promise;

    expect(harness.context.PreviewExport.downloadPreview).not.toHaveBeenCalled();

    readiness.resolve();
    await generation;

    expect(events).toEqual([
      'runtime-ready',
      'payload-applied',
      'download-started'
    ]);
  });

  test('bloqueia exportação quando a aplicação do payload final falha', async () => {
    const harness = createHarness();
    harness.run(`openModal('layout-hz')`);
    harness.elements.newsUrl.value = 'https://example.com/noticia';
    harness.extractNewsData.mockResolvedValue({
      chapeu: 'Categoria',
      bg: 'data:image/png;base64,QQ=='
    });
    harness.elements.previewFrame.contentWindow.__updatePreview = jest.fn(() => {
      throw new Error('binding final inválido');
    });

    await harness.run('generateArtWithPreviewFlow()');

    expect(harness.context.PreviewExport.downloadPreview).not.toHaveBeenCalled();
    expectNoSuccessToast(harness);
    expect(harness.elements.toastContainer.children.at(-1).innerHTML)
      .toContain('Erro ao gerar arte: binding final inválido');
    expect(harness.elements.loadingOverlay.classList.contains('show')).toBe(false);
    expect(harness.elements.generateBtn.disabled).toBe(false);
  });

  test('bloqueia exportação quando o runtime não expõe a atualização final', async () => {
    const harness = createHarness();
    harness.run(`openModal('layout-hz')`);
    harness.elements.newsUrl.value = 'https://example.com/noticia';
    harness.extractNewsData.mockResolvedValue({
      chapeu: 'Categoria',
      bg: 'data:image/png;base64,QQ=='
    });

    await harness.run('generateArtWithPreviewFlow()');

    expect(harness.context.PreviewExport.downloadPreview).not.toHaveBeenCalled();
    expectNoSuccessToast(harness);
    expect(harness.elements.toastContainer.children.at(-1).innerHTML)
      .toContain('O runtime do preview não está disponível');
    expect(harness.elements.loadingOverlay.classList.contains('show')).toBe(false);
    expect(harness.elements.generateBtn.disabled).toBe(false);
  });

  test('restaura a interface quando uma imagem do preview falha ao carregar', async () => {
    const harness = createHarness();
    harness.run(`openModal('layout-hz')`);
    harness.elements.newsUrl.value = 'https://example.com/noticia';
    harness.elements.previewFrame.contentWindow.__updatePreview = jest.fn();
    harness.extractNewsData.mockResolvedValue({
      chapeu: 'Categoria',
      bg: 'data:image/png;base64,QQ=='
    });
    harness.context.PreviewExport.downloadPreview.mockRejectedValue(
      new Error('Não foi possível carregar uma imagem do preview')
    );

    await harness.run('generateArtWithPreviewFlow()');

    expect(harness.context.PreviewExport.downloadPreview).toHaveBeenCalledTimes(1);
    expectNoSuccessToast(harness);
    expect(harness.elements.toastContainer.children.at(-1).innerHTML)
      .toContain('Não foi possível carregar uma imagem do preview');
    expect(harness.elements.loadingOverlay.classList.contains('show')).toBe(false);
    expect(harness.elements.generateBtn.disabled).toBe(false);
  });

  test('ignora falha de update pertencente a uma geração obsoleta', async () => {
    const harness = createHarness();
    harness.run(`openModal('layout-hz')`);
    harness.elements.newsUrl.value = 'https://example.com/noticia';
    harness.extractNewsData.mockResolvedValue({
      chapeu: 'Categoria',
      bg: 'data:image/png;base64,QQ=='
    });
    harness.elements.previewFrame.contentWindow.__updatePreview = jest.fn(() => {
      harness.run(`openModal('rede-gazeta')`);
      throw new Error('binding da geração antiga');
    });

    await harness.run('generateArtWithPreviewFlow()');

    expect(harness.context.PreviewExport.downloadPreview).not.toHaveBeenCalled();
    expect(harness.elements.toastContainer.children).toHaveLength(0);
    expect(harness.state()).toMatchObject({
      currentTemplate: 'rede-gazeta',
      currentManifestData: null,
      previewInitializedTemplate: null
    });
    expect(harness.elements.loadingOverlay.classList.contains('show')).toBe(false);
    expect(harness.elements.generateBtn.disabled).toBe(false);
  });

  test.each(['carregamento', 'inicialização'])(
    'restaura a interface quando falha a readiness de %s do runtime',
    async () => {
      const harness = createHarness({ autoResolveRuntime: false });
      const documentWritten = createDeferred();
      harness.run(`openModal('layout-hz')`);
      harness.elements.newsUrl.value = 'https://example.com/noticia';
      harness.extractNewsData.mockResolvedValue({
        chapeu: 'Categoria',
        bg: 'data:image/png;base64,QQ=='
      });
      harness.frameDocument.write.mockImplementation(html => {
        if (html.includes('preview-runtime.js')) documentWritten.resolve();
      });

      const generation = harness.run('generateArtWithPreviewFlow()');
      await documentWritten.promise;
      harness.elements.previewFrame.contentWindow.__rejectPreviewRuntimeReady(
        new Error('Falha ao inicializar o runtime do preview')
      );
      await generation;

      expect(harness.context.PreviewExport.downloadPreview).not.toHaveBeenCalled();
      expectNoSuccessToast(harness);
      expect(harness.elements.toastContainer.children.at(-1).innerHTML)
        .toContain('Falha ao inicializar o runtime do preview');
      expect(harness.elements.loadingOverlay.classList.contains('show')).toBe(false);
      expect(harness.elements.generateBtn.disabled).toBe(false);
      expect(harness.state()).toMatchObject({
        currentManifestData: null,
        previewInitializedTemplate: null
      });
    }
  );

  test('refaz a inicialização e exporta depois de uma falha do runtime', async () => {
    const harness = createHarness({ autoResolveRuntime: false });
    const firstDocument = createDeferred();
    harness.run(`openModal('layout-hz')`);
    harness.elements.newsUrl.value = 'https://example.com/noticia';
    harness.extractNewsData.mockResolvedValue({
      chapeu: 'Categoria',
      bg: 'data:image/png;base64,QQ=='
    });
    harness.frameDocument.write.mockImplementation(html => {
      if (html.includes('preview-runtime.js')) firstDocument.resolve();
    });

    const firstGeneration = harness.run('generateArtWithPreviewFlow()');
    await firstDocument.promise;
    harness.elements.previewFrame.contentWindow.__rejectPreviewRuntimeReady(
      new Error('Falha ao inicializar o runtime do preview')
    );
    await firstGeneration;

    const secondDocument = createDeferred();
    harness.frameDocument.write.mockImplementation(html => {
      if (html.includes('preview-runtime.js')) secondDocument.resolve();
    });
    const secondGeneration = harness.run('generateArtWithPreviewFlow()');
    await secondDocument.promise;
    harness.elements.previewFrame.contentWindow.__updatePreview = jest.fn();
    harness.elements.previewFrame.contentWindow.__resolvePreviewRuntimeReady();
    await secondGeneration;

    const runtimeDocuments = harness.frameDocument.write.mock.calls
      .filter(([html]) => html.includes('preview-runtime.js'));
    expect(runtimeDocuments).toHaveLength(2);
    expect(harness.context.PreviewExport.downloadPreview).toHaveBeenCalledTimes(1);
    expect(harness.elements.previewFrame.contentWindow.__updatePreview)
      .toHaveBeenCalled();
    expect(harness.elements.loadingOverlay.classList.contains('show')).toBe(false);
    expect(harness.elements.generateBtn.disabled).toBe(false);
  });

  test.each(['resolvida', 'rejeitada'])(
    'ignora readiness %s depois de a geração se tornar obsoleta',
    async readinessOutcome => {
      const harness = createHarness({ autoResolveRuntime: false });
      const documentWritten = createDeferred();
      harness.run(`openModal('layout-hz')`);
      harness.elements.newsUrl.value = 'https://example.com/noticia';
      harness.extractNewsData.mockResolvedValue({
        chapeu: 'Categoria',
        bg: 'data:image/png;base64,QQ=='
      });
      harness.frameDocument.write.mockImplementation(html => {
        if (html.includes('preview-runtime.js')) documentWritten.resolve();
      });

      const generation = harness.run('generateArtWithPreviewFlow()');
      await documentWritten.promise;
      const oldFrameWindow = harness.elements.previewFrame.contentWindow;
      const settleOldRuntime = readinessOutcome === 'resolvida'
        ? () => oldFrameWindow.__resolvePreviewRuntimeReady()
        : () => oldFrameWindow.__rejectPreviewRuntimeReady(
          new Error('Falha ao inicializar o runtime do preview')
        );

      harness.run(`openModal('rede-gazeta')`);
      settleOldRuntime();
      await generation;

      expect(harness.context.PreviewExport.downloadPreview).not.toHaveBeenCalled();
      expect(harness.elements.toastContainer.children).toHaveLength(0);
      expect(harness.state()).toMatchObject({
        currentTemplate: 'rede-gazeta',
        currentManifestData: null,
        previewInitializedTemplate: null
      });
      expect(harness.elements.loadingOverlay.classList.contains('show')).toBe(false);
      expect(harness.elements.generateBtn.disabled).toBe(false);
    }
  );

  test.each([
    {
      name: 'loadManifest',
      prepare: harness => {
        harness.loadManifest.mockRejectedValue(new Error('manifest indisponivel'));
      },
      errorMessage: 'manifest indisponivel'
    },
    {
      name: 'Api.embedImage',
      prepare: harness => {
        harness.extractNewsData.mockResolvedValue({
          chapeu: 'Categoria',
          bg: 'https://example.com/imagem.jpg'
        });
        harness.context.Api.embedImage.mockRejectedValue(new Error('imagem indisponivel'));
      },
      errorMessage: 'imagem indisponivel'
    },
    {
      name: 'ensurePreviewInitialized',
      prepare: harness => {
        harness.extractNewsData.mockResolvedValue({
          chapeu: 'Categoria',
          bg: 'data:image/png;base64,QQ=='
        });
        harness.context.rejectPreviewInitialization = jest.fn()
          .mockRejectedValue(new Error('preview indisponivel'));
        harness.run('ensurePreviewInitialized = rejectPreviewInitialization');
      },
      errorMessage: 'preview indisponivel'
    },
    {
      name: 'PreviewExport.downloadPreview',
      prepare: harness => {
        harness.extractNewsData.mockResolvedValue({
          chapeu: 'Categoria',
          bg: 'data:image/png;base64,QQ=='
        });
        harness.context.PreviewExport.downloadPreview
          .mockRejectedValue(new Error('exportacao indisponivel'));
      },
      errorMessage: 'exportacao indisponivel',
      expectDownload: true
    }
  ])('restaura a interface quando $name rejeita', async ({
    prepare,
    errorMessage,
    expectDownload = false
  }) => {
    const harness = createHarness();
    harness.run(`openModal('layout-hz')`);
    harness.elements.newsUrl.value = 'https://example.com/noticia';
    harness.elements.previewFrame.contentWindow.__updatePreview = jest.fn();
    prepare(harness);

    await harness.run('generateArtWithPreviewFlow()');

    expect(harness.elements.loadingOverlay.classList.contains('show')).toBe(false);
    expect(harness.elements.generateBtn.disabled).toBe(false);
    expectNoSuccessToast(harness);
    expect(harness.elements.toastContainer.children.at(-1).innerHTML)
      .toContain(`Erro ao gerar arte: ${errorMessage}`);
    if (expectDownload) {
      expect(harness.context.PreviewExport.downloadPreview).toHaveBeenCalledTimes(1);
    } else {
      expect(harness.elements.previewFrame.contentWindow.__updatePreview).not.toHaveBeenCalled();
      expect(harness.context.PreviewExport.downloadPreview).not.toHaveBeenCalled();
    }
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
