const EditorUi = require('./editor-ui');
const EditorState = require('./editor-state');
const Catalog = require('./editor-catalog');

class FakeElement {
  constructor() {
    this.children = [];
    this.dataset = {};
    this.listeners = {};
    this.attributes = {};
    this.classList = { add: jest.fn() };
    this.disabled = false;
    this.value = '';
    this.textContent = '';
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
    status: new FakeElement(), newArtwork: new FakeElement(), feed: new FakeElement(), compare: new FakeElement(),
    downloadCurrent: new FakeElement(),
  };
  elements.status.statusText = new FakeElement();
  const fields = ['url', 'title', 'subtitle', 'tag', 'image'].map(name => {
    const field = new FakeElement(); field.dataset.field = name; return field;
  });
  const selectors = {
    '[data-control="brand"]': elements.brand, '[data-control="family"]': elements.family,
    '[data-control="variants"]': elements.variants, '[data-control="themes"]': elements.themes,
    '[data-editor-status]': elements.status, '[data-action="new-artwork"]': elements.newArtwork,
    '[data-action="download-current"]': elements.downloadCurrent,
  };
  const document = {
    querySelector: selector => selectors[selector] || null,
    querySelectorAll: selector => {
      if (selector === '[data-field]') return fields;
      if (selector.includes('data-view-mode')) return [elements.feed, elements.compare];
      return [];
    },
    createElement: () => new FakeElement(),
  };
  return { document, elements, fields };
}

const syntheticCatalog = { brands: [{ id: 'brand-x', name: 'Brand X', families: [{
  id: 'family-y', label: 'family-y', variants: [
    { id: 'feed-only', label: 'Feed only', formats: [{ id: 'feed', themes: [] }] },
    { id: 'variant-z', label: 'Variant Z', formats: [{ id: 'story', themes: [{ id: 'green', label: 'Green' }, { id: 'black', label: 'Black' }] }] },
    { id: 'variant-q', label: 'Variant Q', formats: [{ id: 'story', themes: [{ id: 'white', label: 'White' }] }] },
  ],
}, { id: 'family-two', label: 'family-two', variants: [
  { id: 'variant-two', label: 'Variant Two', formats: [{ id: 'story', themes: [{ id: 'orange', label: 'Orange' }] }] },
]}] }, {
  id: 'brand-two', name: 'Brand Two', families: [{ id: 'family-b', label: 'family-b', variants: [
    { id: 'variant-b', label: 'Variant B', formats: [{ id: 'story', themes: [{ id: 'purple', label: 'Purple' }] }] },
  ] }],
}] };

function setup(overrides = {}) {
  const dom = fixture();
  const api = {
    getEditorCatalog: jest.fn().mockResolvedValue(syntheticCatalog),
    resolveEditorRenderer: jest.fn().mockResolvedValue({ template: 'renderer-z', page: 'index', themes: [{ id: 'green', label: 'Green' }] }),
    ...overrides.api,
  };
  const legacyBridge = {
    selectRenderer: jest.fn().mockResolvedValue(),
    selectTheme: jest.fn(),
    setEditorPreviewReady: jest.fn(ready => { dom.elements.downloadCurrent.disabled = !ready; }),
    ...overrides.legacyBridge,
  };
  const controller = EditorUi.createEditorController({
    document: dom.document, api, state: EditorState, catalogHelpers: Catalog, legacyBridge,
  });
  return { ...dom, api, legacyBridge, controller };
}

describe('controller/UI editorial', () => {
  test('catálogo sintético preenche controles e publication sem conhecer A Gazeta', async () => {
    const harness = setup();
    await harness.controller.initialize();
    expect(harness.elements.brand.children.map(item => [item.value, item.textContent])).toEqual([['brand-x', 'Brand X'], ['brand-two', 'Brand Two']]);
    expect(harness.elements.family.children[0].textContent).toBe('family-y');
    expect(harness.elements.variants.children.map(item => item.textContent)).toEqual(['Variant Z', 'Variant Q']);
    expect(harness.elements.variants.children[0].attributes['aria-pressed']).toBe('true');
    expect(harness.elements.themes.children.map(item => item.textContent)).toEqual(['Green', 'Black']);
    expect(harness.controller.getPublication()).toMatchObject({
      brand: 'brand-x', family: 'family-y', formats: { story: { variant: 'variant-z', theme: 'green' } },
    });
    expect(harness.controller.getPreviewState()).toBe('ready');
    expect(harness.elements.downloadCurrent.disabled).toBe(false);
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
    expect(harness.legacyBridge.selectTheme).toHaveBeenCalledWith('white');
    expect(harness.elements.downloadCurrent.disabled).toBe(false);
    expect(harness.elements.status.statusText.textContent).toBe('Pronto');
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
    expect(harness.controller.getPublication()).toMatchObject({ content: { title: '' }, formats: { story: { variant: 'variant-z', theme: 'green' } } });
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
    finishReset({ template: 'renderer-default', page: 'index', themes: [] });
    await reset;
    expect(harness.controller.getPreviewState()).toBe('ready');
    expect(harness.elements.downloadCurrent.disabled).toBe(false);
  });
});
