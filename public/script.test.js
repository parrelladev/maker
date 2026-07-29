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
