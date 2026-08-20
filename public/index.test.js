const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

describe('shell do editor', () => {
  let $;
  let styles;
  beforeAll(() => {
    $ = cheerio.load(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'));
    styles = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8');
  });

  test('possui os containers semânticos principais', () => {
    expect($('.editor-app > .editor-header')).toHaveLength(1);
    expect($('.editor-app > .editor-main')).toHaveLength(1);
    expect($('.editor-header .header-actions')).toHaveLength(1);
  });

  test('expõe sidebar e workspace simultaneamente na tela principal', () => {
    expect($('.editor-main > .editor-sidebar')).toHaveLength(1);
    expect($('.editor-main > .editor-workspace')).toHaveLength(1);
    expect($('.editor-sidebar, .editor-workspace').filter('[hidden]')).toHaveLength(0);
  });

  test('mantém o iframe real dentro do viewport de preview', () => {
    expect($('[data-preview-viewport][data-preview-format="story"] > iframe[data-preview-frame="story"]')).toHaveLength(1);
    expect($('[data-preview-viewport][data-preview-format="feed"] > iframe[data-preview-frame="feed"]')).toHaveLength(1);
  });

  test.each(['feed', 'story', 'compare'])('oferece o modo de visualização %s', mode => {
    expect($(`button[data-view-mode="${mode}"]`)).toHaveLength(1);
  });

  test('painel individual ocupa a largura disponível sem alterar o limite do modo comparar', () => {
    expect(styles).toMatch(/\.preview-panel\s*{[^}]*width:\s*100%;/s);
    expect(styles).toMatch(/\.preview-stage\[data-view-mode="compare"\] \.preview-panel\s*{[^}]*width:\s*min\(50%, 430px\);/s);
  });

  test('marca Story como modo inicial', () => {
    expect($('button[data-view-mode="story"]').attr('aria-pressed')).toBe('true');
    expect($('button[data-view-mode="feed"]').attr('disabled')).toBeUndefined();
    expect($('button[data-view-mode="compare"]').attr('disabled')).toBeUndefined();
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
    expect($('#templateModal, #modalTitle, #closeModal')).toHaveLength(0);
    expect($('#storyTemplateGrid, #storyCategoryTabs, .legacy-template-catalog')).toHaveLength(0);
    expect($('.editor-sidebar').closest('.editor-app')).toHaveLength(1);
    expect($('.editor-workspace').closest('.editor-app')).toHaveLength(1);
  });
});
