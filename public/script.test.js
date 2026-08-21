const fs = require('fs');
const path = require('path');
const vm = require('vm');
const EditorUi = require('./js/editor-ui');
const EditorState = require('./js/editor-state');
const EditorCatalog = require('./js/editor-catalog');

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

  closest() {
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

function createHarness({
  autoPrepareDownload = true,
  autoResolveRuntime = true,
  includeFeedFrame = true
} = {}) {
  jest.useFakeTimers();

  const ids = [
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
    'fetchDataBtn',
    'previewFrame',
    'previewFrameFeed',
    'previewPlaceholder'
  ];
  const elements = Object.fromEntries(ids.map(id => [id, new FakeElement(id)]));
  if (!includeFeedFrame) delete elements.previewFrameFeed;
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
  const feedFrameDocument = {
    open: jest.fn(),
    write: jest.fn(),
    close: jest.fn(() => {
      if (autoResolveRuntime) {
        elements.previewFrameFeed.contentWindow.__resolvePreviewRuntimeReady?.();
      }
    })
  };
  if (elements.previewFrameFeed) {
    elements.previewFrameFeed.contentDocument = feedFrameDocument;
    elements.previewFrameFeed.contentWindow = { document: feedFrameDocument };
  }

  const previewWrapper = new FakeElement('preview-frame-wrapper');
  previewWrapper.dataset.previewFormat = 'story';
  const feedPreviewWrapper = new FakeElement('preview-frame-wrapper-feed');
  feedPreviewWrapper.dataset.previewFormat = 'feed';
  const previewContainer = new FakeElement('preview-container');
  previewWrapper.parentElement = previewContainer;
  feedPreviewWrapper.parentElement = previewContainer;
  const documentListeners = {};
  const document = {
    getElementById: id => elements[id] || null,
    querySelector: selector => {
      if (selector === '[data-preview-viewport][data-preview-format="story"]') return previewWrapper;
      if (selector === '[data-preview-viewport][data-preview-format="feed"]') return feedPreviewWrapper;
      if (selector === '[data-preview-placeholder="feed"]') return null;
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

  if (autoPrepareDownload) {
    vm.runInContext(`
      const selectRendererStateWithReadyContext = selectRendererState;
      selectRendererState = function (renderer, theme, activeFormat) {
        selectRendererStateWithReadyContext(renderer, theme, activeFormat);
        const format = activeFormat || 'story';
        const context = getPreviewContext(format);
        context.manifestData = {
          template: context.template,
          page: context.page,
          manifest: { dimensions: { width: 1080, height: format === 'feed' ? 1350 : 1920 } },
          css: [],
          html: ''
        };
        context.initializedTemplate = context.template;
        context.initializedPage = context.page;
        window.LegacyEditorBridge.setEditorPreviewReady(format, true);
      };
    `, context);
  }

  function run(expression) {
    return vm.runInContext(expression, context);
  }

  function state() {
    return JSON.parse(run(`JSON.stringify({
      currentTemplate,
      currentTheme,
      currentFormat,
      currentImageAdjustments,
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
    feedFrameDocument,
    feedPreviewWrapper,
    loadManifest,
    run,
    state
  };
}

describe('exportação do formato editorial visível', () => {
  function configureReadyContext(harness, format, manifestData, {
    initializedTemplate = manifestData.template,
    initializedPage = manifestData.page || 'index',
    ready = true
  } = {}) {
    harness.context.__exportManifest = manifestData;
    harness.elements[format === 'feed' ? 'previewFrameFeed' : 'previewFrame']
      .contentWindow.__updatePreview = jest.fn();
    harness.run(`
      previewContexts.${format}.template = __exportManifest.template;
      previewContexts.${format}.page = __exportManifest.page || 'index';
      previewContexts.${format}.manifestData = __exportManifest;
      previewContexts.${format}.initializedTemplate = ${JSON.stringify(initializedTemplate)};
      previewContexts.${format}.initializedPage = ${JSON.stringify(initializedPage)};
      previewContexts.${format}.ready = ${JSON.stringify(ready)};
      window.LegacyEditorBridge.setActiveFormat(${JSON.stringify(format)});
    `);
  }

  function fillValidExportData(harness) {
    harness.elements.newsUrl.value = 'https://example.com/noticia';
    harness.extractNewsData.mockResolvedValue({ chapeu: 'Categoria', bg: 'data:image/png;base64,QQ==' });
  }

  test('readiness de Story não autoriza download do context Feed', async () => {
    const harness = createHarness({ autoPrepareDownload: false });
    fillValidExportData(harness);
    const feedManifest = { template: 'feed-renderer', page: 'index', manifest: {}, css: [], html: '' };
    configureReadyContext(harness, 'story', { ...feedManifest, template: 'story-renderer' });
    configureReadyContext(harness, 'feed', feedManifest, { ready: false });
    await harness.run('generateArtWithPreviewFlow()');
    expect(harness.context.PreviewExport.downloadPreview).not.toHaveBeenCalled();
  });

  test.each([
    ['manifest ausente', context => { context.manifestData = null; }],
    ['inicialização stale', context => { context.initializedTemplate = 'feed-antigo'; }]
  ])('bloqueia Feed com %s', async (_name, invalidate) => {
    const harness = createHarness({ autoPrepareDownload: false });
    fillValidExportData(harness);
    configureReadyContext(harness, 'feed', {
      template: 'feed-renderer', page: 'index', manifest: {}, css: [], html: ''
    });
    harness.context.invalidateExportContext = invalidate;
    harness.run('invalidateExportContext(previewContexts.feed)');
    await harness.run('generateArtWithPreviewFlow()');
    expect(harness.context.PreviewExport.downloadPreview).not.toHaveBeenCalled();
  });

  test.each([
    ['feed', 'previewFrameFeed', 1350],
    ['story', 'previewFrame', 1920]
  ])('download %s usa exatamente frame e manifest do próprio context', async (format, frameId, height) => {
    const harness = createHarness({ autoPrepareDownload: false });
    fillValidExportData(harness);
    const manifest = {
      template: `${format}-renderer`, page: 'index',
      manifest: { dimensions: { width: 1080, height } }, css: [], html: ''
    };
    configureReadyContext(harness, format, manifest);
    harness.loadManifest.mockClear();
    await harness.run('generateArtWithPreviewFlow()');
    expect(harness.context.PreviewExport.downloadPreview)
      .toHaveBeenCalledWith(harness.elements[frameId], manifest, expect.any(String));
    expect(harness.loadManifest).not.toHaveBeenCalled();
  });

  test('pending é consultado somente para o formato exportado', async () => {
    const harness = createHarness({ autoPrepareDownload: false });
    fillValidExportData(harness);
    configureReadyContext(harness, 'story', {
      template: 'story-renderer', page: 'index', manifest: {}, css: [], html: ''
    });
    harness.run(`window.LegacyEditorBridge.setContentSyncPending(true, 'feed')`);
    await harness.run('generateArtWithPreviewFlow()');
    expect(harness.context.PreviewExport.downloadPreview).toHaveBeenCalledTimes(1);
    harness.run(`window.LegacyEditorBridge.setContentSyncPending(true, 'story')`);
    await harness.run('generateArtWithPreviewFlow()');
    expect(harness.context.PreviewExport.downloadPreview).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['readiness', `window.LegacyEditorBridge.setEditorPreviewReady('feed', false)`],
    ['content sync pending', `window.LegacyEditorBridge.setContentSyncPending(true, 'feed')`],
    ['manifest', `previewContexts.feed.manifestData = { template: 'feed-renderer', page: 'index', manifest: {}, css: [], html: '' }`],
    ['frame', `previewContexts.feed.frame = previewFrame`]
  ])('Feed não exporta quando %s perde autoridade durante await', async (_name, mutation) => {
    const harness = createHarness({ autoPrepareDownload: false });
    const extraction = createDeferred();
    fillValidExportData(harness);
    configureReadyContext(harness, 'feed', {
      template: 'feed-renderer', page: 'index', manifest: {}, css: [], html: ''
    });
    harness.extractNewsData.mockReturnValue(extraction.promise);

    const generation = harness.run('generateArtWithPreviewFlow()');
    harness.run(mutation);
    extraction.resolve({ chapeu: 'Categoria', bg: 'data:image/png;base64,QQ==' });
    await generation;

    expect(harness.context.PreviewExport.downloadPreview).not.toHaveBeenCalled();
  });

  test('Story não exporta quando perde readiness durante await', async () => {
    const harness = createHarness({ autoPrepareDownload: false });
    const extraction = createDeferred();
    fillValidExportData(harness);
    configureReadyContext(harness, 'story', {
      template: 'story-renderer', page: 'index', manifest: {}, css: [], html: ''
    });
    harness.extractNewsData.mockReturnValue(extraction.promise);

    const generation = harness.run('generateArtWithPreviewFlow()');
    harness.run(`window.LegacyEditorBridge.setEditorPreviewReady('story', false)`);
    extraction.resolve({ chapeu: 'Categoria', bg: 'data:image/png;base64,QQ==' });
    await generation;

    expect(harness.context.PreviewExport.downloadPreview).not.toHaveBeenCalled();
  });

  test('Compare preserva export Feed quando apenas Story muda durante await', async () => {
    const harness = createHarness({ autoPrepareDownload: false });
    const extraction = createDeferred();
    fillValidExportData(harness);
    const feedManifest = { template: 'feed-renderer', page: 'index', manifest: {}, css: [], html: '' };
    configureReadyContext(harness, 'story', {
      template: 'story-renderer', page: 'index', manifest: {}, css: [], html: ''
    });
    configureReadyContext(harness, 'feed', feedManifest);
    harness.extractNewsData.mockReturnValue(extraction.promise);

    const generation = harness.run('generateArtWithPreviewFlow()');
    harness.run(`window.LegacyEditorBridge.setEditorPreviewReady('story', false)`);
    extraction.resolve({ chapeu: 'Categoria', bg: 'data:image/png;base64,QQ==' });
    await generation;

    expect(harness.context.PreviewExport.downloadPreview)
      .toHaveBeenCalledWith(harness.elements.previewFrameFeed, feedManifest, expect.any(String));
  });

  test('exporta Feed 1080x1350 e depois Story 1080x1920 sem estado residual', async () => {
    const harness = createHarness();
    const storyUpdatePreview = jest.fn();
    const feedUpdatePreview = jest.fn();
    harness.elements.previewFrame.contentWindow.__updatePreview = storyUpdatePreview;
    harness.elements.previewFrameFeed.contentWindow.__updatePreview = feedUpdatePreview;
    harness.elements.newsUrl.value = 'https://example.com/noticia';
    harness.extractNewsData.mockResolvedValue({
      chapeu: 'Categoria', bg: 'data:image/png;base64,QQ==',
    });
    harness.loadManifest.mockImplementation((template, page) => Promise.resolve({
      template, page,
      manifest: {
        dimensions: template === 'renderer-feed'
          ? { width: 1080, height: 1350 }
          : { width: 1080, height: 1920 },
      },
      css: [], html: '',
    }));

    harness.run(`
      selectRendererState({ template: 'renderer-feed', page: 'index', themes: [{ id: 'azul', label: 'Azul' }] }, 'azul', 'feed');
      currentImageAdjustments = { zoom: 1.3, x: 30, y: 70 };
    `);
    await harness.run('generateArtWithPreviewFlow()');

    const feedManifest = harness.context.PreviewExport.downloadPreview.mock.calls[0][1];
    expect(harness.context.PreviewExport.downloadPreview.mock.calls[0][0])
      .toBe(harness.elements.previewFrameFeed);
    expect(feedManifest.manifest.dimensions).toEqual({ width: 1080, height: 1350 });
    expect(feedUpdatePreview).toHaveBeenLastCalledWith(expect.objectContaining({
      activeFormat: 'feed', imageAdjustments: { zoom: 1.3, x: 30, y: 70 },
    }));
    expect(harness.state()).toMatchObject({
      currentTemplate: 'renderer-feed', currentFormat: 'feed',
      currentImageAdjustments: { zoom: 1.3, x: 30, y: 70 },
    });

    harness.run(`
      selectRendererState({ template: 'renderer-story', page: 'index', themes: [{ id: 'preto', label: 'Preto' }] }, 'preto', 'story');
      currentImageAdjustments = { zoom: 1.1, x: 45, y: 55 };
    `);
    await harness.run('generateArtWithPreviewFlow()');

    const storyManifest = harness.context.PreviewExport.downloadPreview.mock.calls[1][1];
    expect(harness.context.PreviewExport.downloadPreview.mock.calls[1][0])
      .toBe(harness.elements.previewFrame);
    expect(storyManifest.manifest.dimensions).toEqual({ width: 1080, height: 1920 });
    expect(storyUpdatePreview).toHaveBeenLastCalledWith(expect.objectContaining({
      activeFormat: 'story', imageAdjustments: { zoom: 1.1, x: 45, y: 55 },
    }));
    expect(harness.state()).toMatchObject({
      currentTemplate: 'renderer-story', currentFormat: 'story', currentTheme: 'preto',
      currentImageAdjustments: { zoom: 1.1, x: 45, y: 55 },
    });
    expect(harness.context.PreviewExport.downloadPreview).toHaveBeenCalledTimes(2);
  });

  test('bridge keeps Story and Feed bound to distinct frames after a Story sync', async () => {
    const harness = createHarness({ autoPrepareDownload: false });
    const storyUpdate = jest.fn();
    const feedUpdate = jest.fn();
    harness.elements.previewFrame.contentWindow.__updatePreview = storyUpdate;
    harness.elements.previewFrameFeed.contentWindow.__updatePreview = feedUpdate;
    harness.loadManifest.mockImplementation((template, page) => Promise.resolve({
      template, page, manifest: { dimensions: { width: 1080, height: template === 'feed-renderer' ? 1350 : 1920 } },
      css: [], html: `<main>${template}</main>`,
    }));
    await harness.run(`window.LegacyEditorBridge.selectRenderer({ renderer: { template: 'story-renderer', page: 'index', themes: [] }, activeFormat: 'story', theme: 'dark', content: { title: 'Story' }, imageAdjustments: { zoom: 1, x: 50, y: 50 }, assertCurrent: function () {} })`);
    await harness.run(`window.LegacyEditorBridge.selectRenderer({ renderer: { template: 'feed-renderer', page: 'index', themes: [] }, activeFormat: 'feed', theme: 'blue', content: { title: 'Feed' }, imageAdjustments: { zoom: 1.2, x: 40, y: 60 }, assertCurrent: function () {} })`);
    storyUpdate.mockClear();
    feedUpdate.mockClear();
    await harness.run(`window.LegacyEditorBridge.applyPublicationContent({ activeFormat: 'story', theme: 'dark', content: { title: 'Story atual' }, imageAdjustments: { zoom: 1.1, x: 45, y: 55 }, assertCurrent: function () {} })`);
    expect(storyUpdate).toHaveBeenCalledWith(expect.objectContaining({ activeFormat: 'story', h1: 'Story atual' }));
    expect(feedUpdate).not.toHaveBeenCalled();
    expect(harness.run(`JSON.stringify({ story: previewContexts.story.template, feed: previewContexts.feed.template })`))
      .toBe('{"story":"story-renderer","feed":"feed-renderer"}');
    expect(harness.frameDocument.write.mock.calls.some(([html]) => html.includes('story-renderer'))).toBe(true);
    expect(harness.feedFrameDocument.write.mock.calls.some(([html]) => html.includes('feed-renderer'))).toBe(true);
  });

  test('content sync pending is independent per format', () => {
    const harness = createHarness();
    harness.run(`window.LegacyEditorBridge.setContentSyncPending(true, 'feed'); window.LegacyEditorBridge.setContentSyncPending(true, 'story'); window.LegacyEditorBridge.setContentSyncPending(false, 'feed')`);
    expect(harness.run('JSON.stringify(contentSyncPending)')).toBe('{"feed":false,"story":true}');
    harness.run(`window.LegacyEditorBridge.setContentSyncPending(false, 'story')`);
    expect(harness.run('JSON.stringify(contentSyncPending)')).toBe('{"feed":false,"story":false}');
  });

  test('download current in Compare follows the explicitly active format', async () => {
    const harness = createHarness();
    harness.elements.previewFrame.contentWindow.__updatePreview = jest.fn();
    harness.elements.previewFrameFeed.contentWindow.__updatePreview = jest.fn();
    harness.elements.newsUrl.value = 'https://example.com/noticia';
    harness.extractNewsData.mockResolvedValue({ chapeu: 'Categoria', bg: 'data:image/png;base64,QQ==' });
    harness.loadManifest.mockImplementation((template, page) => Promise.resolve({ template, page, manifest: { dimensions: { width: 1080, height: template === 'feed-renderer' ? 1350 : 1920 } }, css: [], html: '' }));
    harness.run(`selectRendererState({ template: 'story-renderer', page: 'index', themes: [] }, null, 'story'); selectRendererState({ template: 'feed-renderer', page: 'index', themes: [] }, null, 'feed'); window.LegacyEditorBridge.setActiveFormat('feed')`);
    await harness.run('generateArtWithPreviewFlow()');
    expect(harness.context.PreviewExport.downloadPreview.mock.calls[0][0]).toBe(harness.elements.previewFrameFeed);
    harness.run(`window.LegacyEditorBridge.setActiveFormat('story')`);
    await harness.run('generateArtWithPreviewFlow()');
    expect(harness.context.PreviewExport.downloadPreview.mock.calls[1][0]).toBe(harness.elements.previewFrame);
  });

  test('missing Feed frame never falls back to Story export', async () => {
    const harness = createHarness({ includeFeedFrame: false });
    harness.run(`selectRendererState({ template: 'feed-renderer', page: 'index', themes: [] }, null, 'feed')`);
    await harness.run('generateArtWithPreviewFlow()');
    expect(harness.context.PreviewExport.downloadPreview).not.toHaveBeenCalled();
  });

  test.each([
    ['ready false', `previewContexts.story.ready = false`],
    ['sync pending', `contentSyncPending.story = true`],
    ['sem frame', `previewContexts.story.frame = null`],
    ['sem manifest', `previewContexts.story.manifestData = null`],
    ['initialization stale', `previewContexts.story.initializedPage = 'old'`],
  ])('bridge isFormatExportable rejeita %s', (_label, mutation) => {
    const harness = createHarness({ autoPrepareDownload: false });
    configureReadyContext(harness, 'story', {
      template: 'story-renderer', page: 'index', manifest: {}, css: [], html: ''
    });
    expect(harness.run(`window.LegacyEditorBridge.isFormatExportable('story')`)).toBe(true);
    harness.run(mutation);
    expect(harness.run(`window.LegacyEditorBridge.isFormatExportable('story')`)).toBe(false);
  });

  test('authority tecnica rejeita troca de initialization version', () => {
    const harness = createHarness({ autoPrepareDownload: false });
    configureReadyContext(harness, 'feed', {
      template: 'feed-renderer', page: 'index', manifest: {}, css: [], html: ''
    });
    harness.run(`window.__authority = window.LegacyEditorBridge.captureExportAuthority('feed')`);
    expect(harness.run(`window.LegacyEditorBridge.isExportAuthorityCurrent(window.__authority)`)).toBe(true);
    harness.run(`previewContexts.feed.initializationVersion += 1`);
    expect(harness.run(`window.LegacyEditorBridge.isExportAuthorityCurrent(window.__authority)`)).toBe(false);
  });

  test('bridge rejeita renderer editorial diferente do context tecnico', () => {
    const harness = createHarness({ autoPrepareDownload: false });
    configureReadyContext(harness, 'story', {
      template: 'story-renderer', page: 'index', manifest: {}, css: [], html: ''
    });
    harness.context.__renderer = { template: 'renderer-antigo', page: 'index' };
    expect(harness.run(`window.LegacyEditorBridge.isFormatExportable('story', window.__renderer)`)).toBe(false);
  });
});

async function createIntegratedDownloadAllHarness() {
  const harness = createHarness();
  harness.elements.previewFrame.contentWindow.__updatePreview = jest.fn();
  harness.elements.previewFrameFeed.contentWindow.__updatePreview = jest.fn();
  const controls = Object.fromEntries([
    'brand', 'family', 'variants', 'themes', 'status', 'downloadAll', 'imageAdjustments',
    'resetImageAdjustments', 'newArtwork', 'feed', 'story', 'compare', 'feedPanel',
    'storyPanel', 'feedSelector', 'storySelector'
  ].map(name => [name, new BindingElement()]));
  controls.downloadCurrent = harness.elements.generateBtn;
  controls.importNews = harness.elements.fetchDataBtn;
  controls.status.statusText = new BindingElement();
  controls.status.querySelector = selector => selector === 'span:last-child' ? controls.status.statusText : null;
  controls.feed.dataset.viewMode = 'feed'; controls.story.dataset.viewMode = 'story';
  controls.compare.dataset.viewMode = 'compare'; controls.feedPanel.dataset.previewPanel = 'feed';
  controls.storyPanel.dataset.previewPanel = 'story'; controls.feedSelector.dataset.selectPreviewFormat = 'feed';
  controls.storySelector.dataset.selectPreviewFormat = 'story';
  const fields = ['url', 'title', 'subtitle', 'tag', 'image'].map(name => {
    const field = new BindingElement(); field.dataset.field = name; return field;
  });
  const selectors = {
    '[data-control="brand"]': controls.brand, '[data-control="family"]': controls.family,
    '[data-control="variants"]': controls.variants, '[data-control="themes"]': controls.themes,
    '[data-editor-status]': controls.status, '[data-action="download-current"]': controls.downloadCurrent,
    '[data-action="download-all"]': controls.downloadAll, '[data-action="import-news"]': controls.importNews,
    '[data-control="image-adjustments"]': controls.imageAdjustments,
    '[data-action="reset-image-adjustments"]': controls.resetImageAdjustments,
    '[data-action="new-artwork"]': controls.newArtwork,
  };
  fields.forEach(field => { selectors[`[data-field="${field.dataset.field}"]`] = field; });
  const controllerDocument = {
    querySelector: selector => selectors[selector] || null,
    querySelectorAll(selector) {
      if (selector === '[data-field]') return fields;
      if (selector === '[data-image-adjustment]') return [];
      if (selector === '[data-view-mode]') return [controls.feed, controls.story, controls.compare];
      if (selector === '[data-preview-panel]') return [controls.feedPanel, controls.storyPanel];
      if (selector === '[data-select-preview-format]') return [controls.feedSelector, controls.storySelector];
      return [];
    },
    createElement: () => new BindingElement(),
  };
  const catalog = { brands: [{ id: 'brand', name: 'Brand', families: [{
    id: 'family', label: 'Family', variants: [{ id: 'variant', label: 'Variant', formats: [
      { id: 'feed', dimensions: { width: 1080, height: 1350 }, themes: [] },
      { id: 'story', dimensions: { width: 1080, height: 1920 }, themes: [] },
    ] }],
  }] }] };
  const api = {
    getEditorCatalog: jest.fn().mockResolvedValue(catalog),
    resolveEditorRenderer: jest.fn(selection => Promise.resolve({
      template: `${selection.format}-renderer`, page: 'index', themes: [],
      dimensions: selection.format === 'feed'
        ? { width: 1080, height: 1350 } : { width: 1080, height: 1920 },
    })),
  };
  const controller = EditorUi.createEditorController({
    document: controllerDocument, api, state: EditorState, catalogHelpers: EditorCatalog,
    frontendUtils: { normalizeOptionalValue: value => value || '', isHttpUrl: () => true },
    legacyBridge: harness.context.LegacyEditorBridge,
  });
  await controller.initialize();
  await controller.selectViewMode('compare');
  harness.context.PreviewExport.downloadPreview.mockClear();
  harness.loadManifest.mockClear();
  return { ...harness, api, controller, controls };
}

describe('downloadAll integrado com os previewContexts tecnicos reais', () => {
  test('Feed invalido impede qualquer chamada final ao PreviewExport, inclusive Story', async () => {
    const harness = await createIntegratedDownloadAllHarness();
    harness.run(`window.LegacyEditorBridge.setEditorPreviewReady('feed', false)`);
    await harness.controller.downloadAll();
    expect(harness.controller.isFormatExportable('story')).toBe(true);
    expect(harness.controller.isFormatExportable('feed')).toBe(false);
    expect(harness.context.PreviewExport.downloadPreview).not.toHaveBeenCalled();
  });

  test('entrega os frames e manifests reais de Feed e Story sem reconstruir', async () => {
    const harness = await createIntegratedDownloadAllHarness();
    const feedFrame = harness.run('previewContexts.feed.frame');
    const storyFrame = harness.run('previewContexts.story.frame');
    const feedManifest = harness.run('previewContexts.feed.manifestData');
    const storyManifest = harness.run('previewContexts.story.manifestData');
    const resolveCalls = harness.api.resolveEditorRenderer.mock.calls.length;
    const activeFormat = harness.controller.getActiveFormat();
    const viewMode = harness.controller.getViewMode();
    const feedWrites = harness.feedFrameDocument.write.mock.calls.length;
    const storyWrites = harness.frameDocument.write.mock.calls.length;
    await harness.controller.downloadAll();
    expect(feedFrame).toBe(harness.elements.previewFrameFeed);
    expect(storyFrame).toBe(harness.elements.previewFrame);
    expect(feedFrame).not.toBe(storyFrame);
    expect(feedFrame.contentWindow).not.toBe(storyFrame.contentWindow);
    expect(feedFrame.contentWindow.document).not.toBe(storyFrame.contentWindow.document);
    expect(harness.context.PreviewExport.downloadPreview.mock.calls).toEqual([
      [feedFrame, feedManifest, 'maker-feed.png', expect.any(Object)],
      [storyFrame, storyManifest, 'maker-story.png', expect.any(Object)],
    ]);
    expect(feedManifest.manifest.dimensions).toEqual({ width: 1080, height: 1350 });
    expect(storyManifest.manifest.dimensions).toEqual({ width: 1080, height: 1920 });
    expect(harness.loadManifest).not.toHaveBeenCalled();
    expect(harness.api.resolveEditorRenderer).toHaveBeenCalledTimes(resolveCalls);
    expect(harness.controller.getActiveFormat()).toBe(activeFormat);
    expect(harness.controller.getViewMode()).toBe(viewMode);
    expect(harness.feedFrameDocument.write).toHaveBeenCalledTimes(feedWrites);
    expect(harness.frameDocument.write).toHaveBeenCalledTimes(storyWrites);
  });
});

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

test('publication flows through real controller and bridge to iframe DOM and same-frame export', async () => {
  const image = new BindingElement('img');
  const manifest = {
    dimensions: { width: 1080, height: 1920 },
    formats: {
      feed: { capabilities: { imageAdjustments: { zoom: false, position: false } } },
      story: { capabilities: { imageAdjustments: { zoom: true, position: true } } },
    },
    bindings: [{ selector: '#bg', type: 'image', field: 'resolvedBg' }],
  };
  const runtime = await createReadyBindingRuntimeHarness(manifest, { '#bg': [image] });
  const parent = runtime.parentHarness;
  parent.run(`currentFormat = 'story'`);
  const elements = {
    brand: new BindingElement(), family: new BindingElement(),
    variants: new BindingElement(), themes: new BindingElement(),
    status: new BindingElement(), download: parent.elements.generateBtn,
    importNews: parent.elements.fetchDataBtn, imageAdjustments: new BindingElement(),
    resetImageAdjustments: new BindingElement(), newArtwork: new BindingElement(),
  };
  elements.status.statusText = new BindingElement();
  elements.status.querySelector = selector => selector === 'span:last-child' ? elements.status.statusText : null;
  const fields = [
    ['url', parent.elements.newsUrl], ['title', parent.elements.customTitle],
    ['subtitle', parent.elements.customSubtitle], ['tag', parent.elements.customTag],
    ['image', parent.elements.customImageUrl],
  ].map(([name, field]) => { field.dataset.field = name; return field; });
  const sliders = ['zoom', 'x', 'y'].map(name => {
    const input = new BindingElement('input'); input.dataset.imageAdjustment = name; return input;
  });
  const outputs = Object.fromEntries(['zoom', 'x', 'y'].map(name => [name, new BindingElement('output')]));
  const selectors = {
    '[data-control="brand"]': elements.brand,
    '[data-control="family"]': elements.family,
    '[data-control="variants"]': elements.variants,
    '[data-control="themes"]': elements.themes,
    '[data-editor-status]': elements.status,
    '[data-action="download-current"]': elements.download,
    '[data-action="import-news"]': elements.importNews,
    '[data-control="image-adjustments"]': elements.imageAdjustments,
    '[data-action="reset-image-adjustments"]': elements.resetImageAdjustments,
    '[data-action="new-artwork"]': elements.newArtwork,
  };
  fields.forEach(field => { selectors[`[data-field="${field.dataset.field}"]`] = field; });
  const controllerDocument = {
    querySelector(selector) {
      const output = selector.match(/^\[data-value-for="(.+)"\]$/);
      return output ? outputs[output[1]] : selectors[selector] || null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-field]') return fields;
      if (selector === '[data-image-adjustment]') return sliders;
      return [];
    },
    createElement: tag => new BindingElement(tag),
  };
  const catalog = { brands: [{ id: 'brand-x', name: 'Brand X', families: [{
    id: 'family-x', label: 'Family X', variants: [{
      id: 'variant-x', label: 'Variant X', formats: [{
        id: 'story', themes: [],
        capabilities: { imageAdjustments: { zoom: true, position: true } },
      }],
    }],
  }] }] };
  const controller = EditorUi.createEditorController({
    document: controllerDocument,
    api: {
      getEditorCatalog: jest.fn().mockResolvedValue(catalog),
      resolveEditorRenderer: jest.fn().mockResolvedValue({
        template: 'binding-fixture', page: 'index', themes: [],
        capabilities: { imageAdjustments: { zoom: true, position: true } },
      }),
    },
    state: EditorState,
    catalogHelpers: EditorCatalog,
    frontendUtils: {
      normalizeOptionalValue: value => typeof value === 'string' ? value.trim() : '',
      isHttpUrl: value => /^https?:\/\//.test(value),
    },
    legacyBridge: {
      ...parent.context.LegacyEditorBridge,
      selectRenderer: jest.fn(({ renderer, activeFormat, theme }) => {
        parent.context.__resolvedManifestData = {
          template: renderer.template, page: renderer.page, manifest, css: [], html: ''
        };
        parent.run(`
          previewContexts.${activeFormat}.template = ${JSON.stringify('binding-fixture')};
          previewContexts.${activeFormat}.page = 'index';
          previewContexts.${activeFormat}.theme = ${JSON.stringify(null)};
          previewContexts.${activeFormat}.manifestData = __resolvedManifestData;
          previewContexts.${activeFormat}.initializedTemplate = ${JSON.stringify('binding-fixture')};
          previewContexts.${activeFormat}.initializedPage = 'index';
        `);
        parent.context.LegacyEditorBridge.setActiveFormat(activeFormat);
        return Promise.resolve();
      }),
    },
  });
  await controller.initialize();
  for (const [index, value] of [[0, '1.5'], [1, '25'], [2, '80']]) {
    sliders[index].value = value;
    sliders[index].dispatch('input');
  }
  await controller.syncPublicationContentToPreview();

  expect(controller.getPublication().formats.story.imageAdjustments)
    .toEqual({ zoom: 1.5, x: 25, y: 80 });
  expect(image.style).toMatchObject({
    objectPosition: '25% 80%', transformOrigin: '25% 80%', transform: 'scale(1.5)',
  });
  await parent.context.PreviewExport.downloadPreview(
    parent.elements.previewFrame,
    parent.run('currentManifestData'),
    'integrated.png'
  );
  expect(parent.context.PreviewExport.downloadPreview).toHaveBeenCalledWith(
    parent.elements.previewFrame,
    expect.anything(),
    'integrated.png'
  );
  expect(image.style.transform).toBe('scale(1.5)');
});
describe('readiness editorial e exportação legada', () => {
  test('bridge de importação delega à infraestrutura de extração e cache', async () => {
    const harness = createHarness();
    const extracted = { h1: 'Título importado', bg: 'data:image/jpeg;base64,QQ==' };
    harness.extractNewsData.mockResolvedValue(extracted);

    const first = await harness.run(`window.LegacyEditorBridge.importNews({
      url: 'https://example.com/noticia'
    })`);
    const reused = await harness.run(`window.LegacyEditorBridge.importNews({
      url: 'https://example.com/noticia'
    })`);

    expect(first).toEqual(extracted);
    expect(reused).toEqual(extracted);
    expect(harness.extractNewsData).toHaveBeenCalledTimes(1);
  });

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
    harness.run(`selectRendererState({ template: 'story-renderer', page: 'index', themes: [] }, null, 'story')`);
    harness.elements.newsUrl.value = 'https://example.com/noticia';
    harness.run('window.LegacyEditorBridge.setContentSyncPending(true)');
    await harness.run('generateArtWithPreviewFlow()');
    expect(harness.context.PreviewExport.downloadPreview).not.toHaveBeenCalled();
    expect(harness.elements.toastContainer.children.at(-1).innerHTML)
      .toContain('Aguarde o preview ficar pronto para baixar');
  });

  test('bridge real usa publication content e nao inputs divergentes no payload', async () => {
    const harness = createHarness();
    harness.run(`selectRendererState({ template: 'agazeta-foto-abaixo', page: 'index', themes: [] }, 'azul')`);
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
    harness.run(`selectRendererState({ template: 'agazeta-foto-abaixo', page: 'index', themes: [] }, 'azul')`);
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
    harness.run(`selectRendererState({ template: 'agazeta-foto-abaixo', page: 'index', themes: [] }, 'azul')`);
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
    harness.run(`selectRendererState({ template: 'story-renderer', page: 'index', themes: [] }, null, 'story')`);
    harness.elements.newsUrl.value = 'https://example.com/noticia';
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
    harness.run(`selectRendererState({ template: 'layout-hz', page: 'index', themes: [] }, 'rosa')`);
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

  test('troca de tema preserva template, notícia, manifest e template do preview', () => {
    const harness = createHarness();
    harness.run(`selectRendererState({ template: 'agazeta-foto-abaixo', page: 'index', themes: [] }, 'azul');
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
    expect(harness.elements.customTheme.value).toBe('preto');
  });

  test('inicializa manifest e iframe uma vez e os reaproveita para o mesmo template', async () => {
    const harness = createHarness({ autoPrepareDownload: false });
    const manifestData = {
      template: 'agazeta-foto-abaixo',
      page: 'index',
      manifest: { name: 'A Gazeta' },
      css: [],
      html: '<main></main>'
    };
    harness.loadManifest.mockResolvedValue(manifestData);
    harness.run(`selectRendererState({ template: 'agazeta-foto-abaixo', page: 'index', themes: [] }, 'azul')`);
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

});

describe('atualizações auxiliares do preview', () => {
  test('trata explicitamente falha de atualização auxiliar do preview', async () => {
    const harness = createHarness();
    harness.run(`selectRendererState({ template: 'layout-hz', page: 'index', themes: [] }, 'rosa')`);
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
    harness.run(`selectRendererState({ template: 'layout-hz', page: 'index', themes: [] }, 'rosa')`);
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
    const harness = createHarness({ autoPrepareDownload: false, autoResolveRuntime: false });
    const documentWritten = createDeferred();
    harness.run(`selectRendererState({ template: 'layout-hz', page: 'index', themes: [] }, 'rosa')`);
    harness.frameDocument.write.mockImplementation(html => {
      if (html.includes('preview-runtime.js')) documentWritten.resolve();
    });

    harness.elements.customTitle.dispatch('input');
    await documentWritten.promise;
    const rejectOldRuntime = harness.elements.previewFrame.contentWindow
      .__rejectPreviewRuntimeReady;

    harness.run(`selectRendererState({ template: 'rede-gazeta', page: 'index', themes: [] }, null)`);
    rejectOldRuntime(new Error('runtime da sessão antiga'));
    for (let index = 0; index < 5; index += 1) {
      await Promise.resolve();
    }

    expect(harness.context.console.error).not.toHaveBeenCalled();
    expect(harness.elements.toastContainer.children).toHaveLength(0);
  });

  test('ignora falha auxiliar de uma inicialização substituída na mesma sessão', async () => {
    const harness = createHarness({ autoPrepareDownload: false, autoResolveRuntime: false });
    const firstDocumentWritten = createDeferred();
    const secondDocumentWritten = createDeferred();
    harness.run(`selectRendererState({ template: 'layout-hz', page: 'index', themes: [] }, 'rosa')`);
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
    const harness = createHarness({ autoPrepareDownload: false, autoResolveRuntime: false });
    const firstDocumentWritten = createDeferred();
    const secondDocumentWritten = createDeferred();
    harness.run(`selectRendererState({ template: 'layout-hz', page: 'index', themes: [] }, 'rosa')`);
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
    harness.run(`selectRendererState({ template: 'layout-hz', page: 'index', themes: [] }, 'rosa')`);
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
      imageAdjustments: { zoom: 1, x: 50, y: 50 },
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
      imageAdjustments: { zoom: 1, x: 50, y: 50 },
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
  async function importNewsThroughBridge(harness) {
    if (!harness.elements.previewFrame.contentWindow.__updatePreview) {
      harness.elements.previewFrame.contentWindow.__updatePreview = jest.fn();
    }
    await harness.run(`window.LegacyEditorBridge.importNews({ url: newsUrl.value })
      .then(imported => window.LegacyEditorBridge.applyPublicationContent({
        content: {
          url: newsUrl.value,
          title: imported.h1 || '',
          subtitle: imported.h2 || '',
          tag: imported.chapeu || '',
          image: imported.bg || ''
        },
        importedImage: imported.bg ? { url: newsUrl.value, value: imported.bg } : null
      }))`);
  }

  function preparePendingGeneration(harness, {
    template = 'layout-hz',
    url = 'https://example.com/a'
  } = {}) {
    const extraction = createDeferred();
    harness.run(`selectRendererState({ template: ${JSON.stringify(template)}, page: 'index', themes: [] }, null)`);
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
      prepare: harness => harness.run(`selectRendererState({ template: 'layout-hz', page: 'index', themes: [] }, 'rosa')`),
      message: 'Por favor, insira o link da not\u00edcia',
      focusField: 'newsUrl'
    },
    {
      name: 'URL da noticia invalida',
      prepare: harness => {
        harness.run(`selectRendererState({ template: 'layout-hz', page: 'index', themes: [] }, 'rosa')`);
        harness.elements.newsUrl.value = 'noticia invalida';
      },
      message: 'Por favor, insira um link v\u00e1lido',
      focusField: 'newsUrl'
    },
    {
      name: 'imagem manual invalida',
      prepare: harness => {
        harness.run(`selectRendererState({ template: 'layout-hz', page: 'index', themes: [] }, 'rosa')`);
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
    harness.run(`selectRendererState({ template: 'layout-hz', page: 'index', themes: [] }, 'rosa')`);
    harness.elements.newsUrl.value = 'https://example.com/noticia';
    harness.extractNewsData.mockResolvedValue(extractedData);

    await harness.run('generateArtWithPreviewFlow()');

    expect(harness.loadManifest).not.toHaveBeenCalled();
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
    harness.run(`selectRendererState({ template: 'layout-hz', page: 'index', themes: [] }, 'rosa')`);
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
    harness.run(`selectRendererState({ template: 'layout-hz', page: 'index', themes: [] }, 'rosa')`);
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
    expect(updatePreview).toHaveBeenLastCalledWith(expect.objectContaining({
      h1: expectedPayload.h1,
      h2: expectedPayload.h2,
      tag: expectedPayload.tag,
      bg: expectedPayload.bg,
      themeName: expectedPayload.themeName
    }));
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
    harness.run(`selectRendererState({ template: 'agazeta-foto-abaixo', page: 'index', themes: [] }, 'azul')`);
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

  test('gera depois que a bridge aplica imagem importada como data URL JPEG', async () => {
    const harness = createHarness();
    const updatePreview = jest.fn();
    const embeddedImage = 'data:image/jpeg;base64,/9j/AA==';
    harness.elements.previewFrame.contentWindow.__updatePreview = updatePreview;
    harness.run(`selectRendererState({ template: 'agazeta-foto-abaixo', page: 'index', themes: [] }, 'azul')`);
    harness.elements.newsUrl.value = 'https://www.agazeta.com.br/noticia';
    harness.extractNewsData.mockResolvedValue({
      chapeu: 'Cotidiano',
      bg: embeddedImage
    });

    await importNewsThroughBridge(harness);
    await harness.run('generateArtWithPreviewFlow()');

    expect(harness.elements.customImageUrl.value).toBe(embeddedImage);
    expect(harness.context.PreviewExport.downloadPreview).toHaveBeenCalled();
    expect(harness.elements.toastContainer.children.at(-1).innerHTML)
      .not.toContain('Informe um link de imagem v\u00e1lido (http ou https).');
    expect(harness.elements.loadingOverlay.classList.contains('show')).toBe(false);
    expect(harness.elements.generateBtn.disabled).toBe(false);
  });

  test('reutiliza a imagem extraida pela bridge em geracoes sucessivas', async () => {
    const harness = createHarness();
    const embeddedImage = 'data:image/jpeg;base64,/9j/AA==';
    harness.elements.previewFrame.contentWindow.__updatePreview = jest.fn();
    harness.run(`selectRendererState({ template: 'agazeta-foto-abaixo', page: 'index', themes: [] }, 'azul')`);
    harness.elements.newsUrl.value = 'https://www.agazeta.com.br/noticia';
    harness.extractNewsData.mockResolvedValue({
      chapeu: 'Cotidiano',
      bg: embeddedImage
    });

    await importNewsThroughBridge(harness);
    await harness.run('generateArtWithPreviewFlow()');
    await harness.run('generateArtWithPreviewFlow()');

    expect(harness.extractNewsData).toHaveBeenCalledTimes(1);
    expect(harness.context.Api.embedImage).not.toHaveBeenCalled();
    expect(harness.context.PreviewExport.downloadPreview).toHaveBeenCalledTimes(2);
  });

  test('editar data URL extraida invalida sua origem automatica e bloqueia a geracao', async () => {
    const harness = createHarness();
    harness.run(`selectRendererState({ template: 'agazeta-foto-abaixo', page: 'index', themes: [] }, 'azul')`);
    harness.elements.newsUrl.value = 'https://www.agazeta.com.br/noticia';
    harness.extractNewsData.mockResolvedValue({
      chapeu: 'Cotidiano',
      bg: 'data:image/jpeg;base64,/9j/AA=='
    });

    await importNewsThroughBridge(harness);
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
    harness.run(`selectRendererState({ template: 'agazeta-foto-abaixo', page: 'index', themes: [] }, 'azul')`);
    harness.elements.newsUrl.value = 'https://www.agazeta.com.br/noticia';
    harness.extractNewsData.mockResolvedValue({
      chapeu: 'Cotidiano',
      bg: 'data:image/jpeg;base64,/9j/AA=='
    });
    harness.context.Api.embedImage.mockResolvedValue(embeddedManualImage);

    await importNewsThroughBridge(harness);
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

  test('trocar a publication elimina a origem automatica anterior', async () => {
    const harness = createHarness();
    const embeddedImage = 'data:image/jpeg;base64,/9j/AA==';
    harness.run(`selectRendererState({ template: 'agazeta-foto-abaixo', page: 'index', themes: [] }, 'azul')`);
    harness.elements.newsUrl.value = 'https://www.agazeta.com.br/noticia';
    harness.extractNewsData.mockResolvedValue({
      chapeu: 'Cotidiano',
      bg: embeddedImage
    });

    await importNewsThroughBridge(harness);
    harness.run(`selectRendererState({ template: 'layout-hz', page: 'index', themes: [] }, 'rosa')`);
    harness.elements.newsUrl.value = 'https://example.com/outra-noticia';
    harness.elements.customImageUrl.value = embeddedImage;
    await harness.run('generateArtWithPreviewFlow()');

    expect(harness.elements.toastContainer.children.at(-1).innerHTML)
      .toContain('Informe um link de imagem v\u00e1lido (http ou https).');
    expect(harness.context.PreviewExport.downloadPreview).not.toHaveBeenCalled();
  });

  test('alterar a URL da noticia limpa a imagem automatica associada ao cache anterior', async () => {
    const harness = createHarness();
    harness.run(`selectRendererState({ template: 'agazeta-foto-abaixo', page: 'index', themes: [] }, 'azul')`);
    harness.elements.newsUrl.value = 'https://www.agazeta.com.br/noticia';
    harness.extractNewsData.mockResolvedValue({
      chapeu: 'Cotidiano',
      bg: 'data:image/jpeg;base64,/9j/AA=='
    });

    await importNewsThroughBridge(harness);
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
    harness.run(`selectRendererState({ template: 'layout-hz', page: 'index', themes: [] }, 'rosa')`);
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

    harness.run(`selectRendererState({ template: 'rede-gazeta', page: 'index', themes: [] }, null)`);
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

    harness.run(`selectRendererState({ template: 'agazeta-foto-acima', page: 'index', themes: [] }, 'azul')`);
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

  test('ignora rejeicao da extracao depois de substituir a sessao do renderer', async () => {
    const harness = createHarness();
    const extraction = createDeferred();
    const extractionStarted = createDeferred();
    harness.run(`selectRendererState({ template: 'layout-hz', page: 'index', themes: [] }, 'rosa')`);
    harness.elements.newsUrl.value = 'https://example.com/a';
    harness.extractNewsData.mockImplementation(() => {
      extractionStarted.resolve();
      return extraction.promise;
    });
    harness.elements.previewFrame.contentWindow.__updatePreview = jest.fn();

    const generation = harness.run('generateArtWithPreviewFlow()');
    await extractionStarted.promise;
    harness.run(`selectRendererState({ template: 'agazeta-foto-acima', page: 'index', themes: [] }, 'azul')`);
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
    harness.run(`selectRendererState({ template: 'layout-hz', page: 'index', themes: [] }, 'rosa')`);
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

  test('ignora rejeicao do download depois de trocar a sessao do renderer', async () => {
    const harness = createHarness();
    const download = createDeferred();
    const downloadStarted = createDeferred();
    harness.run(`selectRendererState({ template: 'layout-hz', page: 'index', themes: [] }, 'rosa')`);
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
    harness.run(`selectRendererState({ template: 'rede-gazeta', page: 'index', themes: [] }, null)`);
    download.reject(new Error('falha do download anterior'));
    await generation;

    expect(harness.elements.toastContainer.children).toHaveLength(0);
    expect(harness.state()).toMatchObject({
      currentTemplate: 'rede-gazeta'
    });
    expect(harness.elements.loadingOverlay.classList.contains('show')).toBe(false);
    expect(harness.elements.generateBtn.disabled).toBe(false);
  });

  test('usa snapshot consistente e deixa edicoes posteriores para a proxima geracao', async () => {
    const harness = createHarness();
    const extraction = createDeferred();
    harness.run(`selectRendererState({ template: 'layout-hz', page: 'index', themes: [] }, 'rosa')`);
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
    harness.run(`selectRendererState({ template: 'layout-hz', page: 'index', themes: [] }, 'rosa')`);
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

  test('bloqueia exportação quando a aplicação do payload final falha', async () => {
    const harness = createHarness();
    harness.run(`selectRendererState({ template: 'layout-hz', page: 'index', themes: [] }, 'rosa')`);
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
    harness.run(`selectRendererState({ template: 'layout-hz', page: 'index', themes: [] }, 'rosa')`);
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
    harness.run(`selectRendererState({ template: 'layout-hz', page: 'index', themes: [] }, 'rosa')`);
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
    harness.run(`selectRendererState({ template: 'layout-hz', page: 'index', themes: [] }, 'rosa')`);
    harness.elements.newsUrl.value = 'https://example.com/noticia';
    harness.extractNewsData.mockResolvedValue({
      chapeu: 'Categoria',
      bg: 'data:image/png;base64,QQ=='
    });
    harness.elements.previewFrame.contentWindow.__updatePreview = jest.fn(() => {
      harness.run(`selectRendererState({ template: 'rede-gazeta', page: 'index', themes: [] }, null)`);
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

  test.each([
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
    harness.run(`selectRendererState({ template: 'layout-hz', page: 'index', themes: [] }, 'rosa')`);
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
