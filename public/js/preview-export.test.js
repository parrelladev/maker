const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createImage({ complete = false, naturalWidth = 0, src = 'data:image/png;base64,QQ==' } = {}) {
  const listeners = {};
  return {
    complete,
    naturalWidth,
    src,
    currentSrc: src,
    addEventListener: jest.fn((type, listener) => {
      listeners[type] = listener;
    }),
    dispatch(type) {
      listeners[type]?.();
    }
  };
}

function createHarness(images = []) {
  const link = {
    click: jest.fn(),
    remove: jest.fn()
  };
  const document = {
    body: { appendChild: jest.fn() },
    createElement: jest.fn(() => link)
  };
  const context = {
    Blob,
    document,
    fetch: jest.fn().mockResolvedValue({ ok: true }),
    setTimeout: jest.fn(),
    URL: {
      createObjectURL: jest.fn(() => 'blob:preview'),
      revokeObjectURL: jest.fn()
    }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, 'preview-export.js'), 'utf8'),
    context,
    { filename: 'public/js/preview-export.js' }
  );

  const toBlob = jest.fn().mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
  const frameDocument = {
    documentElement: {},
    fonts: { ready: Promise.resolve() },
    images
  };
  const frame = {
    contentDocument: frameDocument,
    contentWindow: { htmlToImage: { toBlob } }
  };

  return { context, frame, link, toBlob };
}

async function flushMicrotasks() {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
}

describe('PreviewExport.downloadPreview', () => {
  test('continua quando a imagem já está carregada e possui dimensões', async () => {
    const image = createImage({ complete: true, naturalWidth: 640 });
    image.decode = jest.fn().mockResolvedValue();
    const harness = createHarness([image]);

    await harness.context.PreviewExport.downloadPreview(harness.frame, {});

    expect(image.decode).toHaveBeenCalledTimes(1);
    expect(harness.toBlob).toHaveBeenCalledTimes(1);
  });

  test('verifica URL HTTP depois de confirmar que a imagem foi carregada', async () => {
    const image = createImage({
      complete: true,
      naturalWidth: 640,
      src: 'https://example.com/imagem.png'
    });
    const harness = createHarness([image]);

    await harness.context.PreviewExport.downloadPreview(harness.frame, {});

    expect(harness.context.fetch).toHaveBeenCalledWith(
      'https://example.com/imagem.png',
      { mode: 'cors' }
    );
    expect(harness.toBlob).toHaveBeenCalledTimes(1);
  });

  test('aguarda load de uma imagem que ainda está carregando', async () => {
    const image = createImage();
    const harness = createHarness([image]);

    const download = harness.context.PreviewExport.downloadPreview(harness.frame, {});
    await flushMicrotasks();
    image.naturalWidth = 640;
    image.dispatch('load');
    await download;

    expect(harness.toBlob).toHaveBeenCalledTimes(1);
  });

  test('bloqueia captura quando uma imagem em carregamento emite error', async () => {
    const image = createImage();
    const harness = createHarness([image]);

    const download = harness.context.PreviewExport.downloadPreview(harness.frame, {});
    await flushMicrotasks();
    image.dispatch('error');

    await expect(download).rejects.toThrow('Não foi possível carregar uma imagem do preview');
    expect(harness.toBlob).not.toHaveBeenCalled();
  });

  test('rejeita imediatamente imagem completa sem dimensões', async () => {
    const image = createImage({ complete: true, naturalWidth: 0 });
    const harness = createHarness([image]);

    await expect(harness.context.PreviewExport.downloadPreview(harness.frame, {}))
      .rejects.toThrow('Não foi possível carregar uma imagem do preview');
    expect(image.addEventListener).not.toHaveBeenCalled();
    expect(harness.toBlob).not.toHaveBeenCalled();
  });

  test('mantém decode rejeitado como best-effort para imagem já válida', async () => {
    const image = createImage({ complete: true, naturalWidth: 640 });
    image.decode = jest.fn().mockRejectedValue(new Error('decode não suportado'));
    const harness = createHarness([image]);

    await expect(harness.context.PreviewExport.downloadPreview(harness.frame, {}))
      .resolves.toBeUndefined();
    expect(harness.toBlob).toHaveBeenCalledTimes(1);
  });
});
