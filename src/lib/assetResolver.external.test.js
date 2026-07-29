const {
  nonPublicDestinations,
  publicUrl,
  redirectedPublicUrl,
  redirectedPrivateUrl,
} = require('../../test/helpers/remoteDestinations');

jest.mock('axios');

function loadResolver() {
  jest.resetModules();
  return {
    axios: require('axios'),
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
    const { axios: currentAxios, resolveLogoAsset } = loadResolver();
    currentAxios.get.mockResolvedValue(svgResponse());

    await expect(resolveLogoAsset(publicUrl, 'Logo')).resolves.toMatchObject({
      kind: 'inline-svg',
      markup: '<svg><title>Remote</title></svg>',
      source: publicUrl,
      sourceType: 'remote',
      alt: 'Logo',
    });
    expect(currentAxios.get).toHaveBeenCalledWith(publicUrl, { responseType: 'text' });
  });

  test('propaga timeout do download de SVG', async () => {
    const { axios: currentAxios, resolveLogoAsset } = loadResolver();
    const error = Object.assign(new Error('timeout'), { code: 'ECONNABORTED' });
    currentAxios.get.mockRejectedValue(error);

    await expect(resolveLogoAsset(publicUrl)).rejects.toBe(error);
    expect(currentAxios.get.mock.calls[0][1]).not.toHaveProperty('timeout');
  });

  test('aceita SVG acima de 12 MB porque não configura limite', async () => {
    const { axios: currentAxios, resolveLogoAsset } = loadResolver();
    const oversizedSvg = `<svg><!--${'x'.repeat(12 * 1024 * 1024 + 1)}--></svg>`;
    currentAxios.get.mockResolvedValue(svgResponse(publicUrl, oversizedSvg));

    await expect(resolveLogoAsset(publicUrl)).resolves.toMatchObject({ kind: 'inline-svg' });
    expect(currentAxios.get.mock.calls[0][1]).not.toHaveProperty('maxContentLength');
    expect(currentAxios.get.mock.calls[0][1]).not.toHaveProperty('maxBodyLength');
  });

  test('aceita tipo inesperado quando o texto contém SVG', async () => {
    const { axios: currentAxios, resolveLogoAsset } = loadResolver();
    currentAxios.get.mockResolvedValue({
      ...svgResponse(),
      headers: { 'content-type': 'text/html' },
    });

    await expect(resolveLogoAsset(publicUrl)).resolves.toMatchObject({ kind: 'inline-svg' });
  });

  test('aceita redirecionamento público sem limite configurado pelo módulo', async () => {
    const { axios: currentAxios, resolveLogoAsset } = loadResolver();
    currentAxios.get.mockResolvedValue(svgResponse(redirectedPublicUrl));

    await expect(resolveLogoAsset(publicUrl)).resolves.toMatchObject({ kind: 'inline-svg' });
    expect(currentAxios.get.mock.calls[0][1]).not.toHaveProperty('maxRedirects');
  });

  test.each(nonPublicDestinations)(
    'carrega SVG de destino não público: %s',
    async (_, url, remoteAddress) => {
      const { axios: currentAxios, resolveLogoAsset } = loadResolver();
      currentAxios.get.mockResolvedValue(svgResponse(url, undefined, remoteAddress));

      await expect(resolveLogoAsset(url)).resolves.toMatchObject({ kind: 'inline-svg' });
      expect(currentAxios.get).toHaveBeenCalledWith(url, { responseType: 'text' });
    }
  );

  test('não rejeita redirecionamento de endereço público para privado', async () => {
    const { axios: currentAxios, resolveLogoAsset } = loadResolver();
    currentAxios.get.mockResolvedValue(svgResponse(redirectedPrivateUrl));

    await expect(resolveLogoAsset(publicUrl)).resolves.toMatchObject({ kind: 'inline-svg' });
  });
});
