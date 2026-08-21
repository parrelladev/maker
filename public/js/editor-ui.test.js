const EditorUi = require('./editor-ui');
const EditorState = require('./editor-state');
const Catalog = require('./editor-catalog');

class FakeElement {
  constructor() {
    this.children = [];
    this.dataset = {};
    this.listeners = {};
    this.attributes = {};
    this.classList = { add: jest.fn(), toggle: jest.fn() };
    this.style = {};
    this.disabled = false;
    this.value = '';
    this.textContent = '';
    this.hidden = false;
  }
  set innerHTML(_value) { this.children = []; }
  get innerHTML() { return ''; }
  appendChild(child) { this.children.push(child); }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  setAttribute(name, value) { this.attributes[name] = value; }
  querySelector(selector) { return selector === 'span:last-child' ? this.statusText : null; }
  dispatch(type) { return Promise.all((this.listeners[type] || []).map(listener => listener({ target: this }))); }
}

function fixture() {
  const elements = {
    brand: new FakeElement(), family: new FakeElement(), variants: new FakeElement(), themes: new FakeElement(),
    status: new FakeElement(), newArtwork: new FakeElement(), feed: new FakeElement(), story: new FakeElement(), compare: new FakeElement(),
    downloadCurrent: new FakeElement(), downloadAll: new FakeElement(), importNews: new FakeElement(),
    imageAdjustments: new FakeElement(), resetImageAdjustments: new FakeElement(),
    previewStage: new FakeElement(), feedPanel: new FakeElement(), storyPanel: new FakeElement(),
    feedPanelSelector: new FakeElement(), storyPanelSelector: new FakeElement(),
  };
  elements.feed.dataset.viewMode = 'feed';
  elements.story.dataset.viewMode = 'story';
  elements.compare.dataset.viewMode = 'compare';
  elements.previewViewport = new FakeElement();
  elements.previewFrame = new FakeElement();
  elements.feedPanel.dataset.previewPanel = 'feed';
  elements.storyPanel.dataset.previewPanel = 'story';
  elements.feedPanelSelector.dataset.selectPreviewFormat = 'feed';
  elements.storyPanelSelector.dataset.selectPreviewFormat = 'story';
  elements.status.statusText = new FakeElement();
  const fields = ['url', 'title', 'subtitle', 'tag', 'image'].map(name => {
    const field = new FakeElement(); field.dataset.field = name; return field;
  });
  const adjustmentInputs = ['zoom', 'x', 'y'].map(name => {
    const input = new FakeElement(); input.dataset.imageAdjustment = name; return input;
  });
  const adjustmentOutputs = Object.fromEntries(['zoom', 'x', 'y'].map(name => [name, new FakeElement()]));
  const selectors = {
    '[data-control="brand"]': elements.brand, '[data-control="family"]': elements.family,
    '[data-control="variants"]': elements.variants, '[data-control="themes"]': elements.themes,
    '[data-editor-status]': elements.status, '[data-action="new-artwork"]': elements.newArtwork,
    '[data-action="download-current"]': elements.downloadCurrent,
    '[data-action="download-all"]': elements.downloadAll,
    '[data-action="import-news"]': elements.importNews,
    '[data-control="image-adjustments"]': elements.imageAdjustments,
    '[data-action="reset-image-adjustments"]': elements.resetImageAdjustments,
    '[data-preview-viewport]': elements.previewViewport,
    '#previewFrame': elements.previewFrame,
    '[data-preview-stage]': elements.previewStage,
    '[data-view-mode="feed"]': elements.feed,
    '[data-view-mode="story"]': elements.story,
    '[data-view-mode="compare"]': elements.compare,
  };
  fields.forEach(field => { selectors[`[data-field="${field.dataset.field}"]`] = field; });
  const document = {
    querySelector: selector => {
      const output = selector.match(/^\[data-value-for="(.+)"\]$/);
      return output ? adjustmentOutputs[output[1]] : selectors[selector] || null;
    },
    querySelectorAll: selector => {
      if (selector === '[data-field]') return fields;
      if (selector === '[data-image-adjustment]') return adjustmentInputs;
      if (selector === '[data-view-mode]') return [elements.feed, elements.story, elements.compare];
      if (selector === '[data-preview-panel]') return [elements.feedPanel, elements.storyPanel];
      if (selector === '[data-select-preview-format]') return [elements.feedPanelSelector, elements.storyPanelSelector];
      if (selector.includes('data-view-mode')) return [elements.feed, elements.story];
      return [];
    },
    createElement: () => new FakeElement(),
  };
  return { document, elements, fields, adjustmentInputs, adjustmentOutputs };
}

const syntheticCatalog = { brands: [{ id: 'brand-x', name: 'Brand X', families: [{
  id: 'family-y', label: 'family-y', variants: [
    { id: 'feed-only', label: 'Feed only', formats: [{ id: 'feed', themes: [] }] },
    { id: 'variant-z', label: 'Variant Z', formats: [
      { id: 'feed', dimensions: { width: 1080, height: 1350 }, capabilities: { imageAdjustments: { zoom: true, position: true } }, themes: [{ id: 'blue', label: 'Blue' }] },
      { id: 'story', dimensions: { width: 1080, height: 1920 }, capabilities: { imageAdjustments: { zoom: true, position: true } }, themes: [{ id: 'green', label: 'Green' }, { id: 'black', label: 'Black' }, { id: 'white', label: 'White' }] },
    ] },
    { id: 'variant-q', label: 'Variant Q', formats: [{ id: 'story', themes: [{ id: 'white', label: 'White' }] }] },
  ],
}, { id: 'family-two', label: 'family-two', variants: [
  { id: 'variant-two', label: 'Variant Two', formats: [{ id: 'story', themes: [{ id: 'orange', label: 'Orange' }] }] },
]}] }, {
  id: 'brand-two', name: 'Brand Two', families: [{ id: 'family-b', label: 'family-b', variants: [
    { id: 'variant-b', label: 'Variant B', formats: [{ id: 'story', themes: [{ id: 'purple', label: 'Purple' }] }] },
  ] }],
}] };

const multiFormatCatalog = { brands: [{ id: 'brand-x', name: 'Brand X', families: [{
  id: 'family-y', label: 'family-y', variants: [{
    id: 'variant-both', label: 'Variant Both', formats: [
      { id: 'feed', dimensions: { width: 1080, height: 1350 }, capabilities: { imageAdjustments: { zoom: true, position: true } }, themes: [{ id: 'blue', label: 'Blue' }, { id: 'navy', label: 'Navy' }] },
      { id: 'story', dimensions: { width: 1080, height: 1920 }, capabilities: { imageAdjustments: { zoom: true, position: true } }, themes: [{ id: 'green', label: 'Green' }, { id: 'black', label: 'Black' }] },
    ],
  }],
}] }] };

