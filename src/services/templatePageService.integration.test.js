const fs = require('fs').promises;
const path = require('path');
const { buildEditorCatalog, resolveRenderer } = require('../lib/editorCatalog');
const { loadTemplatePage } = require('./templatePageService');

describe('renderer editorial real da A Gazeta', () => {
  test('resolve uma estrutura para os três temas e monta a página com assets da marca', async () => {
    const catalog = await buildEditorCatalog();
    const selection = {
      brand: 'agazeta', family: 'padrao', variant: 'foto-acima', format: 'story',
    };
    const rendererByTheme = ['azul', 'branco', 'preto'].map(theme => ({
      theme,
      renderer: resolveRenderer(catalog, { ...selection, theme }),
    }));

    expect(rendererByTheme.map(({ renderer }) => renderer)).toEqual([
      rendererByTheme[0].renderer,
      rendererByTheme[0].renderer,
      rendererByTheme[0].renderer,
    ]);
    expect(rendererByTheme[0].renderer).toMatchObject({
      template: 'agazeta-foto-acima',
      page: 'index',
      dimensions: { width: 1080, height: 1920 },
      themes: [
        { id: 'azul', label: 'Azul' },
        { id: 'branco', label: 'Branco' },
        { id: 'preto', label: 'Preto' },
      ],
    });

    const page = await loadTemplatePage(
      rendererByTheme[0].renderer.template,
      rendererByTheme[0].renderer.page
    );
    expect(page.manifest.dimensions).toEqual(rendererByTheme[0].renderer.dimensions);
    expect(page.manifest.brandAssets).toMatchObject({
      logo: 'primary',
      fonts: [
        { alias: 'headline.black' },
        { alias: 'body.italic' },
      ],
    });
    expect(page.manifest.bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ selector: '#logo', type: 'logo' }),
      expect.objectContaining({ selector: '#title', type: 'text' }),
    ]));
    expect(page.resolvedLogo).toMatchObject({ kind: 'inline-svg' });
    expect(page.css[0]).toMatchObject({ name: 'brand-fonts.css' });
    expect(page.css[0].content).toContain('data:font/woff2;base64,');
    expect(JSON.stringify(page)).not.toContain(path.resolve('.'));

    const rendererDirectory = path.resolve('templates/agazeta-foto-acima');
    const files = await fs.readdir(rendererDirectory, { recursive: true });
    expect(files.filter(file => path.basename(file) === 'index.html')).toHaveLength(1);
    expect(files.filter(file => path.basename(file) === 'manifest.json')).toHaveLength(1);
  });
});
