const fs = require('fs').promises;
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
});
