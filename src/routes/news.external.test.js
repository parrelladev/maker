const http = require('http');
const {
  nonPublicDestinations,
  publicUrl,
  redirectedPublicUrl,
  redirectedPrivateUrl,
} = require('../../test/helpers/remoteDestinations');

jest.mock('axios');
jest.mock('../services/newsScraper');

async function withNewsServer(callback) {
  jest.resetModules();
  const express = require('express');
  const newsRouter = require('./news');
  const app = express();
  app.use(express.json());
  app.use('/api/news', newsRouter);

  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const { port } = server.address();
    return await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function postImage(baseUrl, url) {
  const response = await fetch(`${baseUrl}/api/news/embed-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  return { response, body: await response.json() };
}

function mockImageResponse(finalUrl = publicUrl, remoteAddress) {
  require('axios').get.mockResolvedValue({
    data: Buffer.from('fixture-image'),
    headers: { 'content-type': 'image/png' },
    request: { res: { responseUrl: finalUrl }, socket: { remoteAddress } },
  });
}

describe('incorporação de imagem com respostas HTTP simuladas', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('incorpora imagem de URL pública com os limites atuais', async () => {
    await withNewsServer(async (baseUrl) => {
      mockImageResponse();

      const { response, body } = await postImage(baseUrl, publicUrl);

      expect(response.status).toBe(200);
      expect(body.dataUrl).toBe(
        `data:image/png;base64,${Buffer.from('fixture-image').toString('base64')}`
      );
      expect(require('axios').get).toHaveBeenCalledWith(publicUrl, {
        responseType: 'arraybuffer',
        timeout: 15000,
        maxContentLength: 12 * 1024 * 1024,
        maxBodyLength: 12 * 1024 * 1024,
        maxRedirects: 3,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Maker/1.0)' },
      });
    });
  });

  test('converte timeout do download em resposta 422', async () => {
    await withNewsServer(async (baseUrl) => {
      require('axios').get.mockRejectedValue(
        Object.assign(new Error('timeout'), { code: 'ECONNABORTED' })
      );

      const { response, body } = await postImage(baseUrl, publicUrl);

      expect(response.status).toBe(422);
      expect(body.detail).toBe('timeout');
    });
  });

  test('converte rejeição por resposta acima de 12 MB em resposta 422', async () => {
    await withNewsServer(async (baseUrl) => {
      require('axios').get.mockRejectedValue(
        Object.assign(new Error('maxContentLength size exceeded'), {
          code: 'ERR_BAD_RESPONSE',
        })
      );

      const { response, body } = await postImage(baseUrl, publicUrl);

      expect(response.status).toBe(422);
      expect(body.detail).toContain('maxContentLength');
      expect(require('axios').get.mock.calls[0][1].maxContentLength).toBe(12 * 1024 * 1024);
    });
  });

  test('rejeita conteúdo com tipo inesperado', async () => {
    await withNewsServer(async (baseUrl) => {
      require('axios').get.mockResolvedValue({
        data: Buffer.from('not-an-image'),
        headers: { 'content-type': 'text/plain' },
      });

      const { response, body } = await postImage(baseUrl, publicUrl);

      expect(response.status).toBe(422);
      expect(body.detail).toContain('tipo válido');
    });
  });

  test('aceita redirecionamento público dentro do limite configurado', async () => {
    await withNewsServer(async (baseUrl) => {
      mockImageResponse(redirectedPublicUrl);

      const { response } = await postImage(baseUrl, publicUrl);

      expect(response.status).toBe(200);
      expect(require('axios').get.mock.calls[0][1].maxRedirects).toBe(3);
    });
  });

  test.each(nonPublicDestinations)(
    'incorpora destino não público: %s',
    async (_, url, remoteAddress) => {
      await withNewsServer(async (baseUrl) => {
        mockImageResponse(url, remoteAddress);

        const { response } = await postImage(baseUrl, url);

        expect(response.status).toBe(200);
        expect(require('axios').get).toHaveBeenCalledWith(url, expect.any(Object));
      });
    }
  );

  test('não rejeita redirecionamento de endereço público para privado', async () => {
    await withNewsServer(async (baseUrl) => {
      mockImageResponse(redirectedPrivateUrl);

      const { response } = await postImage(baseUrl, publicUrl);

      expect(response.status).toBe(200);
    });
  });
});
