const {
  nonPublicDestinations,
  publicUrl,
  redirectedPublicUrl,
} = require('../../test/helpers/remoteDestinations');

jest.mock('./safeHttpClient', () => ({
  ...jest.requireActual('./safeHttpClient'),
  get: jest.fn(),
}));

const { SafeHttpError } = jest.requireActual('./safeHttpClient');

function loadResolver() {
  jest.resetModules();
  return {
    safeHttpClient: require('./safeHttpClient'),
    resolveLogoAsset: require('./assetResolver').resolveLogoAsset,
  };
}

function svgResponse(
  finalUrl = publicUrl,
  markup = '<svg><title>Remote</title></svg>',
  remoteAddress
) {
  return {
    data: markup,
    headers: { 'content-type': 'image/svg+xml' },
    request: { res: { responseUrl: finalUrl }, socket: { remoteAddress } },
  };
}

describe('resolveLogoAsset com SVG remoto simulado', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('carrega SVG de URL pública com a configuração atual', async () => {
    const { safeHttpClient: currentClient, resolveLogoAsset } = loadResolver();
    currentClient.get.mockResolvedValue(svgResponse());

    await expect(resolveLogoAsset(publicUrl, 'Logo')).resolves.toMatchObject({
      kind: 'inline-svg',
      markup: '<svg><title>Remote</title></svg>',
      source: publicUrl,
      sourceType: 'remote',
      alt: 'Logo',
    });
    expect(currentClient.get).toHaveBeenCalledWith(publicUrl, {
      responseType: 'text',
      timeout: 10000,
      maxBytes: 1024 * 1024,
      maxRedirects: 3,
    });
  });

  test('não baixa imagem remota não SVG e preserva seu modelo', async () => {
    const { safeHttpClient: currentClient, resolveLogoAsset } = loadResolver();
    const imageUrl = 'https://cdn.example/logo.png';

    await expect(resolveLogoAsset(imageUrl, 'Logo')).resolves.toEqual({
      kind: 'image',
      src: imageUrl,
      source: imageUrl,
      sourceType: 'remote',
      alt: 'Logo',
    });
    expect(currentClient.get).not.toHaveBeenCalled();
  });

  test('reutiliza SVG remoto em cache e aplica o alt explícito de cada chamada', async () => {
    const { safeHttpClient: currentClient, resolveLogoAsset } = loadResolver();
    currentClient.get.mockResolvedValue(svgResponse());

    const first = await resolveLogoAsset(publicUrl, 'Logo A');
    const second = await resolveLogoAsset(publicUrl, 'Logo B');

    expect(first).toMatchObject({ kind: 'inline-svg', alt: 'Logo A' });
    expect(second).toMatchObject({ kind: 'inline-svg', alt: 'Logo B' });
    expect(currentClient.get).toHaveBeenCalledTimes(1);
  });

  test('propaga timeout do download de SVG', async () => {
    const { safeHttpClient: currentClient, resolveLogoAsset } = loadResolver();
    const error = new SafeHttpError('TIMEOUT');
    currentClient.get.mockRejectedValue(error);

    await expect(resolveLogoAsset(publicUrl)).rejects.toBe(error);
    expect(currentClient.get.mock.calls[0][1].timeout).toBe(10000);
  });

  test('rejeita SVG acima de 1 MB', async () => {
    const { safeHttpClient: currentClient, resolveLogoAsset } = loadResolver();
    currentClient.get.mockRejectedValue(new SafeHttpError('RESPONSE_TOO_LARGE'));

    await expect(resolveLogoAsset(publicUrl)).rejects.toMatchObject({
      code: 'RESPONSE_TOO_LARGE',
    });
    expect(currentClient.get.mock.calls[0][1].maxBytes).toBe(1024 * 1024);
  });

  test.each(['text/html', 'text/plain', 'image/png'])(
    'rejeita MIME incompatível com SVG: %s',
    async (contentType) => {
      const { safeHttpClient: currentClient, resolveLogoAsset } = loadResolver();
      currentClient.get.mockResolvedValue({
        ...svgResponse(),
        headers: { 'content-type': contentType },
      });

      await expect(resolveLogoAsset(publicUrl)).rejects.toMatchObject({
        code: 'UNEXPECTED_CONTENT_TYPE',
      });
    }
  );

  test('aceita image/svg+xml com parâmetros', async () => {
    const { safeHttpClient: currentClient, resolveLogoAsset } = loadResolver();
    currentClient.get.mockResolvedValue({
      ...svgResponse(),
      headers: { 'content-type': 'image/svg+xml; charset=utf-8' },
    });

    await expect(resolveLogoAsset(publicUrl)).resolves.toMatchObject({ kind: 'inline-svg' });
  });

  test('rejeita SVG remoto sem Content-Type', async () => {
    const { safeHttpClient: currentClient, resolveLogoAsset } = loadResolver();
    currentClient.get.mockResolvedValue({
      ...svgResponse(),
      headers: {},
    });

    await expect(resolveLogoAsset(publicUrl)).rejects.toMatchObject({
      code: 'UNEXPECTED_CONTENT_TYPE',
    });
  });

  test.each([
    '<svg><script>alert(1)</script><path d="M0 0h1v1z"/></svg>',
    '<svg><foreignObject><iframe src="https://evil.test"/></foreignObject></svg>',
    '<svg><path onload="steal()" fill="url(javascript:alert(1))"/></svg>',
  ])('remove conteúdo ativo de SVG remoto: %s', async (markup) => {
    const { safeHttpClient: currentClient, resolveLogoAsset } = loadResolver();
    currentClient.get.mockResolvedValue(svgResponse(publicUrl, markup));

    const result = await resolveLogoAsset(publicUrl);

    expect(result.kind).toBe('inline-svg');
    expect(result.markup).not.toMatch(
      /script|foreignObject|iframe|onload|javascript:|evil\.test/i
    );
  });

  test('rejeita XML remoto malformado', async () => {
    const { safeHttpClient: currentClient, resolveLogoAsset } = loadResolver();
    currentClient.get.mockResolvedValue(svgResponse(publicUrl, '<svg><g></svg>'));

    await expect(resolveLogoAsset(publicUrl)).rejects.toMatchObject({
      code: 'INVALID_SVG',
      message: 'Conteúdo SVG inválido ou não permitido',
    });
  });

  test('aceita redirecionamento público com limite configurado pelo módulo', async () => {
    const { safeHttpClient: currentClient, resolveLogoAsset } = loadResolver();
    currentClient.get.mockResolvedValue(svgResponse(redirectedPublicUrl));

    await expect(resolveLogoAsset(publicUrl)).resolves.toMatchObject({ kind: 'inline-svg' });
    expect(currentClient.get.mock.calls[0][1].maxRedirects).toBe(3);
  });

  test.each(nonPublicDestinations)(
    'carrega SVG de destino não público: %s',
    async (_, url) => {
      const { safeHttpClient: currentClient, resolveLogoAsset } = loadResolver();
      currentClient.get.mockRejectedValue(new SafeHttpError('BLOCKED_ADDRESS'));

      await expect(resolveLogoAsset(url)).rejects.toMatchObject({ code: 'BLOCKED_ADDRESS' });
      expect(currentClient.get).toHaveBeenCalledWith(url, expect.any(Object));
    }
  );

  test('rejeita redirecionamento de endereço público para privado', async () => {
    const { safeHttpClient: currentClient, resolveLogoAsset } = loadResolver();
    currentClient.get.mockRejectedValue(new SafeHttpError('BLOCKED_ADDRESS'));

    await expect(resolveLogoAsset(publicUrl)).rejects.toMatchObject({ code: 'BLOCKED_ADDRESS' });
  });
});
