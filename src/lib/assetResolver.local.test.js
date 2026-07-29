const fs = require('fs').promises;
const path = require('path');
const { SVG_MAX_BYTES } = require('./remoteRequestPolicy');
const {
  createLogoAssetResolver,
  resolveLogoAsset,
} = require('./assetResolver');

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

  test.each([undefined, null, '', false])(
    'retorna null para valor ausente sem consultar o filesystem: %p',
    async (value) => {
      await expect(resolveLogoAsset(value)).resolves.toBeNull();
      expect(fs.access).not.toHaveBeenCalled();
      expect(fs.stat).not.toHaveBeenCalled();
      expect(fs.readFile).not.toHaveBeenCalled();
    }
  );

  test.each([42, {}, []])(
    'rejeita valor inválido sem consultar o filesystem nem manter resultado: %p',
    async (value) => {
      await expect(resolveLogoAsset(value)).rejects.toMatchObject({ name: 'TypeError' });
      await expect(resolveLogoAsset(value)).rejects.toMatchObject({ name: 'TypeError' });
      expect(fs.access).not.toHaveBeenCalled();
      expect(fs.stat).not.toHaveBeenCalled();
      expect(fs.readFile).not.toHaveBeenCalled();
    }
  );

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

  test('tenta novamente uma logo local ausente em vez de manter cache negativo', async () => {
    const missingError = Object.assign(new Error('not found'), { code: 'ENOENT' });
    fs.access.mockRejectedValue(missingError);

    await expect(resolveLogoAsset('missing.svg')).rejects.toThrow(
      'Logo não encontrada: missing.svg'
    );
    await expect(resolveLogoAsset('missing.svg')).rejects.toThrow(
      'Logo não encontrada: missing.svg'
    );
    expect(fs.access).toHaveBeenCalledTimes(2);
  });

  test('limita o cache e descarta a chave mais antiga sem promover hits', async () => {
    const cache = new Map();
    const resolveWithCache = createLogoAssetResolver({ cache, capacity: 2 });

    await resolveWithCache('first.png');
    expect(cache.size).toBe(1);
    await resolveWithCache('second.png');
    expect(cache.size).toBe(2);
    await resolveWithCache('first.png');
    expect(cache.size).toBe(2);
    await resolveWithCache('third.png');

    expect(cache.size).toBe(2);
    expect([...cache.keys()]).toEqual(['second.png', 'third.png']);

    fs.access.mockClear();
    await resolveWithCache('second.png');
    await resolveWithCache('third.png');
    expect(fs.access).not.toHaveBeenCalled();
    expect(cache.size).toBe(2);
    expect([...cache.keys()]).toEqual(['second.png', 'third.png']);
  });

  test('não adiciona null, string vazia ou valor inválido ao cache controlado', async () => {
    const cache = new Map();
    const resolveWithCache = createLogoAssetResolver({ cache, capacity: 2 });

    await expect(resolveWithCache(null)).resolves.toBeNull();
    await expect(resolveWithCache('')).resolves.toBeNull();
    await expect(resolveWithCache(42)).rejects.toMatchObject({ name: 'TypeError' });

    expect(cache.size).toBe(0);
  });

  test('não adiciona logo local ausente ao cache controlado', async () => {
    const cache = new Map();
    const resolveWithCache = createLogoAssetResolver({ cache, capacity: 2 });
    fs.access.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));

    await expect(resolveWithCache('missing-controlled.svg')).rejects.toThrow(
      'Logo não encontrada: missing-controlled.svg'
    );
    expect(cache.size).toBe(0);
  });

  test('não adiciona SVG local inválido ao cache controlado', async () => {
    const cache = new Map();
    const resolveWithCache = createLogoAssetResolver({ cache, capacity: 2 });
    fs.stat.mockResolvedValue({ size: 100 });
    fs.readFile.mockResolvedValue('<svg><g></svg>');

    await expect(resolveWithCache('invalid-controlled.svg')).rejects.toMatchObject({
      code: 'INVALID_SVG',
    });
    expect(cache.size).toBe(0);
  });

  test('compartilha o asset base sem compartilhar altText no cache controlado', async () => {
    const cache = new Map();
    const resolveWithCache = createLogoAssetResolver({ cache, capacity: 2 });
    fs.stat.mockResolvedValue({ size: 100 });
    fs.readFile.mockResolvedValue('<svg><title>Controlled</title></svg>');

    const first = await resolveWithCache('controlled-alt.svg', 'Logo A');
    const second = await resolveWithCache('controlled-alt.svg', 'Logo B');

    expect(first.alt).toBe('Logo A');
    expect(second.alt).toBe('Logo B');
    expect(cache.size).toBe(1);
    expect(cache.get('controlled-alt.svg')).not.toHaveProperty('alt');
    expect(fs.readFile).toHaveBeenCalledTimes(1);
  });
});
