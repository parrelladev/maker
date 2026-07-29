const fs = require('fs').promises;
const path = require('path');
const { SVG_MAX_BYTES } = require('./remoteRequestPolicy');
const { resolveLogoAsset } = require('./assetResolver');

jest.mock('fs', () => ({
  promises: {
    access: jest.fn(),
    stat: jest.fn(),
    readFile: jest.fn(),
  },
}));

describe('resolveLogoAsset com SVG local', () => {
  beforeEach(() => {
    fs.access.mockReset();
    fs.stat.mockReset();
    fs.readFile.mockReset();
    fs.access.mockResolvedValue();
  });

  test('sanitiza conteúdo ativo antes de retornar markup inline', async () => {
    fs.stat.mockResolvedValue({ size: 200 });
    fs.readFile.mockResolvedValue(`
      <svg xmlns="http://www.w3.org/2000/svg" onload="steal()">
        <script>alert(1)</script>
        <foreignObject><iframe src="https://evil.test"/></foreignObject>
        <path class="logo" d="M0 0h1v1z"/>
      </svg>
    `);

    await expect(resolveLogoAsset('local-malicious.svg')).resolves.toMatchObject({
      kind: 'inline-svg',
      sourceType: 'local',
      markup: expect.stringContaining('<path class="logo"'),
    });
    const result = await resolveLogoAsset('local-malicious.svg');
    expect(result.markup).not.toMatch(
      /script|foreignObject|iframe|onload|evil\.test/i
    );
  });

  test('rejeita arquivo acima do limite antes de ler seu conteúdo', async () => {
    fs.stat.mockResolvedValue({ size: SVG_MAX_BYTES + 1 });

    await expect(resolveLogoAsset('local-too-large.svg')).rejects.toMatchObject({
      code: 'SVG_TOO_LARGE',
      message: 'Conteúdo SVG excede o limite permitido',
    });
    expect(fs.readFile).not.toHaveBeenCalled();
  });

  test('busca extensão conhecida em ordem e preserva o modelo de imagem local', async () => {
    const svgPath = path.resolve('input', 'brand.svg');
    const pngPath = path.resolve('input', 'brand.png');
    fs.access.mockImplementation((candidatePath) => (
      candidatePath === pngPath
        ? Promise.resolve()
        : Promise.reject(Object.assign(new Error('not found'), { code: 'ENOENT' }))
    ));

    await expect(resolveLogoAsset('brand', 'Logo A')).resolves.toEqual({
      kind: 'image',
      src: pngPath,
      source: pngPath,
      sourceType: 'local',
      alt: 'Logo A',
    });
    expect(fs.access.mock.calls.map(([candidatePath]) => candidatePath)).toEqual([
      svgPath,
      pngPath,
    ]);
    expect(fs.stat).not.toHaveBeenCalled();
    expect(fs.readFile).not.toHaveBeenCalled();
  });

  test('reutiliza asset local em cache e aplica o alt explícito de cada chamada', async () => {
    fs.stat.mockResolvedValue({ size: 100 });
    fs.readFile.mockResolvedValue('<svg><title>Cached</title></svg>');

    const first = await resolveLogoAsset('cached-local.svg', 'Logo A');
    const second = await resolveLogoAsset('cached-local.svg', 'Logo B');

    expect(first).toMatchObject({ kind: 'inline-svg', alt: 'Logo A' });
    expect(second).toMatchObject({ kind: 'inline-svg', alt: 'Logo B' });
    expect(fs.access).toHaveBeenCalledTimes(1);
    expect(fs.stat).toHaveBeenCalledTimes(1);
    expect(fs.readFile).toHaveBeenCalledTimes(1);
  });

  test('não herda alt de uma chamada anterior ao reutilizar o cache', async () => {
    fs.stat.mockResolvedValue({ size: 100 });
    fs.readFile.mockResolvedValue('<svg><title>Cached without alt</title></svg>');

    const first = await resolveLogoAsset('cached-alt.svg', 'Logo inicial');
    const second = await resolveLogoAsset('cached-alt.svg');

    expect(first.alt).toBe('Logo inicial');
    expect(second.alt).toBeUndefined();
    expect(fs.readFile).toHaveBeenCalledTimes(1);
  });
});
