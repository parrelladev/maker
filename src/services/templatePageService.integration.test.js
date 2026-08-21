const fs = require('fs').promises;
const path = require('path');
const { buildEditorCatalog, resolveRenderer } = require('../lib/editorCatalog');
const { loadTemplatePage } = require('./templatePageService');

const THEMES = [
  { id: 'azul', label: 'Azul' },
  { id: 'branco', label: 'Branco' },
  { id: 'preto', label: 'Preto' },
];

describe('renderers editoriais reais da A Gazeta', () => {
  test('descobre e resolve duas variantes reais da mesma família sem expor refs técnicas', async () => {
    const catalog = await buildEditorCatalog();
    const agazeta = catalog.brands.find(({ id }) => id === 'agazeta');
    const family = agazeta.families.find(({ id }) => id === 'padrao');

    expect(family.variants).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'foto-acima', label: 'Foto acima' }),
      expect.objectContaining({ id: 'foto-abaixo', label: 'Foto abaixo' }),
    ]));
    expect(family.variants.find(({ id }) => id === 'foto-abaixo').formats).toEqual([{
        id: 'story',
        dimensions: { width: 1080, height: 1920 },
        themes: THEMES,
        capabilities: { imageAdjustments: { zoom: true, position: true } },
      }]);
    expect(family.variants.find(({ id }) => id === 'foto-acima').formats).toEqual([
      {
        id: 'feed', dimensions: { width: 1080, height: 1350 },
        themes: [{ id: 'azul', label: 'Azul' }],
        capabilities: { imageAdjustments: { zoom: true, position: true } },
      },
      {
        id: 'story', dimensions: { width: 1080, height: 1920 }, themes: THEMES,
        capabilities: { imageAdjustments: { zoom: true, position: true } },
      },
    ]);

    const fotoAcima = resolveRenderer(catalog, {
      brand: 'agazeta', family: 'padrao', variant: 'foto-acima', format: 'story',
    });
    const fotoAbaixo = resolveRenderer(catalog, {
      brand: 'agazeta', family: 'padrao', variant: 'foto-abaixo', format: 'story',
    });
    expect(fotoAcima).toMatchObject({ template: 'agazeta-foto-acima', page: 'index' });
    expect(fotoAbaixo).toMatchObject({ template: 'agazeta-foto-abaixo', page: 'index' });
    expect({ template: fotoAcima.template, page: fotoAcima.page })
      .not.toEqual({ template: fotoAbaixo.template, page: fotoAbaixo.page });

    const serialized = JSON.stringify(catalog);
    expect(serialized).not.toContain(path.resolve('.'));
    expect(serialized).not.toContain('rendererRef');
    expect(serialized).not.toContain('headline-black.woff2');
    expect(serialized).not.toContain('primary.svg');
  });

  test.each([
    ['foto-acima', 'agazeta-foto-acima'],
    ['foto-abaixo', 'agazeta-foto-abaixo'],
  ])('monta %s com um renderer compartilhado pelos temas e assets da marca', async (variant, template) => {
    const catalog = await buildEditorCatalog();
    const selection = { brand: 'agazeta', family: 'padrao', variant, format: 'story' };
    const rendererByTheme = ['azul', 'branco', 'preto'].map(theme =>
      resolveRenderer(catalog, { ...selection, theme })
    );

    expect(rendererByTheme).toEqual([
      rendererByTheme[0], rendererByTheme[0], rendererByTheme[0],
    ]);
    expect(rendererByTheme[0]).toMatchObject({
      template, page: 'index', dimensions: { width: 1080, height: 1920 }, themes: THEMES,
    });

    const page = await loadTemplatePage(rendererByTheme[0].template, rendererByTheme[0].page);
    expect(page.html).toContain('<!DOCTYPE html>');
    expect(page.manifest.dimensions).toEqual(rendererByTheme[0].dimensions);
    expect(page.manifest.brandAssets).toMatchObject({
      logo: 'primary',
      fonts: [{ alias: 'headline.black' }, { alias: 'body.italic' }],
    });
    expect(page.manifest.bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ selector: '#bg', type: 'image' }),
      expect.objectContaining({ selector: '#logo', type: 'logo' }),
      expect.objectContaining({ selector: '#tag', type: 'text' }),
      expect.objectContaining({ selector: '#title', type: 'text' }),
      expect.objectContaining({ selector: '#subtitle', type: 'text' }),
    ]));
    expect(page.resolvedLogo).toMatchObject({ kind: 'inline-svg' });
    expect(page.css[0]).toMatchObject({ name: 'brand-fonts.css' });
    expect(page.css[0].content).toContain('data:font/woff2;base64,');
    expect(page.css).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: path.join('css', 'base.css') }),
      expect.objectContaining({ name: path.join('css', 'theme-azul.css') }),
      expect.objectContaining({ name: path.join('css', 'theme-branco.css') }),
      expect.objectContaining({ name: path.join('css', 'theme-preto.css') }),
    ]));
    expect(JSON.stringify(page)).not.toContain(path.resolve('.'));

    const files = await fs.readdir(path.resolve(`templates/${template}`), { recursive: true });
    expect(files.filter(file => path.basename(file) === 'index.html')).toHaveLength(1);
    expect(files.filter(file => path.basename(file) === 'manifest.json')).toHaveLength(1);
  });

  test('carrega o Feed real 1080x1350 com bindings, marca e ajustes de imagem', async () => {
    const catalog = await buildEditorCatalog();
    const renderer = resolveRenderer(catalog, {
      brand: 'agazeta', family: 'padrao', variant: 'foto-acima', format: 'feed',
    });
    expect(renderer).toMatchObject({
      template: 'agazeta-feed-foto-acima', page: 'index',
      dimensions: { width: 1080, height: 1350 },
      themes: [{ id: 'azul', label: 'Azul' }],
      capabilities: { imageAdjustments: { zoom: true, position: true } },
    });
    const page = await loadTemplatePage(renderer.template, renderer.page);
    expect(page.manifest.dimensions).toEqual({ width: 1080, height: 1350 });
    expect(page.manifest.editorial).toMatchObject({
      brand: 'agazeta', family: 'padrao', variant: 'foto-acima', label: 'Foto acima',
    });
    expect(page.manifest.bindings.map(binding => binding.selector))
      .toEqual(expect.arrayContaining(['#bg', '#logo', '#title', '#subtitle', '#tag']));
    expect(page.resolvedLogo).toMatchObject({ kind: 'inline-svg' });
    expect(page.html).toContain('class="text"');
  });

  test('um template legado continua carregando pelo serviço técnico', async () => {
    const page = await loadTemplatePage('se-cuida', 'index');

    expect(page.manifest.editorial).toBeNull();
    expect(page.manifest.dimensions).toEqual({ width: 1080, height: 1920 });
    expect(page.html).toContain('<!DOCTYPE html>');
  });
});

