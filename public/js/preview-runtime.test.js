const fs = require('fs');
const path = require('path');
const vm = require('vm');

function runtimeHarness(manifest) {
  const image = { style: {}, src: '' };
  const context = {
    document: {
      documentElement: { style: {}, clientWidth: 1080, clientHeight: 1920 },
      body: { style: {} },
      querySelectorAll: selector => selector === '#bg' ? [image] : [],
    },
    innerWidth: 1080, innerHeight: 1920,
    addEventListener: jest.fn(), setTimeout: jest.fn(), console,
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'preview-runtime.js'), 'utf8'), context);
  context.PreviewRuntime.initialize({
    bindings: [{ selector: '#bg', type: 'image', field: 'resolvedBg' }],
    ...manifest,
  });
  return { context, image };
}

test('runtime aplica zoom e posiÃ§Ã£o na imagem vinculada quando suportados', () => {
  const { context, image } = runtimeHarness({
    formats: { story: { capabilities: { imageAdjustments: { zoom: true, position: true } } } },
  });
  context.PreviewRuntime.update({
    resolvedBg: 'image-data', imageAdjustments: { zoom: 1.5, x: 25, y: 80 },
  });
  expect(image).toMatchObject({
    src: 'image-data',
    style: { objectPosition: '25% 80%', transformOrigin: '25% 80%', transform: 'scale(1.5)' },
  });
});

test('runtime ignora ajustes quando nÃ£o hÃ¡ capability', () => {
  const { context, image } = runtimeHarness({});
  context.PreviewRuntime.update({
    resolvedBg: 'image', imageAdjustments: { zoom: 2, x: 10, y: 90 },
  });
  expect(image.style).toEqual({});
});

test('runtime uses explicit Story even when Feed is the first key', () => {
  const { context, image } = runtimeHarness({
    formats: {
      feed: { capabilities: { imageAdjustments: { zoom: false, position: false } } },
      story: { capabilities: { imageAdjustments: { zoom: true, position: true } } },
    },
  });
  context.PreviewRuntime.update({
    activeFormat: 'story', resolvedBg: 'image', imageAdjustments: { zoom: 1.5, x: 25, y: 80 },
  });
  expect(image.style).toMatchObject({
    objectPosition: '25% 80%', transformOrigin: '25% 80%', transform: 'scale(1.5)',
  });
});

test('runtime uses explicit Feed and does not inherit Story capabilities', () => {
  const { context, image } = runtimeHarness({
    formats: {
      story: { capabilities: { imageAdjustments: { zoom: true, position: true } } },
      feed: { capabilities: { imageAdjustments: { zoom: false, position: false } } },
    },
  });
  context.PreviewRuntime.update({
    activeFormat: 'feed', resolvedBg: 'image', imageAdjustments: { zoom: 1.5, x: 25, y: 80 },
  });
  expect(image.style).toEqual({});
});

test('multi-format manifest without activeFormat does not infer by key order', () => {
  const { context, image } = runtimeHarness({
    formats: {
      story: { capabilities: { imageAdjustments: { zoom: true, position: true } } },
      feed: { capabilities: { imageAdjustments: { zoom: false, position: false } } },
    },
  });
  context.PreviewRuntime.update({
    resolvedBg: 'image', imageAdjustments: { zoom: 2, x: 10, y: 90 },
  });
  expect(image.style.transform).toBeUndefined();
});

test.each([
  {
    name: 'top-level true does not enable Feed disabled by its format',
    topLevel: { zoom: true, position: true },
    activeFormat: 'feed',
    expected: {},
  },
  {
    name: 'top-level false does not disable Story enabled by its format',
    topLevel: { zoom: false, position: false },
    activeFormat: 'story',
    expected: { objectPosition: '25% 80%', transformOrigin: '25% 80%', transform: 'scale(1.5)' },
  },
])('$name', ({ topLevel, activeFormat, expected }) => {
  const { context, image } = runtimeHarness({
    capabilities: { imageAdjustments: topLevel },
    formats: {
      story: { capabilities: { imageAdjustments: { zoom: true, position: true } } },
      feed: { capabilities: { imageAdjustments: { zoom: false, position: false } } },
    },
  });
  context.PreviewRuntime.update({
    activeFormat, resolvedBg: 'image', imageAdjustments: { zoom: 1.5, x: 25, y: 80 },
  });
  expect(image.style).toMatchObject(expected);
});

