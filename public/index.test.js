const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

describe('shell do editor', () => {
  let $;
  beforeAll(() => {
    $ = cheerio.load(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'));
  });

  test('possui os containers semânticos principais', () => {
    expect($('.editor-app > .editor-header')).toHaveLength(1);
    expect($('.editor-app > .editor-main')).toHaveLength(1);
    expect($('.editor-app > .editor-footer')).toHaveLength(1);
  });

  test('expõe sidebar e workspace simultaneamente na tela principal', () => {
    expect($('.editor-main > .editor-sidebar')).toHaveLength(1);
    expect($('.editor-main > .editor-workspace')).toHaveLength(1);
    expect($('.editor-sidebar, .editor-workspace').filter('[hidden]')).toHaveLength(0);
  });

  test('mantém o iframe real dentro do viewport de preview', () => {
    expect($('[data-preview-viewport] > iframe#previewFrame')).toHaveLength(1);
  });

  test.each(['feed', 'story', 'compare'])('oferece o modo de visualização %s', mode => {
    expect($(`button[data-view-mode="${mode}"]`)).toHaveLength(1);
  });

  test('marca Story como modo inicial', () => {
    expect($('button[data-view-mode="story"]').attr('aria-pressed')).toBe('true');
  });

  test.each([
    ['newsUrl', 'url'], ['customTag', 'tag'], ['customTitle', 'title'],
    ['customSubtitle', 'subtitle'], ['customImageUrl', 'image']
  ])('associa label ao campo editorial %s', (id, field) => {
    expect($(`[data-field="${field}"]#${id}`)).toHaveLength(1);
    expect($(`label[for="${id}"]`)).toHaveLength(1);
  });

  test('prepara controles de configuração sem catálogo definitivo', () => {
    expect($('[data-control="brand"]')).toHaveLength(1);
    expect($('[data-control="family"]')).toHaveLength(1);
    expect($('[data-control="variants"].variant-grid')).toHaveLength(1);
    expect($('[data-control="themes"].theme-options')).toHaveLength(1);
    expect($('[data-control="variants"] option, [data-control="themes"] option')).toHaveLength(0);
  });

  test('separa as opções visuais do wrapper de tema legado', () => {
    expect($('[data-control="themes"]').closest('#themeWrapper')).toHaveLength(0);
    expect($('#themeWrapper > #customTheme')).toHaveLength(1);
  });

  test('expõe status e ações de download', () => {
    expect($('[data-editor-status][role="status"]')).toHaveLength(1);
    expect($('[data-action="download-current"]')).toHaveLength(1);
    expect($('[data-action="download-all"][disabled]')).toHaveLength(1);
  });

  test('não usa modal como arquitetura principal', () => {
    expect($('.modal, .modal-content, .modal-body')).toHaveLength(0);
    expect($('.editor-sidebar').closest('.editor-app')).toHaveLength(1);
    expect($('.editor-workspace').closest('.editor-app')).toHaveLength(1);
  });
});