describe('caracterização do renderer legado HZ Story', () => {
  test('preserva manifest, assets e precedência determinística dos CSS atuais', async () => {
    const page = await loadTemplatePage('layout-hz', 'index');

    expect(page.manifest).toMatchObject({
      name: 'Layout HZ',
      editorial: null,
      dimensions: { width: 1080, height: 1920 },
      logoField: 'logo',
      defaultLogo: 'logo-hz.png',
      bindings: [
        { selector: '#bg', type: 'image', field: 'resolvedBg', required: true },
        { selector: '#logo', type: 'logo', field: 'resolvedLogo', required: true },
        { selector: '#title', type: 'text', field: 'h1' },
        { selector: '#subtitle', type: 'text', field: 'h2' },
        { selector: '#tag', type: 'text', field: 'tag' },
      ],
      attributes: [
        { selector: '#themeStylesheet', type: 'attribute', name: 'href', field: 'themeStylesheet' },
        { selector: 'html', type: 'attribute', name: 'data-theme', field: 'themeName' },
      ],
    });
    expect(page.manifest).not.toHaveProperty('capabilities');
    expect(page.manifest).not.toHaveProperty('defaults');
    expect(page.manifest).not.toHaveProperty('themes');

    expect(page.html).toContain('id="themeStylesheet" href="../css/theme-rosa.css"');
    expect(page.html).toContain('id="bg"');
    expect(page.html).toContain('id="logo"');
    expect(page.html).toContain('id="tag"');
    expect(page.html).toContain('id="title"');
    expect(page.html).not.toContain('id="subtitle"');

    expect(page.css.map(({ name }) => name)).toEqual([
      path.join('css', 'base.css'),
      path.join('css', 'theme-amarelo.css'),
      path.join('css', 'theme-rosa.css'),
    ]);
    expect(page.css[0].content).toContain("font-family: 'Maga Black'");
    expect(page.css[0].content).toContain('padding-top: 1100px');
    expect(page.css[1].content).toContain('--bg-top: #e39303');
    expect(page.css[2].content).toContain('--bg-top: #ff0053');

    const aggregatedCss = page.css.map(({ content }) => content).join('\n');
    expect(aggregatedCss.lastIndexOf('--bg-top: #ff0053'))
      .toBeGreaterThan(aggregatedCss.lastIndexOf('--bg-top: #e39303'));
    expect(page.resolvedLogo).toEqual({ kind: 'image', src: '/input/logo-hz.png' });

    const logo = await fs.readFile(path.resolve('input/logo-hz.png'));
    expect(logo.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(logo.readUInt32BE(16)).toBe(2697);
    expect(logo.readUInt32BE(20)).toBe(1080);
  });
});