test('top-level capabilities are ignored when a multi-format manifest has no activeFormat', () => {
  const { context, image } = runtimeHarness({
    capabilities: { imageAdjustments: { zoom: true, position: true } },
    formats: {
      story: { capabilities: { imageAdjustments: { zoom: true, position: true } } },
      feed: { capabilities: { imageAdjustments: { zoom: false, position: false } } },
    },
  });
  context.PreviewRuntime.update({
    resolvedBg: 'image', imageAdjustments: { zoom: 1.5, x: 25, y: 80 },
  });
  expect(image.style.transform).toBeUndefined();
});

test('renderer HZ legado aplica payload e themes sem criar o subtitle ausente', () => {
  const manifest = JSON.parse(fs.readFileSync(
    path.resolve('templates/layout-hz/index/manifest.json'), 'utf8'
  ));
  const html = fs.readFileSync(path.resolve('templates/layout-hz/index/index.html'), 'utf8');
  const elements = {
    '#bg': { tagName: 'IMG', style: { transform: 'translateX(-50%)' }, src: '' },
    '#logo': { tagName: 'DIV', style: {}, innerHTML: '' },
    '#title': { tagName: 'H1', style: {}, textContent: '' },
    '#tag': { tagName: 'SPAN', style: {}, textContent: '' },
    '#themeStylesheet': {
      tagName: 'LINK', style: {}, attributes: { href: '../css/theme-rosa.css' },
      setAttribute(name, value) { this.attributes[name] = value; },
    },
    html: {
      tagName: 'HTML', style: {}, attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; },
    },
  };
  const context = {
    document: {
      documentElement: elements.html,
      body: { style: {} },
      querySelectorAll: selector => elements[selector] ? [elements[selector]] : [],
    },
    innerWidth: 1080,
    innerHeight: 1920,
    addEventListener: jest.fn(),
    setTimeout: jest.fn(),
    console,
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'preview-runtime.js'), 'utf8'), context);
  context.PreviewRuntime.initialize(manifest);

  expect(html).not.toContain('id="subtitle"');
  expect(() => context.PreviewRuntime.update({
    resolvedBg: 'data:image/png;base64,SU1BR0VN',
    resolvedLogo: { kind: 'image', src: '/input/logo-hz.png' },
    h1: 'TÍTULO HZ CONTROLADO',
    h2: 'SUBTÍTULO HZ SEM ELEMENTO',
    tag: 'TAG HZ CONTROLADA',
    themeName: 'rosa',
    themeStylesheet: '../css/theme-rosa.css',
    imageAdjustments: { zoom: 2, x: 10, y: 90 },
  })).not.toThrow();

  expect(elements['#bg'].src).toBe('data:image/png;base64,SU1BR0VN');
  expect(elements['#logo'].style.backgroundImage).toBe('url(/input/logo-hz.png)');
  expect(elements['#title'].textContent).toBe('TÍTULO HZ CONTROLADO');
  expect(elements['#tag'].textContent).toBe('TAG HZ CONTROLADA');
  expect(elements['#themeStylesheet'].attributes.href).toBe('../css/theme-rosa.css');
  expect(elements.html.attributes['data-theme']).toBe('rosa');
  expect(elements['#bg'].style.transform).toBe('translateX(-50%)');

  context.PreviewRuntime.update({
    themeName: 'amarelo',
    themeStylesheet: '../css/theme-amarelo.css',
  });
  expect(elements['#themeStylesheet'].attributes.href).toBe('../css/theme-amarelo.css');
  expect(elements.html.attributes['data-theme']).toBe('amarelo');
  expect(elements['#title'].textContent).toBe('TÍTULO HZ CONTROLADO');
  expect(elements['#tag'].textContent).toBe('TAG HZ CONTROLADA');
});

