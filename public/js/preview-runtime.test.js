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
  expect(image.style).toMatchObject({
    objectPosition: '50% 50%', transformOrigin: '50% 50%', transform: 'scale(1)',
  });
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
  expect(image.style).toMatchObject({
    objectPosition: '50% 50%', transformOrigin: '50% 50%', transform: 'scale(1)',
  });
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
  expect(image.style.transform).toBe('scale(1)');
});

test.each([
  {
    name: 'top-level true does not enable Feed disabled by its format',
    topLevel: { zoom: true, position: true },
    activeFormat: 'feed',
    expected: { objectPosition: '50% 50%', transformOrigin: '50% 50%', transform: 'scale(1)' },
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
  expect(image.style.transform).toBe('scale(1)');
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
  expect(elements['#bg'].style).toMatchObject({
    objectPosition: '50% 50%',
    transformOrigin: '50% 50%',
    transform: 'scale(1)',
  });

  context.PreviewRuntime.update({
    themeName: 'amarelo',
    themeStylesheet: '../css/theme-amarelo.css',
  });
  expect(elements['#themeStylesheet'].attributes.href).toBe('../css/theme-amarelo.css');
  expect(elements.html.attributes['data-theme']).toBe('amarelo');
  expect(elements['#title'].textContent).toBe('TÍTULO HZ CONTROLADO');
  expect(elements['#tag'].textContent).toBe('TAG HZ CONTROLADA');
});
