const cheerio = require('cheerio');
const safeHttpClient = require('../lib/safeHttpClient');
const { SafeHttpError } = jest.requireActual('../lib/safeHttpClient');
const { nonPublicDestinations, publicUrl, redirectedPublicUrl } =
  require('../../test/helpers/remoteDestinations');
const { fetch: fetchNews, extractChapeu } = require('./newsScraper');

jest.mock('../lib/safeHttpClient', () => ({
  ...jest.requireActual('../lib/safeHttpClient'),
  get: jest.fn(),
}));

describe('newsScraper.extractChapeu', () => {
  test('extrai o chapéu do layout atual da A Gazeta', () => {
    const $ = cheerio.load(`
      <div class="ND_PAGE_GRID_COLUMN">
        <div class="ND_PAGE_SECTION">
          <h1 class="h1-mobile">
            <a href="/"><img src="logo.svg" alt="A Gazeta"></a>
          </h1>
          <h1 class="h1-desktop">
            <a href="/"><img src="logo.svg" alt="A Gazeta"></a>
          </h1>
        </div>
        <div class="nd-grid-row ND_PAGE_SECTION" order-render="0.00">
          <div class="ND_PAGE_GRID_COLUMN">
            <div>
              <span class="nd-element-textable ND39jm8w0">
                Negociações
              </span>
            </div>
          </div>
        </div>
        <div class="nd-grid-row ND_PAGE_SECTION" order-render="0.001">
          <div class="ND_PAGE_GRID_COLUMN">
            <h1 class="nd-element-textable NDl3p3fec">
              Venda da UVV para fundo árabe não deve incluir UCL; entenda
            </h1>
          </div>
        </div>
      </div>
    `);

    expect(extractChapeu($)).toBe('Negociações');
  });

  test('mantém compatibilidade com o layout antigo', () => {
    const $ = cheerio.load(`
      <label
        class="text-tw-theme-box-kicker-default"
        id="kicker-123"
      >
        Assista agora!
      </label>
      <h1>Título da notícia</h1>
    `);

    expect(extractChapeu($)).toBe('Assista agora!');
  });

  test('não confunde conteúdo comum com chapéu', () => {
    const $ = cheerio.load(`
      <main>
        <p>Texto anterior</p>
        <h1>Título da notícia</h1>
      </main>
    `);

    expect(extractChapeu($)).toBeNull();
  });
});

describe('newsScraper.fetch com respostas HTTP simuladas', () => {
  beforeEach(() => {
    safeHttpClient.get.mockReset();
  });

  test('extrai notícia de uma URL pública com timeout e User-Agent atuais', async () => {
    safeHttpClient.get.mockResolvedValue({
      data: `
        <meta property="og:title" content="Título público">
        <meta property="og:description" content="Descrição pública">
        <meta property="og:image" content="https://public.example.test/image.jpg">
      `,
      headers: { 'content-type': 'text/html' },
    });

    await expect(fetchNews(publicUrl)).resolves.toMatchObject({
      h1: 'Título público',
      h2: 'Descrição pública',
      bg: 'https://public.example.test/image.jpg',
    });
    expect(safeHttpClient.get).toHaveBeenCalledWith(
      publicUrl,
      expect.objectContaining({
        timeout: 10000,
        maxBytes: 5 * 1024 * 1024,
        maxRedirects: 3,
        headers: expect.objectContaining({ 'User-Agent': expect.any(String) }),
      })
    );
  });

  test('propaga timeout do download da notícia', async () => {
    const error = new SafeHttpError('TIMEOUT');
    safeHttpClient.get.mockRejectedValue(error);

    await expect(fetchNews(publicUrl)).rejects.toBe(error);
  });

  test('propaga rejeição de notícia acima de 5 MB', async () => {
    safeHttpClient.get.mockRejectedValue(new SafeHttpError('RESPONSE_TOO_LARGE'));

    await expect(fetchNews(publicUrl)).rejects.toMatchObject({
      code: 'RESPONSE_TOO_LARGE',
    });
    expect(safeHttpClient.get.mock.calls[0][1].maxBytes).toBe(5 * 1024 * 1024);
  });

  test.each(['image/png', 'text/plain'])(
    'rejeita conteúdo de notícia com tipo inesperado: %s',
    async (contentType) => {
      safeHttpClient.get.mockResolvedValue({
        data: '<title>Tipo inválido</title>',
        headers: { 'content-type': contentType },
      });

      await expect(fetchNews(publicUrl)).rejects.toMatchObject({
        code: 'UNEXPECTED_CONTENT_TYPE',
        message: 'Servidor remoto retornou um tipo de conteúdo inválido',
      });
    }
  );

  test('rejeita notícia sem Content-Type', async () => {
    safeHttpClient.get.mockResolvedValue({
      data: '<title>Sem tipo</title>',
      headers: {},
    });

    await expect(fetchNews(publicUrl)).rejects.toMatchObject({
      code: 'UNEXPECTED_CONTENT_TYPE',
    });
  });

  test.each(['text/html; charset=utf-8', 'application/xhtml+xml; charset=UTF-8'])(
    'aceita tipo compatível com HTML e parâmetros: %s',
    async (contentType) => {
      safeHttpClient.get.mockResolvedValue({
        data: '<title>Tipo válido</title>',
        headers: { 'content-type': contentType },
      });

      await expect(fetchNews(publicUrl)).resolves.toMatchObject({ h1: 'Tipo válido' });
    }
  );

  test('aceita resposta após redirecionamento público', async () => {
    safeHttpClient.get.mockResolvedValue({
      data: '<title>Redirecionada</title>',
      headers: { 'content-type': 'text/html' },
      request: { res: { responseUrl: redirectedPublicUrl } },
    });

    await expect(fetchNews(publicUrl)).resolves.toMatchObject({ h1: 'Redirecionada' });
    expect(safeHttpClient.get.mock.calls[0][1].maxRedirects).toBe(3);
  });

  test.each(nonPublicDestinations)(
    'encaminha destino não público: %s',
    async (_, url) => {
      safeHttpClient.get.mockRejectedValue(new SafeHttpError('BLOCKED_ADDRESS'));

      await expect(fetchNews(url)).rejects.toMatchObject({ code: 'BLOCKED_ADDRESS' });
      expect(safeHttpClient.get).toHaveBeenCalledWith(url, expect.any(Object));
    }
  );

  test('rejeita redirecionamento de endereço público para privado', async () => {
    safeHttpClient.get.mockRejectedValue(new SafeHttpError('BLOCKED_ADDRESS'));

    await expect(fetchNews(publicUrl)).rejects.toMatchObject({ code: 'BLOCKED_ADDRESS' });
  });
});
