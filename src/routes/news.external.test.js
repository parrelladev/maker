const http = require('http');
const {
  nonPublicDestinations,
  publicUrl,
  redirectedPublicUrl,
} = require('../../test/helpers/remoteDestinations');

jest.mock('../services/newsScraper');
jest.mock('../lib/safeHttpClient', () => ({
  ...jest.requireActual('../lib/safeHttpClient'),
  get: jest.fn(),
}));

const { SafeHttpError } = jest.requireActual('../lib/safeHttpClient');
const PNG_IMAGE = Buffer.from('89504e470d0a1a0a00000000', 'hex');

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

async function postNews(baseUrl, url) {
  const response = await fetch(`${baseUrl}/api/news/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  return { response, body: await response.json() };
}

function mockImageResponse(finalUrl = publicUrl, remoteAddress) {
  require('../lib/safeHttpClient').get.mockResolvedValue({
    data: PNG_IMAGE,
    headers: { 'content-type': 'image/png' },
    request: { res: { responseUrl: finalUrl }, socket: { remoteAddress } },
  });
}

describe('incorporação de imagem com respostas HTTP simuladas', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  test('incorpora imagem de URL pública com os limites atuais', async () => {
    await withNewsServer(async (baseUrl) => {
      mockImageResponse();

      const { response, body } = await postImage(baseUrl, publicUrl);

      expect(response.status).toBe(200);
      expect(body.dataUrl).toBe(
        `data:image/png;base64,${PNG_IMAGE.toString('base64')}`
      );
      expect(require('../lib/safeHttpClient').get).toHaveBeenCalledWith(publicUrl, {
        responseType: 'arraybuffer',
        timeout: 15000,
        maxBytes: 12 * 1024 * 1024,
        maxRedirects: 3,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Maker/1.0)' },
      });
    });
  });

  test('preserva a data URL no fluxo completo de extração', async () => {
    await withNewsServer(async (baseUrl) => {
      require('../services/newsScraper').fetch.mockResolvedValue({
        h1: 'Título',
        h2: 'Subtítulo',
        bg: publicUrl,
        chapeu: null,
      });
      mockImageResponse();

      const { response, body } = await postNews(baseUrl, publicUrl);

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        h1: 'Título',
        h2: 'Subtítulo',
        bg: `data:image/png;base64,${PNG_IMAGE.toString('base64')}`,
        bgSource: publicUrl,
      });
    });
  });

  test('falha toda a extracao quando nenhum candidato da imagem responde', async () => {
    await withNewsServer(async (baseUrl) => {
      require('../services/newsScraper').fetch.mockResolvedValue({
        h1: 'Titulo completo',
        h2: 'Subtitulo completo',
        bg: publicUrl,
        chapeu: 'Cotidiano',
      });
      require('../lib/safeHttpClient').get.mockRejectedValue(
        new SafeHttpError('TIMEOUT')
      );

      const { response, body } = await postNews(baseUrl, publicUrl);

      expect(response.status).toBe(500);
      expect(body).toMatchObject({ code: 'TIMEOUT' });
      expect(body).not.toHaveProperty('h1');
      expect(body).not.toHaveProperty('h2');
      expect(body).not.toHaveProperty('chapeu');
      expect(body).not.toHaveProperty('bg');
    });
  });

  test('converte timeout do download em resposta 422', async () => {
    await withNewsServer(async (baseUrl) => {
      require('../lib/safeHttpClient').get.mockRejectedValue(new SafeHttpError('TIMEOUT'));

      const { response, body } = await postImage(baseUrl, publicUrl);

      expect(response.status).toBe(422);
      expect(body.code).toBe('TIMEOUT');
      expect(body.detail).toBe('Tempo limite da requisição externa excedido');
    });
  });

  test('converte rejeição por resposta acima de 12 MB em resposta 422', async () => {
    await withNewsServer(async (baseUrl) => {
      require('../lib/safeHttpClient').get.mockRejectedValue(
        new SafeHttpError('RESPONSE_TOO_LARGE')
      );

      const { response, body } = await postImage(baseUrl, publicUrl);

      expect(response.status).toBe(422);
      expect(body.code).toBe('RESPONSE_TOO_LARGE');
      expect(body.detail).toBe('Resposta externa excede o limite permitido');
      expect(require('../lib/safeHttpClient').get.mock.calls[0][1].maxBytes).toBe(
        12 * 1024 * 1024
      );
    });
  });

  test('rejeita conteúdo com tipo inesperado', async () => {
    await withNewsServer(async (baseUrl) => {
      require('../lib/safeHttpClient').get.mockResolvedValue({
        data: Buffer.from('not-an-image'),
        headers: { 'content-type': 'text/plain' },
      });

      const { response, body } = await postImage(baseUrl, publicUrl);

      expect(response.status).toBe(422);
      expect(body.code).toBe('UNEXPECTED_CONTENT_TYPE');
      expect(body.detail).toBe(
        'Servidor remoto retornou um tipo de conteúdo inválido'
      );
    });
  });

  test('rejeita imagem vazia com mensagem previsível', async () => {
    await withNewsServer(async (baseUrl) => {
      require('../lib/safeHttpClient').get.mockResolvedValue({
        data: Buffer.alloc(0),
        headers: { 'content-type': 'image/png' },
      });

      const { response, body } = await postImage(baseUrl, publicUrl);

      expect(response.status).toBe(422);
      expect(body).toEqual({
        error: 'Não foi possível baixar a imagem',
        code: 'EMPTY_RESPONSE',
        detail: 'Servidor remoto retornou uma imagem vazia',
      });
    });
  });

  test('rejeita assinatura incompatível sem expor o conteúdo recebido', async () => {
    await withNewsServer(async (baseUrl) => {
      require('../lib/safeHttpClient').get.mockResolvedValue({
        data: Buffer.from('internal response body'),
        headers: { 'content-type': 'image/png' },
      });

      const { response, body } = await postImage(baseUrl, publicUrl);

      expect(response.status).toBe(422);
      expect(body).toEqual({
        error: 'Não foi possível baixar a imagem',
        code: 'INVALID_IMAGE_CONTENT',
        detail: 'O conteúdo remoto não corresponde a uma imagem válida',
      });
      expect(JSON.stringify(body)).not.toContain('internal response body');
    });
  });

  test('não expõe o corpo inválido no erro do fluxo de extração', async () => {
    await withNewsServer(async (baseUrl) => {
      require('../services/newsScraper').fetch.mockResolvedValue({
        h1: 'Título',
        h2: null,
        bg: publicUrl,
        chapeu: null,
      });
      require('../lib/safeHttpClient').get.mockResolvedValue({
        data: Buffer.from('private upstream response'),
        headers: { 'content-type': 'image/png' },
      });

      const { response, body } = await postNews(baseUrl, publicUrl);

      expect(response.status).toBe(500);
      expect(body).toEqual({
        error: 'Erro ao extrair dados da notícia',
        code: 'INVALID_IMAGE_CONTENT',
        detail: 'O conteúdo remoto não corresponde a uma imagem válida',
      });
      expect(JSON.stringify(body)).not.toContain('private upstream response');
    });
  });

  test('não expõe detalhes de falha inesperada do download', async () => {
    await withNewsServer(async (baseUrl) => {
      require('../lib/safeHttpClient').get.mockRejectedValue(
        new Error('connect ECONNREFUSED 10.0.0.1:8080')
      );

      const { response, body } = await postImage(baseUrl, publicUrl);

      expect(response.status).toBe(422);
      expect(body).toEqual({
        error: 'Não foi possível baixar a imagem',
        code: 'REQUEST_FAILED',
        detail: 'Falha na requisição externa',
      });
      expect(JSON.stringify(body)).not.toContain('10.0.0.1');
    });
  });

  test('aceita redirecionamento público dentro do limite configurado', async () => {
    await withNewsServer(async (baseUrl) => {
      mockImageResponse(redirectedPublicUrl);

      const { response } = await postImage(baseUrl, publicUrl);

      expect(response.status).toBe(200);
      expect(require('../lib/safeHttpClient').get.mock.calls[0][1].maxRedirects).toBe(3);
    });
  });

  test.each(nonPublicDestinations)(
    'incorpora destino não público: %s',
    async (_, url) => {
      await withNewsServer(async (baseUrl) => {
        require('../lib/safeHttpClient').get.mockRejectedValue(
          new SafeHttpError('BLOCKED_ADDRESS')
        );

        const { response, body } = await postImage(baseUrl, url);

        expect(response.status).toBe(422);
        expect(body.code).toBe('BLOCKED_ADDRESS');
        expect(body.detail).toBe('Destino de rede não permitido');
        expect(require('../lib/safeHttpClient').get).toHaveBeenCalledWith(url, expect.any(Object));
      });
    }
  );

  test('rejeita redirecionamento de endereço público para privado', async () => {
    await withNewsServer(async (baseUrl) => {
      require('../lib/safeHttpClient').get.mockRejectedValue(
        new SafeHttpError('BLOCKED_ADDRESS')
      );

      const { response, body } = await postImage(baseUrl, publicUrl);

      expect(response.status).toBe(422);
      expect(body.code).toBe('BLOCKED_ADDRESS');
      expect(body.detail).toBe('Destino de rede não permitido');
    });
  });

  test('não expõe mensagem interna de falha inesperada da extração', async () => {
    await withNewsServer(async (baseUrl) => {
      const internalMessage =
        'AxiosError: getaddrinfo ENOTFOUND internal.local C:\\app\\news.js';
      require('../services/newsScraper').fetch.mockRejectedValue(
        new Error(internalMessage)
      );
      const { response, body } = await postNews(baseUrl, publicUrl);

      expect(response.status).toBe(500);
      expect(body).toEqual({
        error: 'Erro ao extrair dados da notícia',
        code: 'NEWS_EXTRACTION_FAILED',
      });
      expect(JSON.stringify(body)).not.toMatch(
        /AxiosError|ENOTFOUND|internal\.local|C:\\|stack/i
      );
      expect(console.error).toHaveBeenCalled();
    });
  });

  test.each(['INVALID_URL', 'UNSUPPORTED_PROTOCOL', 'URL_CREDENTIALS'])(
    'converte %s da URL da notícia em resposta 400',
    async (code) => {
      await withNewsServer(async (baseUrl) => {
        require('../services/newsScraper').fetch.mockRejectedValue(
          new SafeHttpError(code)
        );

        const { response, body } = await postNews(baseUrl, 'valor-inválido');

        expect(response.status).toBe(400);
        expect(body).toMatchObject({
          error: 'URL da notícia inválida',
          code,
        });
        expect(body.detail).toEqual(expect.any(String));
      });
    }
  );
});