function stylesheetRuntimeHarness() {
  const listeners = { load: [], error: [] };
  const link = {
    tagName: 'LINK', rel: 'stylesheet', sheet: {}, style: {},
    attributes: { href: '../css/theme-rosa.css' },
    getAttribute(name) { return this.attributes[name]; },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(type, listener) { listeners[type].push(listener); },
    removeEventListener(type, listener) {
      listeners[type] = listeners[type].filter(candidate => candidate !== listener);
    },
  };
  const context = {
    document: {
      documentElement: { style: {}, clientWidth: 1080, clientHeight: 1920 },
      body: { style: {} },
      querySelectorAll: selector => selector === '#themeStylesheet' ? [link] : [],
    },
    innerWidth: 1080, innerHeight: 1920,
    addEventListener: jest.fn(), setTimeout: jest.fn(),
    console: { error: jest.fn() },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'preview-runtime.js'), 'utf8'), context);
  context.PreviewRuntime.initialize({
    dimensions: { width: 1080, height: 1920 },
    attributes: [{
      selector: '#themeStylesheet', type: 'attribute', name: 'href', field: 'themeStylesheet',
    }],
  });
  return { context, link, listeners };
}

test('mudanca de theme aguarda load do novo stylesheet antes da readiness', async () => {
  const { context, link, listeners } = stylesheetRuntimeHarness();
  let settled = false;
  const update = context.PreviewRuntime.update({ themeStylesheet: '../css/theme-amarelo.css' })
    .then(() => { settled = true; });
  await Promise.resolve();
  expect(link.attributes.href).toBe('../css/theme-amarelo.css');
  expect(settled).toBe(false);
  listeners.load[0]();
  await update;
  expect(settled).toBe(true);
});

test('erro do stylesheet rejeita a atualizacao e nao declara preview pronto', async () => {
  const { context, listeners } = stylesheetRuntimeHarness();
  const update = context.PreviewRuntime.update({ themeStylesheet: '../css/theme-amarelo.css' });
  listeners.error[0]();
  await expect(update).rejects.toThrow('Falha ao carregar stylesheet');
});

test('evento stale nao libera uma atualizacao de theme mais nova', async () => {
  const { context, listeners } = stylesheetRuntimeHarness();
  const first = context.PreviewRuntime.update({ themeStylesheet: '../css/theme-amarelo.css' });
  const staleLoad = listeners.load[0];
  const second = context.PreviewRuntime.update({ themeStylesheet: '../css/theme-rosa.css' });
  await expect(first).rejects.toThrow('obsoleta');
  let secondSettled = false;
  second.then(() => { secondSettled = true; });
  staleLoad();
  await Promise.resolve();
  expect(secondSettled).toBe(false);
  listeners.load[0]();
  await second;
  expect(secondSettled).toBe(true);
});

test('mesmo href apos error inicia novo carregamento e so resolve no novo load', async () => {
  const { context, link, listeners } = stylesheetRuntimeHarness();
  const first = context.PreviewRuntime.update({ themeStylesheet: '../css/theme-amarelo.css' });
  const staleLoad = listeners.load[0];
  listeners.error[0]();
  await expect(first).rejects.toThrow('Falha ao carregar stylesheet');

  let retrySettled = false;
  const retry = context.PreviewRuntime.update({ themeStylesheet: '../css/theme-amarelo.css' })
    .then(() => { retrySettled = true; });
  await Promise.resolve();
  expect(link.attributes.href).toBe('../css/theme-amarelo.css');
  expect(retrySettled).toBe(false);

  staleLoad();
  await Promise.resolve();
  expect(retrySettled).toBe(false);
  listeners.load[0]();
  await retry;
  expect(retrySettled).toBe(true);
});

test('mesmo href comprovadamente carregado resolve sem aguardar outro evento', async () => {
  const { context, listeners } = stylesheetRuntimeHarness();
  const first = context.PreviewRuntime.update({ themeStylesheet: '../css/theme-amarelo.css' });
  listeners.load[0]();
  await first;
  await expect(context.PreviewRuntime.update({
    themeStylesheet: '../css/theme-amarelo.css',
  })).resolves.toEqual([]);
  expect(listeners.load).toHaveLength(0);
  expect(listeners.error).toHaveLength(0);
});

test('voltar de B carregado para A exige novo load em vez de cache historico', async () => {
  const { context, listeners } = stylesheetRuntimeHarness();
  const toB = context.PreviewRuntime.update({ themeStylesheet: '../css/theme-amarelo.css' });
  listeners.load[0]();
  await toB;

  let backToASettled = false;
  const backToA = context.PreviewRuntime.update({ themeStylesheet: '../css/theme-rosa.css' })
    .then(() => { backToASettled = true; });
  await Promise.resolve();
  expect(backToASettled).toBe(false);
  listeners.load[0]();
  await backToA;
  expect(backToASettled).toBe(true);
});
