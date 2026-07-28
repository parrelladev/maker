const cheerio = require('cheerio');
const { extractChapeu } = require('./newsScraper');

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
