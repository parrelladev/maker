const fs = require('fs');
const { SVG_MAX_BYTES } = require('./remoteRequestPolicy');
const { resolveLogoAsset } = require('./assetResolver');

jest.mock('fs');

describe('resolveLogoAsset com SVG local', () => {
  beforeEach(() => {
    fs.existsSync.mockReset();
    fs.statSync.mockReset();
    fs.readFileSync.mockReset();
    fs.existsSync.mockReturnValue(true);
  });

  test('sanitiza conteúdo ativo antes de retornar markup inline', async () => {
    fs.statSync.mockReturnValue({ size: 200 });
    fs.readFileSync.mockReturnValue(`
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
    fs.statSync.mockReturnValue({ size: SVG_MAX_BYTES + 1 });

    await expect(resolveLogoAsset('local-too-large.svg')).rejects.toMatchObject({
      code: 'SVG_TOO_LARGE',
      message: 'Conteúdo SVG excede o limite permitido',
    });
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });
});