function setup(overrides = {}) {
  const dom = fixture();
  const disableReasons = new Set();
  const setDisabled = (reason, disabled) => {
    if (disabled) disableReasons.add(reason); else disableReasons.delete(reason);
    dom.elements.downloadCurrent.disabled = disableReasons.size > 0;
  };
  const api = {
    getEditorCatalog: jest.fn().mockResolvedValue(syntheticCatalog),
    resolveEditorRenderer: jest.fn(selection => Promise.resolve({
      template: selection.format === 'feed' ? 'renderer-feed' : 'renderer-z', page: 'index',
      dimensions: selection.format === 'feed' ? { width: 1080, height: 1350 } : { width: 1080, height: 1920 },
      themes: selection.format === 'feed' ? [{ id: 'blue', label: 'Blue' }] : [{ id: 'green', label: 'Green' }],
    })),
    ...overrides.api,
  };
  const legacyBridge = {
    selectRenderer: jest.fn().mockResolvedValue(),
    selectTheme: jest.fn(),
    setEditorPreviewReady: jest.fn((_format, ready) => setDisabled('editor-preview', !ready)),
    importNews: jest.fn().mockResolvedValue({ h1: 'Imported title', h2: 'Imported subtitle', chapeu: 'Imported tag', bg: 'image-data' }),
    applyPublicationContent: jest.fn().mockResolvedValue(),
    setNewsImportPending: jest.fn(pending => setDisabled('news-import', pending)),
    setContentSyncPending: jest.fn(pending => setDisabled('content-sync', pending)),
    resizePreview: jest.fn(),
    clearPreview: jest.fn(),
    reconcilePublicationContent: jest.fn(({ content }) => content),
    isFormatExportable: jest.fn(() => true),
    captureExportAuthority: jest.fn(format => ({ format })),
    isExportAuthorityCurrent: jest.fn(() => true),
    setExportPending: jest.fn(),
    downloadExport: jest.fn().mockResolvedValue(true),
    ...overrides.legacyBridge,
  };
  const controller = EditorUi.createEditorController({
    document: dom.document, api, state: EditorState, catalogHelpers: Catalog,
    frontendUtils: { normalizeOptionalValue: value => typeof value === 'string' ? value.trim() : '', isHttpUrl: value => /^https?:\/\//.test(value) },
    legacyBridge,
  });
  return { ...dom, api, legacyBridge, controller, disableReasons };
}

describe('controller/UI editorial', () => {
  test('mostra controles suportados, altera publication e reseta sem resolver renderer', async () => {
    const harness = setup();
    await harness.controller.initialize();
    expect(harness.elements.imageAdjustments.hidden).toBe(false);
    const resolveCalls = harness.api.resolveEditorRenderer.mock.calls.length;
    for (const [index, value] of [[0, '1.5'], [1, '25'], [2, '80']]) {
      harness.adjustmentInputs[index].value = value;
      await harness.adjustmentInputs[index].dispatch('input');
    }
    await Promise.resolve();
    expect(harness.controller.getPublication().formats.story.imageAdjustments)
      .toEqual({ zoom: 1.5, x: 25, y: 80 });
    expect(harness.legacyBridge.applyPublicationContent).toHaveBeenLastCalledWith(expect.objectContaining({
      imageAdjustments: { zoom: 1.5, x: 25, y: 80 },
    }));
    expect(harness.api.resolveEditorRenderer).toHaveBeenCalledTimes(resolveCalls);
    await harness.controller.resetCurrentImageAdjustments();
    expect(harness.controller.getPublication().formats.story.imageAdjustments)
      .toEqual({ zoom: 1, x: 50, y: 50 });
  });

  test('oculta ajustes sem capability e preserva valores ao trocar variant e theme', async () => {
    const harness = setup();
    await harness.controller.initialize();
    harness.adjustmentInputs[0].value = '1.4';
    await harness.adjustmentInputs[0].dispatch('input');
    await harness.controller.selectVariant('variant-q');
    expect(harness.elements.imageAdjustments.hidden).toBe(true);
    expect(harness.controller.getPublication().formats.story.imageAdjustments.zoom).toBe(1.4);
    harness.controller.selectTheme('white');
    expect(harness.controller.getPublication().formats.story.imageAdjustments.zoom).toBe(1.4);
    await harness.controller.selectVariant('variant-z');
    expect(harness.elements.imageAdjustments.hidden).toBe(false);
    expect(harness.adjustmentInputs[0].value).toBe('1.4');
  });

  test('slider stale nÃ£o reaplica valor antigo nem libera download cedo', async () => {
    let finishFirst; let finishSecond; let runtimeZoom = 1;
    const harness = setup();
    await harness.controller.initialize();
    harness.legacyBridge.applyPublicationContent.mockReset()
      .mockImplementationOnce(({ imageAdjustments, assertCurrent }) => new Promise(resolve => {
        finishFirst = () => {
          try { assertCurrent(); runtimeZoom = imageAdjustments.zoom; resolve(); }
          catch (error) { resolve(Promise.reject(error)); }
        };
      }))
      .mockImplementationOnce(({ imageAdjustments, assertCurrent }) => new Promise(resolve => {
        finishSecond = () => { assertCurrent(); runtimeZoom = imageAdjustments.zoom; resolve(); };
      }));
    harness.adjustmentInputs[0].value = '1.1';
    await harness.adjustmentInputs[0].dispatch('input');
    harness.adjustmentInputs[0].value = '1.2';
    await harness.adjustmentInputs[0].dispatch('input');
    expect(harness.elements.downloadCurrent.disabled).toBe(true);
    finishSecond(); await Promise.resolve(); await Promise.resolve();
    expect(runtimeZoom).toBe(1.2);
    expect(harness.elements.downloadCurrent.disabled).toBe(false);
    finishFirst(); await Promise.resolve(); await Promise.resolve();
    expect(runtimeZoom).toBe(1.2);
    expect(harness.controller.getPublication().formats.story.imageAdjustments.zoom).toBe(1.2);
    expect(harness.elements.status.statusText.textContent).toBe('Pronto');
    expect(harness.elements.downloadCurrent.disabled).toBe(false);
  });
  test('catálogo sintético preenche controles e publication sem conhecer A Gazeta', async () => {
    const harness = setup();
    await harness.controller.initialize();
    expect(harness.elements.brand.children.map(item => [item.value, item.textContent])).toEqual([['brand-x', 'Brand X'], ['brand-two', 'Brand Two']]);
    expect(harness.elements.family.children[0].textContent).toBe('family-y');
    expect(harness.elements.variants.children.map(item => item.textContent)).toEqual(['Variant Z', 'Variant Q']);
    expect(harness.elements.variants.children[0].attributes['aria-pressed']).toBe('true');
    expect(harness.elements.themes.children.map(item => item.textContent)).toEqual(['Green', 'Black', 'White']);
    expect(harness.controller.getPublication()).toMatchObject({
      brand: 'brand-x', family: 'family-y', formats: { story: { variant: 'variant-z', theme: 'green' } },
    });
    expect(harness.controller.getPreviewState()).toBe('ready');
    expect(harness.elements.downloadCurrent.disabled).toBe(false);
    expect(harness.api.getEditorCatalog).toHaveBeenCalledTimes(1);
    expect(harness.api.resolveEditorRenderer).toHaveBeenCalledWith({
      brand: 'brand-x', family: 'family-y', variant: 'variant-z', format: 'story',
    });
    expect(harness.legacyBridge.selectRenderer).toHaveBeenCalledWith(expect.objectContaining({
      renderer: expect.objectContaining({ template: 'renderer-z', page: 'index' }),
      activeFormat: 'story',
      theme: 'green',
    }));
  });

  test('trocas de brand e family recalculam toda a configuração válida', async () => {
    const harness = setup();
    await harness.controller.initialize();
    await harness.controller.selectFamily('family-two');
    expect(harness.controller.getPublication()).toMatchObject({
      brand: 'brand-x', family: 'family-two', formats: { story: { variant: 'variant-two', theme: 'orange' } },
    });
    await harness.controller.selectBrand('brand-two');
    expect(harness.controller.getPublication()).toMatchObject({
      brand: 'brand-two', family: 'family-b', formats: { story: { variant: 'variant-b', theme: 'purple' } },
    });
  });

  test('cliques em variant/theme atualizam publication e tema não resolve renderer', async () => {
    const harness = setup();
    await harness.controller.initialize();
    await harness.elements.variants.children[1].dispatch('click');
    expect(harness.controller.getPublication().formats.story).toMatchObject({ variant: 'variant-q', theme: 'white' });
    const callsAfterVariant = harness.api.resolveEditorRenderer.mock.calls.length;
    await harness.elements.themes.children[0].dispatch('click');
    expect(harness.controller.getPublication().formats.story.theme).toBe('white');
    expect(harness.api.resolveEditorRenderer).toHaveBeenCalledTimes(callsAfterVariant);
    expect(harness.legacyBridge.applyPublicationContent).toHaveBeenLastCalledWith(expect.objectContaining({
      theme: 'white', activeFormat: 'story',
    }));
    expect(harness.elements.downloadCurrent.disabled).toBe(false);
    expect(harness.elements.status.statusText.textContent).toBe('Pronto');
  });

  test('theme ready blocks download immediately until the current snapshot is applied', async () => {
    let finishTheme; let runtimeTheme = 'green';
    const harness = setup();
    await harness.controller.initialize();
    harness.legacyBridge.applyPublicationContent.mockImplementationOnce(({ theme, assertCurrent }) => (
      new Promise(resolve => {
        finishTheme = () => { assertCurrent(); runtimeTheme = theme; resolve(); };
      })
    ));

    const pendingTheme = harness.controller.selectTheme('black');
    expect(harness.controller.getPublication().formats.story.theme).toBe('black');
    expect(harness.elements.themes.children.find(button => button.dataset.themeId === 'black')
      .attributes['aria-pressed']).toBe('true');
    expect(harness.disableReasons.has('content-sync')).toBe(true);
    expect(harness.elements.downloadCurrent.disabled).toBe(true);
    expect(harness.elements.status.statusText.textContent).toBe('Atualizando preview');
    expect(runtimeTheme).toBe('green');

    finishTheme();
    await pendingTheme;
    expect(runtimeTheme).toBe('black');
    expect(harness.disableReasons.has('content-sync')).toBe(false);
    expect(harness.elements.downloadCurrent.disabled).toBe(false);
    expect(harness.elements.status.statusText.textContent).toBe('Pronto');
  });

  test('theme B stale cannot overwrite a newer completed theme C', async () => {
    let finishB; let finishC; let runtimeTheme = 'green';
    const harness = setup();
    await harness.controller.initialize();
    harness.legacyBridge.applyPublicationContent.mockReset()
      .mockImplementationOnce(({ theme, assertCurrent }) => new Promise((resolve, reject) => {
        finishB = () => {
          try { assertCurrent(); runtimeTheme = theme; resolve(); } catch (error) { reject(error); }
        };
      }))
      .mockImplementationOnce(({ theme, assertCurrent }) => new Promise(resolve => {
        finishC = () => { assertCurrent(); runtimeTheme = theme; resolve(); };
      }));

    const pendingB = harness.controller.selectTheme('black');
    const pendingC = harness.controller.selectTheme('white');
    finishC();
    await pendingC;
    finishB();
    await pendingB;

    expect(harness.controller.getPublication().formats.story.theme).toBe('white');
    expect(runtimeTheme).toBe('white');
    expect(harness.elements.status.statusText.textContent).toBe('Pronto');
    expect(harness.elements.downloadCurrent.disabled).toBe(false);
  });

  test('newer slider sync applies the current theme and adjustment together', async () => {
    let finishTheme; let finishSlider;
    let runtimeSnapshot = { theme: 'green', zoom: 1 };
    const harness = setup();
    await harness.controller.initialize();
    harness.legacyBridge.applyPublicationContent.mockReset()
      .mockImplementationOnce(({ theme, imageAdjustments, assertCurrent }) => new Promise((resolve, reject) => {
        finishTheme = () => {
          try {
            assertCurrent();
            runtimeSnapshot = { theme, zoom: imageAdjustments.zoom };
            resolve();
          } catch (error) { reject(error); }
        };
      }))
      .mockImplementationOnce(({ theme, imageAdjustments, assertCurrent }) => new Promise(resolve => {
        finishSlider = () => {
          assertCurrent();
          runtimeSnapshot = { theme, zoom: imageAdjustments.zoom };
          resolve();
        };
      }));

    const pendingTheme = harness.controller.selectTheme('black');
    harness.adjustmentInputs[0].value = '1.4';
    const pendingSlider = harness.adjustmentInputs[0].dispatch('input');
    finishSlider();
    await pendingSlider;
    finishTheme();
    await pendingTheme;

    expect(runtimeSnapshot).toEqual({ theme: 'black', zoom: 1.4 });
    expect(harness.elements.status.statusText.textContent).toBe('Pronto');
    expect(harness.elements.downloadCurrent.disabled).toBe(false);
  });

  test('pending Feed theme cannot touch Story after format switch', async () => {
    let finishFeedTheme; let runtimeFormat = null; let runtimeTheme = null;
    const harness = setup({ api: { getEditorCatalog: jest.fn().mockResolvedValue(multiFormatCatalog) } });
    harness.legacyBridge.selectRenderer.mockImplementation(({ activeFormat, theme }) => {
      runtimeFormat = activeFormat; runtimeTheme = theme; return Promise.resolve();
    });
    await harness.controller.initialize();
    await harness.controller.selectFormat('feed');
    harness.legacyBridge.applyPublicationContent.mockImplementationOnce(({ theme, assertCurrent }) => (
      new Promise(resolve => {
        finishFeedTheme = () => {
          try { assertCurrent(); runtimeFormat = 'feed'; runtimeTheme = theme; } catch (_error) {}
          resolve();
        };
      })
    ));

    const pendingFeedTheme = harness.controller.selectTheme('navy');
    await harness.controller.selectFormat('story');
    expect(runtimeFormat).toBe('story');
    expect(runtimeTheme).toBe('green');
    finishFeedTheme();
    await pendingFeedTheme;

    expect(harness.controller.getActiveFormat()).toBe('story');
    expect(runtimeFormat).toBe('story');
    expect(runtimeTheme).toBe('green');
    expect(harness.elements.status.statusText.textContent).toBe('Pronto');
    expect(harness.elements.downloadCurrent.disabled).toBe(false);
  });

  test('theme sync failure keeps publication and blocks export', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const harness = setup();
    await harness.controller.initialize();
    harness.legacyBridge.applyPublicationContent.mockRejectedValueOnce(new Error('theme failed'));

    await harness.controller.selectTheme('black');

    expect(harness.controller.getPublication().formats.story.theme).toBe('black');
    expect(harness.elements.status.statusText.textContent).not.toBe('Pronto');
    expect(harness.disableReasons.has('content-sync')).toBe(true);
    expect(harness.elements.downloadCurrent.disabled).toBe(true);
    expect(errorSpy).toHaveBeenCalledWith('Erro ao sincronizar tema:', expect.any(Error));
    errorSpy.mockRestore();
  });

  test('theme durante resolução pendente não declara ready nem libera download', async () => {
    let resolveVariant;
    const pendingVariant = new Promise(resolve => { resolveVariant = resolve; });
    const harness = setup();
    await harness.controller.initialize();
    harness.api.resolveEditorRenderer.mockReturnValueOnce(pendingVariant);

    const changingVariant = harness.controller.selectVariant('variant-q');
    expect(harness.elements.downloadCurrent.disabled).toBe(true);
    expect(harness.elements.status.statusText.textContent).toBe('Atualizando preview');

    harness.controller.selectTheme('white');
    expect(harness.controller.getPublication().formats.story.theme).toBe('white');
    expect(harness.elements.status.statusText.textContent).toBe('Atualizando preview');
    expect(harness.elements.downloadCurrent.disabled).toBe(true);

    resolveVariant({ template: 'renderer-q', page: 'index', themes: [{ id: 'white', label: 'White' }] });
    await changingVariant;
    expect(harness.elements.status.statusText.textContent).toBe('Pronto');
    expect(harness.elements.downloadCurrent.disabled).toBe(false);
  });

  test('edição de todos os campos alimenta publication', async () => {
    const harness = setup();
    await harness.controller.initialize();
    for (const field of harness.fields) {
      field.value = `value-${field.dataset.field}`;
      await field.dispatch('input');
    }
    expect(harness.controller.getPublication().content).toEqual({
      url: 'value-url', title: 'value-title', subtitle: 'value-subtitle', tag: 'value-tag', image: 'value-image',
    });
  });

  test('resposta tardia de A não vence B', async () => {
    let releaseA;
    const pendingA = new Promise(resolve => { releaseA = resolve; });
    const harness = setup({ api: {
      resolveEditorRenderer: jest.fn()
        .mockResolvedValueOnce({ template: 'initial', page: 'index', themes: [] })
        .mockReturnValueOnce(pendingA)
        .mockResolvedValueOnce({ template: 'renderer-b', page: 'index', themes: [] }),
    } });
    await harness.controller.initialize();
    const a = harness.controller.selectVariant('variant-z');
    const b = harness.controller.selectVariant('variant-q');
    await b;
    releaseA({ template: 'renderer-a', page: 'index', themes: [] });
    await a;
    expect(harness.controller.getRenderer().template).toBe('renderer-b');
    expect(harness.legacyBridge.selectRenderer).not.toHaveBeenCalledWith(expect.objectContaining({ renderer: expect.objectContaining({ template: 'renderer-a' }) }));
    expect(harness.elements.status.statusText.textContent).toBe('Pronto');
    expect(harness.elements.downloadCurrent.disabled).toBe(false);
  });

  test('ponte A já iniciada não consegue marcar ready depois que B conclui', async () => {
    let finishA;
    let finishB;
    const bridgeA = new Promise(resolve => { finishA = resolve; });
    const bridgeB = new Promise(resolve => { finishB = resolve; });
    const harness = setup();
    await harness.controller.initialize();
    harness.api.resolveEditorRenderer.mockReset()
      .mockResolvedValueOnce({ template: 'renderer-a', page: 'index', themes: [] })
      .mockResolvedValueOnce({ template: 'renderer-b', page: 'index', themes: [] });
    harness.legacyBridge.selectRenderer.mockReset()
      .mockReturnValueOnce(bridgeA)
      .mockReturnValueOnce(bridgeB);

    const a = harness.controller.selectVariant('variant-z');
    await Promise.resolve();
    const b = harness.controller.selectVariant('variant-q');
    await Promise.resolve();
    expect(harness.legacyBridge.selectRenderer).toHaveBeenCalledTimes(2);
    expect(harness.elements.downloadCurrent.disabled).toBe(true);

    finishB();
    await b;
    expect(harness.controller.getRenderer().template).toBe('renderer-b');
    expect(harness.controller.getPreviewState()).toBe('ready');
    expect(harness.elements.downloadCurrent.disabled).toBe(false);

    finishA();
    await a;
    expect(harness.controller.getRenderer().template).toBe('renderer-b');
    expect(harness.elements.status.statusText.textContent).toBe('Pronto');
    expect(harness.elements.downloadCurrent.disabled).toBe(false);
  });

  test.each([
    ['falha de API', { getEditorCatalog: jest.fn().mockRejectedValue(new Error('offline')) }, 'Catálogo indisponível'],
    ['catálogo vazio', { getEditorCatalog: jest.fn().mockResolvedValue({ brands: [] }) }, 'Nenhuma variante Story disponível'],
  ])('%s atualiza status sem lançar', async (_name, api, expected) => {
    const harness = setup({ api });
    await expect(harness.controller.initialize()).resolves.toBeUndefined();
    expect(harness.elements.status.statusText.textContent).toBe(expected);
  });

  test('falha de resolução preserva UI e informa preview', async () => {
    const harness = setup({ api: { resolveEditorRenderer: jest.fn().mockRejectedValue(new Error('failed')) } });
    await expect(harness.controller.initialize()).resolves.toBeUndefined();
    expect(harness.elements.status.statusText.textContent).toBe('Preview não pôde ser carregado');
    expect(harness.controller.getPublication().formats.story.variant).toBe('variant-z');
    expect(harness.controller.getPreviewState()).toBe('error');
    expect(harness.elements.downloadCurrent.disabled).toBe(true);
  });

  test('falha de B não reabilita download do renderer A', async () => {
    const harness = setup();
    await harness.controller.initialize();
    harness.api.resolveEditorRenderer.mockRejectedValueOnce(new Error('failed B'));
    await harness.controller.selectVariant('variant-q');
    expect(harness.controller.getPublication().formats.story.variant).toBe('variant-q');
    expect(harness.elements.status.statusText.textContent).toBe('Preview não pôde ser carregado');
    expect(harness.elements.downloadCurrent.disabled).toBe(true);
  });

  test('Nova arte limpa conteúdo e reaplica o default Story', async () => {
    const harness = setup();
    await harness.controller.initialize();
    harness.fields[1].value = 'Título'; await harness.fields[1].dispatch('input');
    await harness.controller.selectVariant('variant-q');
    await harness.elements.newArtwork.dispatch('click');
    expect(harness.controller.getPublication()).toMatchObject({
      content: { title: '' },
      formats: { story: {
        variant: 'variant-z', theme: 'green', imageAdjustments: { zoom: 1, x: 50, y: 50 },
      } },
    });
    expect(harness.api.getEditorCatalog).toHaveBeenCalledTimes(1);
    expect(harness.legacyBridge.selectRenderer).toHaveBeenLastCalledWith(expect.objectContaining({
      renderer: expect.objectContaining({ template: 'renderer-z' }),
    }));
  });

  test('Nova arte mantém download bloqueado até o renderer default concluir', async () => {
    let finishReset;
    const pendingReset = new Promise(resolve => { finishReset = resolve; });
    const harness = setup();
    await harness.controller.initialize();
    harness.api.resolveEditorRenderer.mockReturnValueOnce(pendingReset);
    const reset = harness.controller.reset();
    expect(harness.controller.getPreviewState()).toBe('loading');
    expect(harness.elements.downloadCurrent.disabled).toBe(true);
    expect(harness.elements.status.statusText.textContent).not.toBe('Pronto');
    finishReset({ template: 'renderer-default', page: 'index', themes: [] });
    await reset;
    expect(harness.controller.getPreviewState()).toBe('ready');
    expect(harness.elements.downloadCurrent.disabled).toBe(false);
  });

  test('importa noticia para publication, campos e preview sem resolver renderer', async () => {
    const harness = setup(); await harness.controller.initialize();
    const selectionBeforeImport = {
      brand: harness.controller.getPublication().brand,
      family: harness.controller.getPublication().family,
      format: { ...harness.controller.getPublication().formats.story },
    };
    harness.fields[0].value = 'https://example.com/news'; await harness.fields[0].dispatch('input');
    const resolveCalls = harness.api.resolveEditorRenderer.mock.calls.length;
    await harness.elements.importNews.dispatch('click');
    expect(harness.controller.getPublication().content).toEqual({ url: 'https://example.com/news', title: 'Imported title', subtitle: 'Imported subtitle', tag: 'Imported tag', image: 'image-data' });
    expect(harness.fields.map(field => field.value)).toEqual(['https://example.com/news', 'Imported title', 'Imported subtitle', 'Imported tag', 'image-data']);
    expect(harness.legacyBridge.applyPublicationContent).toHaveBeenCalledWith(expect.objectContaining({ importedImage: { url: 'https://example.com/news', value: 'image-data' } }));
    expect(harness.api.resolveEditorRenderer).toHaveBeenCalledTimes(resolveCalls);
    expect(harness.controller.getPublication()).toMatchObject({
      brand: selectionBeforeImport.brand,
      family: selectionBeforeImport.family,
      formats: { story: selectionBeforeImport.format },
    });
    expect(harness.legacyBridge.setNewsImportPending.mock.calls.map(call => call[0])).toEqual([false, false, true, false]);
  });

  test('edicao manual depois da importacao permanece na publication', async () => {
    const harness = setup(); await harness.controller.initialize();
    harness.fields[0].value = 'https://example.com/news'; await harness.fields[0].dispatch('input');
    await harness.controller.importNews();
    harness.fields[1].value = 'Titulo manual posterior'; await harness.fields[1].dispatch('input');
    expect(harness.controller.getPublication().content.title).toBe('Titulo manual posterior');
  });

  test('falha da API de importacao preserva publication e preview anteriores', async () => {
    const importNews = jest.fn().mockRejectedValue(new Error('image timeout'));
    const harness = setup({ legacyBridge: { importNews } });
    await harness.controller.initialize();
    for (const [index, value] of [
      [0, 'https://example.com/news'],
      [1, 'Titulo anterior'],
      [2, 'Subtitulo anterior'],
      [3, 'Tag anterior'],
      [4, 'https://example.com/anterior.jpg'],
    ]) {
      harness.fields[index].value = value;
      await harness.fields[index].dispatch('input');
    }
    const publicationBefore = harness.controller.getPublication();
    const previewCallsBefore = harness.legacyBridge.applyPublicationContent.mock.calls.length;

    await harness.controller.importNews();

    expect(harness.controller.getPublication()).toEqual(publicationBefore);
    expect(harness.legacyBridge.applyPublicationContent).toHaveBeenCalledTimes(previewCallsBefore);
    expect(harness.elements.status.statusText.textContent).not.toBe('Pronto');
    expect(harness.elements.importNews.disabled).toBe(false);
  });

  test('resultado parcial preserva campos ausentes', async () => {
    const harness = setup({ legacyBridge: { importNews: jest.fn().mockResolvedValue({ h1: 'Novo', bg: 'image-data', h2: '', chapeu: null }) } });
    await harness.controller.initialize();
    for (const [index, value] of [[0, 'https://example.com/a'], [2, 'Sub manual'], [3, 'Tag manual']]) { harness.fields[index].value = value; await harness.fields[index].dispatch('input'); }
    await harness.controller.importNews();
    expect(harness.controller.getPublication().content).toMatchObject({ title: 'Novo', subtitle: 'Sub manual', tag: 'Tag manual', image: 'image-data' });
  });

  test('resultado vazio permite retry', async () => {
    const importNews = jest.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ h1: 'Retry' });
    const harness = setup({ legacyBridge: { importNews } }); await harness.controller.initialize();
    harness.fields[0].value = 'https://example.com/a'; await harness.fields[0].dispatch('input');
    await harness.controller.importNews();
    expect(harness.controller.getPublication().content.title).toBe('');
    await harness.controller.importNews();
    expect(importNews).toHaveBeenCalledTimes(2);
    expect(harness.controller.getPublication().content.title).toBe('Retry');
  });

  test('A lenta nao sobrescreve B rapida', async () => {
    let resolveA;
    const importNews = jest.fn().mockReturnValueOnce(new Promise(resolve => { resolveA = resolve; })).mockResolvedValueOnce({ h1: 'B' });
    const harness = setup({ legacyBridge: { importNews } }); await harness.controller.initialize();
    harness.fields[0].value = 'https://example.com/a'; await harness.fields[0].dispatch('input'); const a = harness.controller.importNews();
    harness.fields[0].value = 'https://example.com/b'; await harness.fields[0].dispatch('input'); await harness.controller.importNews();
    resolveA({ h1: 'A' }); await a;
    expect(harness.controller.getPublication().content).toMatchObject({ url: 'https://example.com/b', title: 'B' });
  });

  test('URL alterada sem nova importacao descarta resposta antiga', async () => {
    let resolveA;
    const harness = setup({ legacyBridge: { importNews: jest.fn().mockReturnValue(new Promise(resolve => { resolveA = resolve; })) } }); await harness.controller.initialize();
    harness.fields[0].value = 'https://example.com/a'; await harness.fields[0].dispatch('input'); const pending = harness.controller.importNews();
    harness.fields[0].value = 'https://example.com/b'; await harness.fields[0].dispatch('input'); resolveA({ h1: 'A' }); await pending;
    expect(harness.controller.getPublication().content).toMatchObject({ url: 'https://example.com/b', title: '' });
  });

  test('Nova arte invalida importacao pendente', async () => {
    let resolveA;
    const harness = setup({ legacyBridge: { importNews: jest.fn().mockReturnValue(new Promise(resolve => { resolveA = resolve; })) } }); await harness.controller.initialize();
    harness.fields[0].value = 'https://example.com/a'; await harness.fields[0].dispatch('input'); const pending = harness.controller.importNews();
    await harness.controller.reset(); resolveA({ h1: 'A' }); await pending;
    expect(harness.controller.getPublication().content).toEqual({ url: '', title: '', subtitle: '', tag: '', image: '' });
  });

  test('troca de variante durante importacao conserva renderer novo', async () => {
    let resolveNews;
    const harness = setup({ legacyBridge: { importNews: jest.fn().mockReturnValue(new Promise(resolve => { resolveNews = resolve; })) } }); await harness.controller.initialize();
    harness.fields[0].value = 'https://example.com/a'; await harness.fields[0].dispatch('input'); const pending = harness.controller.importNews();
    await harness.controller.selectVariant('variant-q'); resolveNews({ h1: 'A' }); await pending;
    expect(harness.controller.getPublication()).toMatchObject({ content: { title: 'A' }, formats: { story: { variant: 'variant-q', theme: 'white' } } });
  });

  test('URL B bloqueia download ate o sync e descarta resposta A tardia', async () => {
    let resolveImportA; let resolveSyncB;
    const harness = setup({ legacyBridge: { importNews: jest.fn().mockReturnValue(new Promise(resolve => { resolveImportA = resolve; })) } });
    await harness.controller.initialize();
    harness.fields[0].value = 'https://example.com/a'; await harness.fields[0].dispatch('input'); await Promise.resolve();
    harness.legacyBridge.applyPublicationContent.mockClear().mockReturnValueOnce(new Promise(resolve => { resolveSyncB = resolve; }));
    const pendingA = harness.controller.importNews();
    harness.fields[0].value = 'https://example.com/b'; await harness.fields[0].dispatch('input');
    expect(harness.controller.getPublication().content.url).toBe('https://example.com/b');
    expect(harness.disableReasons.has('content-sync')).toBe(true);
    expect(harness.elements.downloadCurrent.disabled).toBe(true);
    expect(harness.elements.status.statusText.textContent).toBe('Atualizando preview');
    resolveSyncB(); await Promise.resolve(); await Promise.resolve();
    expect(harness.disableReasons.has('content-sync')).toBe(false);
    expect(harness.elements.status.statusText.textContent).toBe('Pronto');
    expect(harness.elements.downloadCurrent.disabled).toBe(false);
    resolveImportA({ h1: 'A tardia' }); await pendingA;
    expect(harness.controller.getPublication().content).toMatchObject({ url: 'https://example.com/b', title: '' });
    expect(harness.elements.status.statusText.textContent).toBe('Pronto');
    expect(harness.elements.downloadCurrent.disabled).toBe(false);
    expect(harness.legacyBridge.applyPublicationContent).toHaveBeenCalledTimes(1);
  });

  test('erro stale de A depois do sync B e silencioso', async () => {
    let rejectImportA;
    const harness = setup({ legacyBridge: { importNews: jest.fn().mockReturnValue(new Promise((_resolve, reject) => { rejectImportA = reject; })) } });
    await harness.controller.initialize();
    harness.fields[0].value = 'https://example.com/a'; await harness.fields[0].dispatch('input');
    const pendingA = harness.controller.importNews();
    harness.fields[0].value = 'https://example.com/b'; await harness.fields[0].dispatch('input');
    await Promise.resolve(); await Promise.resolve();
    rejectImportA(new Error('falha A')); await pendingA;
    expect(harness.elements.status.statusText.textContent).toBe('Pronto');
    expect(harness.elements.downloadCurrent.disabled).toBe(false);
  });

  test('falha do content sync mantem publication e download bloqueado', async () => {
    const harness = setup(); await harness.controller.initialize();
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    harness.legacyBridge.applyPublicationContent.mockRejectedValueOnce(new Error('runtime failed'));
    harness.fields[0].value = 'https://example.com/b'; await harness.fields[0].dispatch('input');
    await Promise.resolve(); await Promise.resolve();
    expect(harness.controller.getPublication().content.url).toBe('https://example.com/b');
    expect(harness.elements.status.statusText.textContent).toBe('Preview nÃ£o pÃ´de ser atualizado');
    expect(harness.disableReasons.has('content-sync')).toBe(true);
    expect(harness.elements.downloadCurrent.disabled).toBe(true);
    consoleError.mockRestore();
  });

  test('sync antigo nao remove bloqueio nem status do sync atual', async () => {
    let resolveB; let resolveC;
    const harness = setup(); await harness.controller.initialize();
    harness.legacyBridge.applyPublicationContent.mockReset()
      .mockReturnValueOnce(new Promise(resolve => { resolveB = resolve; }))
      .mockReturnValueOnce(new Promise(resolve => { resolveC = resolve; }));
    harness.fields[1].value = 'B'; await harness.fields[1].dispatch('input');
    harness.fields[1].value = 'C'; await harness.fields[1].dispatch('input');
    resolveB(); await Promise.resolve(); await Promise.resolve();
    expect(harness.disableReasons.has('content-sync')).toBe(true);
    expect(harness.elements.status.statusText.textContent).toBe('Atualizando preview');
    resolveC(); await Promise.resolve(); await Promise.resolve();
    expect(harness.disableReasons.has('content-sync')).toBe(false);
    expect(harness.elements.status.statusText.textContent).toBe('Pronto');
  });

  test('sync importado stale nao toma status do sync manual mais novo', async () => {
    let resolveImportedSync; let resolveManualSync;
    let runtimeTitle = '';
    const harness = setup();
    await harness.controller.initialize();
    harness.fields[0].value = 'https://example.com/news';
    await harness.fields[0].dispatch('input');
    await Promise.resolve();
    await Promise.resolve();

    harness.legacyBridge.applyPublicationContent.mockReset()
      .mockImplementationOnce(({ content, assertCurrent }) => new Promise(resolve => {
        resolveImportedSync = () => {
          try {
            assertCurrent();
            runtimeTitle = content.title;
            resolve();
          } catch (error) {
            resolve(Promise.reject(error));
          }
        };
      }))
      .mockImplementationOnce(({ content, assertCurrent }) => new Promise(resolve => {
        resolveManualSync = () => {
          assertCurrent();
          runtimeTitle = content.title;
          resolve();
        };
      }));

    const pendingImport = harness.controller.importNews();
    await Promise.resolve();
    await Promise.resolve();
    harness.fields[1].value = 'Titulo manual';
    await harness.fields[1].dispatch('input');

    resolveImportedSync();
    await pendingImport;
    expect(harness.controller.getPublication().content.title).toBe('Titulo manual');
    expect(runtimeTitle).not.toBe('Imported title');
    expect(harness.elements.status.statusText.textContent).toBe('Atualizando preview');
    expect(harness.disableReasons.has('news-import')).toBe(false);
    expect(harness.disableReasons.has('content-sync')).toBe(true);
    expect(harness.elements.downloadCurrent.disabled).toBe(true);

    resolveManualSync();
    await Promise.resolve();
    await Promise.resolve();
    expect(runtimeTitle).toBe('Titulo manual');
    expect(harness.elements.status.statusText.textContent).toBe('Pronto');
    expect(harness.disableReasons.has('content-sync')).toBe(false);
    expect(harness.elements.downloadCurrent.disabled).toBe(false);
  });

  test('import, manual image and framing reset preserve their separate state', async () => {
    const harness = setup();
    await harness.controller.initialize();
    for (const [index, value] of [[0, '1.6'], [1, '30'], [2, '70']]) {
      harness.adjustmentInputs[index].value = value;
      await harness.adjustmentInputs[index].dispatch('input');
    }
    harness.fields[0].value = 'https://example.com/news';
    await harness.fields[0].dispatch('input');
    await harness.controller.importNews();
    expect(harness.controller.getPublication().formats.story.imageAdjustments)
      .toEqual({ zoom: 1.6, x: 30, y: 70 });

    harness.fields[4].value = 'https://example.com/manual.jpg';
    await harness.fields[4].dispatch('input');
    const beforeReset = harness.controller.getPublication();
    await harness.controller.resetCurrentImageAdjustments();
    expect(harness.controller.getPublication()).toMatchObject({
      brand: beforeReset.brand,
      family: beforeReset.family,
      content: beforeReset.content,
      formats: { story: {
        variant: beforeReset.formats.story.variant,
        theme: beforeReset.formats.story.theme,
        imageAdjustments: { zoom: 1, x: 50, y: 50 },
      } },
    });
  });

  test('alternates Story and Feed preserving visual state and shared content', async () => {
    const harness = setup();
    await harness.controller.initialize();
    harness.adjustmentInputs[0].value = '1.5';
    await harness.adjustmentInputs[0].dispatch('input');
    harness.fields[1].value = 'Titulo compartilhado';
    await harness.fields[1].dispatch('input');

    await harness.controller.selectFormat('feed');
    expect(harness.controller.getActiveFormat()).toBe('feed');
    expect(harness.elements.feed.attributes['aria-pressed']).toBe('true');
    expect(harness.elements.story.attributes['aria-pressed']).toBe('false');
    expect(harness.controller.getPublication()).toMatchObject({
      content: { title: 'Titulo compartilhado' },
      formats: {
        story: { variant: 'variant-z', theme: 'green', imageAdjustments: { zoom: 1.5, x: 50, y: 50 } },
        feed: { variant: 'feed-only', theme: null, imageAdjustments: { zoom: 1, x: 50, y: 50 } },
      },
    });
    expect(harness.elements.previewViewport.style.aspectRatio).toBe('1080 / 1350');
    harness.adjustmentInputs[0].value = '1.2';
    await harness.adjustmentInputs[0].dispatch('input');

    await harness.controller.selectFormat('story');
    expect(harness.adjustmentInputs[0].value).toBe('1.5');
    await harness.controller.selectFormat('feed');
    expect(harness.adjustmentInputs[0].value).toBe('1.2');
    expect(harness.legacyBridge.selectRenderer).toHaveBeenLastCalledWith(expect.objectContaining({
      activeFormat: 'feed', content: expect.objectContaining({ title: 'Titulo compartilhado' }),
      imageAdjustments: { zoom: 1.2, x: 50, y: 50 },
    }));
  });

  test('applies the current theme when Feed resolution finishes', async () => {
    let resolveFeed;
    const harness = setup({ api: {
      getEditorCatalog: jest.fn().mockResolvedValue(multiFormatCatalog),
      resolveEditorRenderer: jest.fn()
        .mockResolvedValueOnce({ template: 'renderer-story', page: 'index', dimensions: { width: 1080, height: 1920 }, themes: [] })
        .mockImplementationOnce(() => new Promise(resolve => { resolveFeed = resolve; })),
    } });
    await harness.controller.initialize();

    const pendingFeed = harness.controller.selectFormat('feed');
    harness.controller.selectTheme('navy');
    expect(harness.controller.getPublication().formats.feed.theme).toBe('navy');
    expect(harness.elements.downloadCurrent.disabled).toBe(true);
    resolveFeed({ template: 'renderer-feed', page: 'index', dimensions: { width: 1080, height: 1350 }, themes: [] });
    await pendingFeed;

    expect(harness.api.resolveEditorRenderer).toHaveBeenCalledTimes(2);
    expect(harness.legacyBridge.selectRenderer).toHaveBeenLastCalledWith(expect.objectContaining({
      activeFormat: 'feed', theme: 'navy',
    }));
    expect(harness.elements.status.statusText.textContent).toBe('Pronto');
    expect(harness.elements.downloadCurrent.disabled).toBe(false);
  });

  test('applies current zoom and position before pending Feed becomes ready', async () => {
    let resolveFeed;
    const harness = setup({ api: {
      getEditorCatalog: jest.fn().mockResolvedValue(multiFormatCatalog),
      resolveEditorRenderer: jest.fn()
        .mockResolvedValueOnce({ template: 'renderer-story', page: 'index', dimensions: { width: 1080, height: 1920 }, themes: [] })
        .mockImplementationOnce(() => new Promise(resolve => { resolveFeed = resolve; })),
    } });
    await harness.controller.initialize();

    const pendingFeed = harness.controller.selectFormat('feed');
    for (const [index, value] of [[0, '1.4'], [1, '20'], [2, '75']]) {
      harness.adjustmentInputs[index].value = value;
      await harness.adjustmentInputs[index].dispatch('input');
    }
    expect(harness.legacyBridge.applyPublicationContent).not.toHaveBeenCalledWith(expect.objectContaining({
      activeFormat: 'feed',
    }));
    resolveFeed({ template: 'renderer-feed', page: 'index', dimensions: { width: 1080, height: 1350 }, themes: [] });
    await pendingFeed;

    expect(harness.legacyBridge.selectRenderer).toHaveBeenLastCalledWith(expect.objectContaining({
      activeFormat: 'feed', imageAdjustments: { zoom: 1.4, x: 20, y: 75 },
    }));
    expect(harness.elements.status.statusText.textContent).toBe('Pronto');
    expect(harness.elements.downloadCurrent.disabled).toBe(false);
  });

  test('applies content edited while Feed resolution is pending', async () => {
    let resolveFeed;
    const harness = setup({ api: {
      getEditorCatalog: jest.fn().mockResolvedValue(multiFormatCatalog),
      resolveEditorRenderer: jest.fn()
        .mockResolvedValueOnce({ template: 'renderer-story', page: 'index', dimensions: { width: 1080, height: 1920 }, themes: [] })
        .mockImplementationOnce(() => new Promise(resolve => { resolveFeed = resolve; })),
    } });
    await harness.controller.initialize();

    const pendingFeed = harness.controller.selectFormat('feed');
    harness.fields[1].value = 'Titulo atual durante resolve';
    await harness.fields[1].dispatch('input');
    resolveFeed({ template: 'renderer-feed', page: 'index', dimensions: { width: 1080, height: 1350 }, themes: [] });
    await pendingFeed;

    expect(harness.legacyBridge.selectRenderer).toHaveBeenLastCalledWith(expect.objectContaining({
      activeFormat: 'feed', content: expect.objectContaining({ title: 'Titulo atual durante resolve' }),
    }));
    expect(harness.elements.status.statusText.textContent).toBe('Pronto');
  });

  test('reapplies changes made while the resolved Feed renderer is loading before ready', async () => {
    let finishFeedRenderer;
    const harness = setup({ api: { getEditorCatalog: jest.fn().mockResolvedValue(multiFormatCatalog) } });
    harness.legacyBridge.selectRenderer.mockImplementation(({ activeFormat }) => {
      if (activeFormat !== 'feed') return Promise.resolve();
      return new Promise(resolve => { finishFeedRenderer = resolve; });
    });
    await harness.controller.initialize();

    const pendingFeed = harness.controller.selectFormat('feed');
    await Promise.resolve();
    expect(harness.elements.downloadCurrent.disabled).toBe(true);
    for (const [index, value] of [[0, '1.4'], [1, '20'], [2, '75']]) {
      harness.adjustmentInputs[index].value = value;
      await harness.adjustmentInputs[index].dispatch('input');
    }
    harness.controller.selectTheme('navy');
    expect(harness.elements.status.statusText.textContent).toBe('Atualizando preview');

    finishFeedRenderer();
    await pendingFeed;

    expect(harness.legacyBridge.applyPublicationContent).toHaveBeenLastCalledWith(expect.objectContaining({
      activeFormat: 'feed', theme: 'navy', imageAdjustments: { zoom: 1.4, x: 20, y: 75 },
    }));
    expect(harness.elements.status.statusText.textContent).toBe('Pronto');
    expect(harness.elements.downloadCurrent.disabled).toBe(false);
  });

  test('late Feed adjustment sync cannot touch ready Story', async () => {
    let finishFeedSync; let runtimeFormat = null;
    const harness = setup({ api: { getEditorCatalog: jest.fn().mockResolvedValue(multiFormatCatalog) } });
    harness.legacyBridge.selectRenderer.mockImplementation(({ activeFormat }) => {
      runtimeFormat = activeFormat;
      return Promise.resolve();
    });
    await harness.controller.initialize();
    await harness.controller.selectFormat('feed');
    harness.legacyBridge.applyPublicationContent.mockImplementationOnce(({ assertCurrent }) => (
      new Promise(resolve => {
        finishFeedSync = () => {
          try { assertCurrent(); runtimeFormat = 'feed-adjustment'; } catch (_error) {}
          resolve();
        };
      })
    ));

    harness.adjustmentInputs[0].value = '1.4';
    await harness.adjustmentInputs[0].dispatch('input');
    const pendingStory = harness.controller.selectFormat('story');
    await pendingStory;
    expect(runtimeFormat).toBe('story');
    finishFeedSync();
    await Promise.resolve(); await Promise.resolve();

    expect(harness.controller.getActiveFormat()).toBe('story');
    expect(runtimeFormat).toBe('story');
    expect(harness.adjustmentInputs[0].value).toBe('1');
    expect(harness.elements.status.statusText.textContent).toBe('Pronto');
    expect(harness.elements.downloadCurrent.disabled).toBe(false);
  });

  test('imports with Feed active and shares content with Story without resolving again', async () => {
    const harness = setup({ api: { getEditorCatalog: jest.fn().mockResolvedValue(multiFormatCatalog) } });
    await harness.controller.initialize();
    await harness.controller.selectFormat('feed');
    const storyBefore = { ...harness.controller.getPublication().formats.story };
    const resolveCalls = harness.api.resolveEditorRenderer.mock.calls.length;
    harness.fields[0].value = 'https://example.com/feed-news';
    await harness.fields[0].dispatch('input');
    await harness.controller.importNews();

    expect(harness.controller.getActiveFormat()).toBe('feed');
    expect(harness.controller.getPublication().content).toMatchObject({
      title: 'Imported title', subtitle: 'Imported subtitle', tag: 'Imported tag', image: 'image-data',
    });
    expect(harness.api.resolveEditorRenderer).toHaveBeenCalledTimes(resolveCalls);
    expect(harness.legacyBridge.applyPublicationContent).toHaveBeenLastCalledWith(expect.objectContaining({
      activeFormat: 'feed', content: expect.objectContaining({ title: 'Imported title' }),
    }));

    await harness.controller.selectFormat('story');
    expect(harness.controller.getPublication().content.title).toBe('Imported title');
    expect(harness.controller.getPublication().formats.story).toMatchObject(storyBefore);
    expect(harness.legacyBridge.selectRenderer).toHaveBeenLastCalledWith(expect.objectContaining({
      activeFormat: 'story', content: expect.objectContaining({ title: 'Imported title' }),
    }));
  });

  test('late Feed resolution cannot replace Story after a rapid format switch', async () => {
    let resolveFeed;
    const harness = setup();
    await harness.controller.initialize();
    harness.api.resolveEditorRenderer.mockImplementation(selection => {
      if (selection.format === 'feed') return new Promise(resolve => { resolveFeed = resolve; });
      return Promise.resolve({ template: 'renderer-z', page: 'index', dimensions: { width: 1080, height: 1920 }, themes: [] });
    });

    const pendingFeed = harness.controller.selectFormat('feed');
    const pendingStory = harness.controller.selectFormat('story');
    await pendingStory;
    resolveFeed({ template: 'renderer-feed', page: 'index', dimensions: { width: 1080, height: 1350 }, themes: [] });
    await pendingFeed;

    expect(harness.controller.getActiveFormat()).toBe('story');
    expect(harness.controller.getRenderer().template).toBe('renderer-z');
    expect(harness.elements.previewViewport.style.aspectRatio).toBe('1080 / 1920');
    expect(harness.elements.status.statusText.textContent).toBe('Pronto');
  });

  test('does not render Story as Feed when the current family has no Feed', async () => {
    const harness = setup();
    await harness.controller.initialize();
    await harness.controller.selectFamily('family-two');
    await harness.controller.selectFormat('feed');
    expect(harness.controller.getActiveFormat()).toBe('feed');
    expect(harness.controller.getRenderer()).toBeNull();
    expect(harness.controller.getPreviewState()).toBe('error');
    expect(harness.legacyBridge.clearPreview).toHaveBeenLastCalledWith('feed');
    expect(harness.elements.status.statusText.textContent)
      .toBe('Feed não disponível para esta configuração');
    expect(harness.elements.downloadCurrent.disabled).toBe(true);
  });

  test('starts in Story and Compare keeps two independent real contexts', async () => {
    const harness = setup({ api: { getEditorCatalog: jest.fn().mockResolvedValue(multiFormatCatalog) } });
    await harness.controller.initialize();
    const storyRenderer = harness.controller.getRenderer('story');
    expect(harness.controller.getViewMode()).toBe('story');
    expect(harness.controller.getActiveFormat()).toBe('story');
    await harness.controller.selectViewMode('compare');
    expect(harness.controller.getViewMode()).toBe('compare');
    expect(harness.elements.feedPanel.hidden).toBe(false);
    expect(harness.elements.storyPanel.hidden).toBe(false);
    expect(harness.controller.getRenderer('story')).toBe(storyRenderer);
    expect(harness.controller.getPreviewState('feed')).toBe('ready');
    expect(harness.controller.getPreviewState('story')).toBe('ready');
  });

  test('Compare panel selection changes activeFormat and sidebar target', async () => {
    const harness = setup({ api: { getEditorCatalog: jest.fn().mockResolvedValue(multiFormatCatalog) } });
    await harness.controller.initialize();
    await harness.controller.selectViewMode('compare');
    await harness.elements.feedPanelSelector.dispatch('click');
    expect(harness.controller.getActiveFormat()).toBe('feed');
    expect(harness.controller.getViewMode()).toBe('compare');
    await harness.elements.storyPanelSelector.dispatch('click');
    expect(harness.controller.getActiveFormat()).toBe('story');
  });

  test('Compare content changes start independent Feed and Story syncs', async () => {
    let finishFeed; let finishStory;
    const harness = setup({ api: { getEditorCatalog: jest.fn().mockResolvedValue(multiFormatCatalog) } });
    await harness.controller.initialize();
    await harness.controller.selectViewMode('compare');
    harness.legacyBridge.applyPublicationContent.mockImplementation(({ activeFormat, assertCurrent }) => new Promise(resolve => {
      const finish = () => { assertCurrent(); resolve(); };
      if (activeFormat === 'feed') finishFeed = finish; else finishStory = finish;
    }));
    harness.fields[1].value = 'Compartilhado';
    await harness.fields[1].dispatch('input');
    expect(finishFeed).toEqual(expect.any(Function));
    expect(finishStory).toEqual(expect.any(Function));
    finishFeed(); await Promise.resolve();
    expect(harness.controller.getPreviewContexts().story.syncPending).toBe(true);
    finishStory(); await Promise.resolve(); await Promise.resolve();
    expect(harness.controller.getPreviewContexts().feed.syncPending).toBe(false);
    expect(harness.controller.getPreviewContexts().story.syncPending).toBe(false);
  });

  test('Nova arte invalidates both contexts and returns to Story', async () => {
    const harness = setup({ api: { getEditorCatalog: jest.fn().mockResolvedValue(multiFormatCatalog) } });
    await harness.controller.initialize();
    await harness.controller.selectViewMode('compare');
    const feedId = harness.controller.getContentSyncId('feed');
    const storyId = harness.controller.getContentSyncId('story');
    await harness.controller.reset();
    expect(harness.controller.getViewMode()).toBe('story');
    expect(harness.controller.getActiveFormat()).toBe('story');
    expect(harness.controller.getContentSyncId('feed')).toBeGreaterThan(feedId);
    expect(harness.controller.getContentSyncId('story')).toBeGreaterThan(storyId);
    expect(harness.legacyBridge.clearPreview).toHaveBeenCalledWith('feed');
    expect(harness.legacyBridge.clearPreview).toHaveBeenCalledWith('story');
  });

  test('a late Feed resolve cannot beat a newer Feed resolve or damage Story', async () => {
    let resolveA; let resolveB;
    const harness = setup({ api: { getEditorCatalog: jest.fn().mockResolvedValue(multiFormatCatalog) } });
    await harness.controller.initialize();
    harness.api.resolveEditorRenderer.mockImplementationOnce(() => new Promise(resolve => { resolveA = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { resolveB = resolve; }));
    const pendingA = harness.controller.selectFormat('feed');
    const pendingB = harness.controller.selectFormat('feed');
    resolveB({ template: 'feed-b', page: 'index', dimensions: { width: 1080, height: 1350 } });
    await pendingB;
    resolveA({ template: 'feed-a', page: 'index', dimensions: { width: 1080, height: 1350 } });
    await pendingA;
    expect(harness.controller.getRenderer('feed').template).toBe('feed-b');
    expect(harness.controller.getRenderer('story').template).toBe('renderer-z');
  });

  test('Feed resolve failure clears only Feed and leaves Story ready', async () => {
    const harness = setup({ api: { getEditorCatalog: jest.fn().mockResolvedValue(multiFormatCatalog) } });
    await harness.controller.initialize();
    harness.api.resolveEditorRenderer.mockRejectedValueOnce(new Error('feed failed'));
    await harness.controller.selectFormat('feed');
    expect(harness.controller.getRenderer('feed')).toBeNull();
    expect(harness.controller.getPreviewState('feed')).toBe('error');
    expect(harness.controller.getRenderer('story').template).toBe('renderer-z');
    expect(harness.controller.getPreviewState('story')).toBe('ready');
    expect(harness.legacyBridge.clearPreview).toHaveBeenLastCalledWith('feed');
  });

  describe('exportabilidade e mutex por formato', () => {
    async function readyCompare() {
      const harness = setup({ api: { getEditorCatalog: jest.fn().mockResolvedValue(multiFormatCatalog) } });
      await harness.controller.initialize();
      await harness.controller.selectViewMode('compare');
      harness.legacyBridge.downloadExport.mockClear();
      return harness;
    }

    test('regra central rejeita readiness, pending, seleção stale e autoridade técnica inválida', async () => {
      const harness = await readyCompare();
      expect(harness.controller.isFormatExportable('feed')).toBe(true);

      const context = harness.controller.getPreviewContexts().feed;
      context.previewState = 'error';
      expect(harness.controller.isFormatExportable('feed')).toBe(false);
      context.previewState = 'ready';
      context.syncPending = true;
      expect(harness.controller.isFormatExportable('feed')).toBe(false);
      context.syncPending = false;
      const selection = context.structuralSelection;
      context.structuralSelection = { ...selection, family: 'stale-family' };
      expect(harness.controller.isFormatExportable('feed')).toBe(false);
      context.structuralSelection = selection;
      harness.legacyBridge.isFormatExportable.mockReturnValueOnce(false);
      expect(harness.controller.isFormatExportable('feed')).toBe(false);
    });

    test('download current usa activeFormat em Compare e possui guarda programática', async () => {
      const harness = await readyCompare();
      await harness.elements.feedPanelSelector.dispatch('click');
      await harness.controller.downloadCurrent();
      expect(harness.legacyBridge.downloadExport).toHaveBeenCalledWith(
        { format: 'feed' }, 'maker-feed.png', expect.any(Function),
      );
      harness.legacyBridge.downloadExport.mockClear();
      harness.controller.getPreviewContexts().feed.previewState = 'error';
      await harness.controller.downloadCurrent();
      expect(harness.legacyBridge.downloadExport).not.toHaveBeenCalled();
    });

    test('download all exige ambos e usa authorities e filenames distintos sem resolver ou trocar formato', async () => {
      const harness = await readyCompare();
      const resolveCalls = harness.api.resolveEditorRenderer.mock.calls.length;
      const activeFormat = harness.controller.getActiveFormat();
      await harness.controller.downloadAll();
      expect(harness.legacyBridge.downloadExport.mock.calls.map(call => call.slice(0, 2))).toEqual([
        [{ format: 'feed' }, 'maker-feed.png'],
        [{ format: 'story' }, 'maker-story.png'],
      ]);
      expect(harness.api.resolveEditorRenderer).toHaveBeenCalledTimes(resolveCalls);
      expect(harness.legacyBridge.selectRenderer).toHaveBeenCalledTimes(2);
      expect(harness.controller.getActiveFormat()).toBe(activeFormat);

      harness.legacyBridge.downloadExport.mockClear();
      harness.controller.getPreviewContexts().story.previewState = 'error';
      await harness.controller.downloadAll();
      expect(harness.legacyBridge.downloadExport).not.toHaveBeenCalled();
    });

    test('download all inicia zero exports quando Feed nao esta ready', async () => {
      const harness = await readyCompare();
      harness.controller.getPreviewContexts().feed.previewState = 'error';

      await harness.controller.downloadAll();

      expect(harness.controller.isFormatExportable('story')).toBe(true);
      expect(harness.controller.isFormatExportable('feed')).toBe(false);
      expect(harness.legacyBridge.downloadExport).not.toHaveBeenCalled();
    });

    test('download all entrega frames e manifests tecnicos exatos ao PreviewExport', async () => {
      const previewExport = { downloadPreview: jest.fn().mockResolvedValue() };
      const technicalContexts = {
        feed: {
          format: 'feed', frame: { id: 'feed-frame' },
          manifestData: { id: 'feed-manifest', manifest: { dimensions: { width: 1080, height: 1350 } } },
        },
        story: {
          format: 'story', frame: { id: 'story-frame' },
          manifestData: { id: 'story-manifest', manifest: { dimensions: { width: 1080, height: 1920 } } },
        },
      };
      const harness = await readyCompare();
      harness.legacyBridge.captureExportAuthority.mockImplementation(format => technicalContexts[format]);
      harness.legacyBridge.downloadExport.mockImplementation((authority, filename) => (
        previewExport.downloadPreview(authority.frame, authority.manifestData, filename)
      ));
      const resolveCalls = harness.api.resolveEditorRenderer.mock.calls.length;
      const initializeCalls = harness.legacyBridge.selectRenderer.mock.calls.length;

      await harness.controller.downloadAll();

      expect(previewExport.downloadPreview.mock.calls).toEqual([
        [technicalContexts.feed.frame, technicalContexts.feed.manifestData, 'maker-feed.png'],
        [technicalContexts.story.frame, technicalContexts.story.manifestData, 'maker-story.png'],
      ]);
      expect(harness.api.resolveEditorRenderer).toHaveBeenCalledTimes(resolveCalls);
      expect(harness.legacyBridge.selectRenderer).toHaveBeenCalledTimes(initializeCalls);
    });

    test('mutex compartilhado bloqueia current/all e reconcilia status no finally', async () => {
      const harness = await readyCompare();
      let finish;
      harness.legacyBridge.downloadExport.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      const first = harness.controller.downloadCurrent();
      expect(harness.controller.isExportPending()).toBe(true);
      await harness.controller.downloadCurrent();
      await harness.controller.downloadAll();
      expect(harness.legacyBridge.downloadExport).toHaveBeenCalledTimes(1);
      finish(true);
      await first;
      expect(harness.controller.isExportPending()).toBe(false);
      expect(harness.elements.status.statusText.textContent).toBe('Pronto');

      harness.legacyBridge.downloadExport.mockClear();
      harness.legacyBridge.downloadExport.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      const all = harness.controller.downloadAll();
      await harness.controller.downloadCurrent();
      await harness.controller.downloadAll();
      expect(harness.legacyBridge.downloadExport).toHaveBeenCalledTimes(1);
      finish(true);
      await all;
      expect(harness.controller.isExportPending()).toBe(false);
    });

    test('all revalida as duas autoridades antes de cada arquivo', async () => {
      const harness = await readyCompare();
      harness.legacyBridge.downloadExport.mockImplementationOnce((_authority, _filename, assertCurrent) => {
        harness.controller.getPreviewContexts().story.syncPending = true;
        return Promise.resolve(assertCurrent());
      });
      await harness.controller.downloadAll();
      expect(harness.legacyBridge.downloadExport).toHaveBeenCalledTimes(1);
    });

    test('finally libera mutex mas preserva sync real e botao bloqueado', async () => {
      let finishExport; let finishSync;
      const harness = setup();
      await harness.controller.initialize();
      harness.legacyBridge.downloadExport.mockImplementationOnce(() => (
        new Promise(resolve => { finishExport = resolve; })
      ));
      const exporting = harness.controller.downloadCurrent();
      harness.legacyBridge.applyPublicationContent.mockImplementation(({ activeFormat }) => (
        activeFormat === 'story'
          ? new Promise(resolve => { finishSync = resolve; })
          : Promise.resolve()
      ));
      harness.fields[1].value = 'Conteudo durante export';
      const syncing = harness.fields[1].dispatch('input');

      expect(harness.controller.getPreviewContexts().story.syncPending).toBe(true);
      expect(harness.elements.status.statusText.textContent).toBe('Atualizando preview');
      finishExport(true);
      await exporting;

      expect(harness.controller.isExportPending()).toBe(false);
      expect(harness.controller.isFormatExportable('story')).toBe(false);
      expect(harness.elements.downloadCurrent.disabled).toBe(true);
      expect(harness.elements.status.statusText.textContent).toBe('Atualizando preview');

      finishSync();
      await syncing;
    });

    test('mudanca real de brand invalida Feed e Story antes do novo resolve concluir', async () => {
      let finishStoryResolve;
      const harness = setup();
      await harness.controller.initialize();
      await harness.controller.selectViewMode('compare');
      expect(harness.controller.isFormatExportable('feed')).toBe(true);
      expect(harness.controller.isFormatExportable('story')).toBe(true);
      harness.api.resolveEditorRenderer.mockImplementation(selection => {
        if (selection.brand === 'brand-two' && selection.format === 'story') {
          return new Promise(resolve => { finishStoryResolve = resolve; });
        }
        return Promise.resolve({
          template: selection.format === 'feed' ? 'renderer-feed' : 'renderer-z',
          page: 'index', dimensions: { width: 1080, height: 1920 }, themes: [],
        });
      });

      const changingBrand = harness.controller.selectBrand('brand-two');

      expect(harness.controller.getPublication().brand).toBe('brand-two');
      expect(finishStoryResolve).toEqual(expect.any(Function));
      expect(harness.controller.isFormatExportable('feed')).toBe(false);
      expect(harness.controller.isFormatExportable('story')).toBe(false);
      expect(harness.elements.status.statusText.textContent).not.toBe('Pronto');

      finishStoryResolve({
        template: 'renderer-brand-two', page: 'index',
        dimensions: { width: 1080, height: 1920 }, themes: [],
      });
      await changingBrand;
    });

    describe('status global e readiness visual', () => {
      test('Compare não fica Pronto com Story syncPending', async () => {
        const harness = await readyCompare();
        harness.controller.getPreviewContexts().story.syncPending = true;
        harness.controller.refreshPreviewStatus();
        expect(harness.elements.status.statusText.textContent).not.toBe('Pronto');
      });

      test('Compare não fica Pronto com Feed syncPending', async () => {
        const harness = await readyCompare();
        harness.controller.getPreviewContexts().feed.syncPending = true;
        harness.controller.refreshPreviewStatus();
        expect(harness.elements.status.statusText.textContent).not.toBe('Pronto');
      });

      test('Compare fica Pronto somente com ambos ready e sem pending', async () => {
        const harness = await readyCompare();
        harness.controller.refreshPreviewStatus();
        expect(harness.elements.status.statusText.textContent).toBe('Pronto');
      });

      test('theme em Compare sincroniza somente o Feed ativo', async () => {
        let finishFeed;
        const harness = await readyCompare();
        await harness.elements.feedPanelSelector.dispatch('click');
        const storyTheme = harness.controller.getPublication().formats.story.theme;
        harness.legacyBridge.applyPublicationContent.mockClear().mockImplementation(({ activeFormat }) => (
          new Promise(resolve => {
            expect(activeFormat).toBe('feed');
            finishFeed = resolve;
          })
        ));

        const changingTheme = harness.controller.selectTheme('navy');

        expect(harness.controller.getPreviewContexts().feed.syncPending).toBe(true);
        expect(harness.controller.getPreviewContexts().story.syncPending).toBe(false);
        expect(harness.legacyBridge.applyPublicationContent).toHaveBeenCalledTimes(1);
        expect(harness.legacyBridge.applyPublicationContent).toHaveBeenCalledWith(
          expect.objectContaining({ activeFormat: 'feed', theme: 'navy' }),
        );
        expect(harness.controller.getPublication().formats.story.theme).toBe(storyTheme);
        expect(harness.elements.status.statusText.textContent).not.toBe('Pronto');

        finishFeed();
        await changingTheme;
        expect(harness.elements.status.statusText.textContent).toBe('Pronto');
      });

      test('image adjustment e reset em Compare sincronizam somente o Story ativo', async () => {
        let finishStory;
        const harness = await readyCompare();
        const feedAdjustments = { ...harness.controller.getPublication().formats.feed.imageAdjustments };
        harness.legacyBridge.applyPublicationContent.mockClear().mockImplementation(({ activeFormat }) => (
          new Promise(resolve => {
            expect(activeFormat).toBe('story');
            finishStory = resolve;
          })
        ));

        harness.adjustmentInputs[0].value = '1.5';
        await harness.adjustmentInputs[0].dispatch('input');

        expect(harness.controller.getPreviewContexts().story.syncPending).toBe(true);
        expect(harness.controller.getPreviewContexts().feed.syncPending).toBe(false);
        expect(harness.legacyBridge.applyPublicationContent).toHaveBeenCalledTimes(1);
        expect(harness.controller.getPublication().formats.feed.imageAdjustments).toEqual(feedAdjustments);
        expect(harness.elements.status.statusText.textContent).not.toBe('Pronto');
        finishStory();
        await Promise.resolve(); await Promise.resolve();
        expect(harness.elements.status.statusText.textContent).toBe('Pronto');

        harness.legacyBridge.applyPublicationContent.mockClear().mockImplementation(({ activeFormat }) => (
          new Promise(resolve => {
            expect(activeFormat).toBe('story');
            finishStory = resolve;
          })
        ));
        const resetting = harness.controller.resetCurrentImageAdjustments();
        expect(harness.controller.getPreviewContexts().story.syncPending).toBe(true);
        expect(harness.controller.getPreviewContexts().feed.syncPending).toBe(false);
        expect(harness.legacyBridge.applyPublicationContent).toHaveBeenCalledTimes(1);
        expect(harness.controller.getPublication().formats.feed.imageAdjustments).toEqual(feedAdjustments);
        finishStory();
        await resetting;
        expect(harness.elements.status.statusText.textContent).toBe('Pronto');
      });

      test('sync paralelo só fica Pronto depois dos dois formatos', async () => {
        let finishFeed; let finishStory;
        const harness = await readyCompare();
        harness.legacyBridge.applyPublicationContent.mockImplementation(({ activeFormat }) => (
          new Promise(resolve => {
            if (activeFormat === 'feed') finishFeed = resolve;
            else finishStory = resolve;
          })
        ));

        const syncing = harness.controller.syncPublicationContentToPreview();
        expect(harness.elements.status.statusText.textContent).not.toBe('Pronto');
        finishFeed();
        await Promise.resolve(); await Promise.resolve();
        expect(harness.controller.getPreviewContexts().story.syncPending).toBe(true);
        expect(harness.elements.status.statusText.textContent).not.toBe('Pronto');
        finishStory();
        await syncing;
        expect(harness.elements.status.statusText.textContent).toBe('Pronto');
      });

      test('Compare não fica Pronto com Feed loading', async () => {
        const harness = await readyCompare();
        harness.controller.getPreviewContexts().feed.previewState = 'loading';
        harness.controller.refreshPreviewStatus();
        expect(harness.elements.status.statusText.textContent).not.toBe('Pronto');
      });

      test('Compare não fica Pronto com Story loading e volta quando coerente', async () => {
        const harness = await readyCompare();
        harness.controller.getPreviewContexts().story.previewState = 'loading';
        harness.controller.refreshPreviewStatus();
        expect(harness.elements.status.statusText.textContent).not.toBe('Pronto');
        harness.controller.getPreviewContexts().story.previewState = 'ready';
        harness.controller.refreshPreviewStatus();
        expect(harness.elements.status.statusText.textContent).toBe('Pronto');
      });

      test('Compare não fica Pronto com Feed em erro', async () => {
        const harness = await readyCompare();
        harness.controller.getPreviewContexts().feed.previewState = 'error';
        harness.controller.refreshPreviewStatus();
        expect(harness.elements.status.statusText.textContent).not.toBe('Pronto');
      });

      test('Compare não fica Pronto com Story em erro e preserva o Feed', async () => {
        const harness = await readyCompare();
        const feedRenderer = harness.controller.getRenderer('feed');
        harness.controller.getPreviewContexts().story.previewState = 'error';
        harness.controller.refreshPreviewStatus();
        expect(harness.elements.status.statusText.textContent).not.toBe('Pronto');
        expect(harness.controller.getRenderer('feed')).toBe(feedRenderer);
        expect(harness.controller.isFormatExportable('feed')).toBe(true);
      });

      test('status global não substitui exportabilidade individual', async () => {
        const harness = await readyCompare();
        harness.controller.getPreviewContexts().story.previewState = 'error';
        await harness.elements.feedPanelSelector.dispatch('click');
        expect(harness.elements.status.statusText.textContent).not.toBe('Pronto');
        expect(harness.controller.isFormatExportable('feed')).toBe(true);
        expect(harness.elements.downloadCurrent.disabled).toBe(false);
        expect(harness.elements.downloadAll.disabled).toBe(true);
      });

      test('single Story ignora erro do Feed oculto', async () => {
        const harness = setup();
        await harness.controller.initialize();
        harness.controller.getPreviewContexts().feed.previewState = 'error';
        harness.controller.refreshPreviewStatus();
        expect(harness.elements.status.statusText.textContent).toBe('Pronto');
      });

      test('single Feed ignora erro do Story oculto', async () => {
        const harness = setup({ api: { getEditorCatalog: jest.fn().mockResolvedValue(multiFormatCatalog) } });
        await harness.controller.initialize();
        await harness.controller.selectFormat('feed');
        harness.controller.getPreviewContexts().story.previewState = 'error';
        harness.controller.refreshPreviewStatus();
        expect(harness.elements.status.statusText.textContent).toBe('Pronto');
      });
    });
  });
});
