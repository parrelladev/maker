const cheerio = require('cheerio');
const axios = require('axios');
const { nonPublicDestinations, publicUrl, redirectedPublicUrl, redirectedPrivateUrl } =
  require('../../test/helpers/remoteDestinations');
const { fetch: fetchNews, extractChapeu } = require('./newsScraper');

jest.mock('axios');

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
    axios.get.mockReset();
  });

  test('extrai notícia de uma URL pública com timeout e User-Agent atuais', async () => {
    axios.get.mockResolvedValue({
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
    expect(axios.get).toHaveBeenCalledWith(
      publicUrl,
      expect.objectContaining({
        timeout: 10000,
        headers: expect.objectContaining({ 'User-Agent': expect.any(String) }),
      })
    );
  });

  test('propaga timeout do download da notícia', async () => {
    const error = Object.assign(new Error('timeout'), { code: 'ECONNABORTED' });
    axios.get.mockRejectedValue(error);

    await expect(fetchNews(publicUrl)).rejects.toBe(error);
  });

  test('aceita resposta de notícia acima de 12 MB porque não configura limite', async () => {
    const oversizedHtml = `<title>Resposta grande</title><!--${'x'.repeat(
      12 * 1024 * 1024 + 1
    )}-->`;
    axios.get.mockResolvedValue({ data: oversizedHtml, headers: { 'content-type': 'text/html' } });

    await expect(fetchNews(publicUrl)).resolves.toMatchObject({ h1: 'Resposta grande' });
    expect(axios.get.mock.calls[0][1]).not.toHaveProperty('maxContentLength');
    expect(axios.get.mock.calls[0][1]).not.toHaveProperty('maxBodyLength');
  });

  test('não rejeita conteúdo de notícia com tipo inesperado', async () => {
    axios.get.mockResolvedValue({
      data: '<title>Tipo não validado</title>',
      headers: { 'content-type': 'image/png' },
    });

    await expect(fetchNews(publicUrl)).resolves.toMatchObject({ h1: 'Tipo não validado' });
  });

  test('aceita resposta após redirecionamento público sem inspecionar o destino final', async () => {
    axios.get.mockResolvedValue({
      data: '<title>Redirecionada</title>',
      request: { res: { responseUrl: redirectedPublicUrl } },
    });

    await expect(fetchNews(publicUrl)).resolves.toMatchObject({ h1: 'Redirecionada' });
    expect(axios.get.mock.calls[0][1]).not.toHaveProperty('maxRedirects');
  });

  test.each(nonPublicDestinations)(
    'encaminha destino não público: %s',
    async (_, url, remoteAddress) => {
      axios.get.mockResolvedValue({
        data: '<title>Destino aceito</title>',
        request: { socket: { remoteAddress } },
      });

      await expect(fetchNews(url)).resolves.toMatchObject({ h1: 'Destino aceito' });
      expect(axios.get).toHaveBeenCalledWith(url, expect.any(Object));
    }
  );

  test('não rejeita redirecionamento de endereço público para privado', async () => {
    axios.get.mockResolvedValue({
      data: '<title>Destino privado</title>',
      request: { res: { responseUrl: redirectedPrivateUrl } },
    });

    await expect(fetchNews(publicUrl)).resolves.toMatchObject({ h1: 'Destino privado' });
  });
});
