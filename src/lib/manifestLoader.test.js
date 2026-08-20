const path = require('path');

const originalCwd = process.cwd();
const fixtureWorkspace = path.resolve('test/fixtures/template-workspace');

describe('manifestLoader', () => {
  beforeEach(() => {
    process.chdir(fixtureWorkspace);
    jest.resetModules();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    jest.restoreAllMocks();
    jest.resetModules();
  });

  afterAll(() => {
    process.chdir(originalCwd);
  });

  test.each([
    '../foo',
    '..\\foo',
    '.',
    '..',
    'foo/bar',
    'foo\\bar',
    'foo\\..\\bar',
    '',
    'foo\0bar',
  ])('rejeita o segmento de template %j antes de ler o filesystem', async (template) => {
    const { loadManifest } = require('./manifestLoader');

    await expect(loadManifest(template, 'valid')).rejects.toMatchObject({
      code: 'TEMPLATE_NOT_FOUND',
      message: 'Referência de template inválida',
    });
  });

  test.each([
    '../foo',
    '..\\foo',
    '.',
    '..',
    'foo/bar',
    'foo\\bar',
    'foo\\..\\bar',
    '',
    'foo\0bar',
  ])('rejeita o segmento de página %j antes de ler o filesystem', async (page) => {
    const { loadManifest } = require('./manifestLoader');

    await expect(loadManifest('fixture', page)).rejects.toMatchObject({
      code: 'TEMPLATE_NOT_FOUND',
      message: 'Referência de template inválida',
    });
  });

  test('rejeita caminhos absolutos nativos e do Windows', async () => {
    const { loadManifest } = require('./manifestLoader');

    await expect(loadManifest(path.resolve('fixture'), 'valid')).rejects.toMatchObject({
      code: 'TEMPLATE_NOT_FOUND',
    });
    await expect(loadManifest('C:\\fixture', 'valid')).rejects.toMatchObject({
      code: 'TEMPLATE_NOT_FOUND',
    });
  });

  test('rejeita o traversal reproduzido antes de acessar o filesystem', async () => {
    const fileSystem = require('fs').promises;
    const access = jest.spyOn(fileSystem, 'access');
    const readFile = jest.spyOn(fileSystem, 'readFile');
    const { loadManifest } = require('./manifestLoader');

    await expect(
      loadManifest('../outside-template', 'valid')
    ).rejects.toMatchObject({ code: 'TEMPLATE_NOT_FOUND' });
    expect(access).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
  });

  test.each([
    ['fixture', 'valid', 'Fixture válida'],
    ['notícias', 'edição', 'Fixture Unicode'],
  ])('carrega template e página legítimos: %s/%s', async (template, page, name) => {
    const { loadManifest } = require('./manifestLoader');

    await expect(loadManifest(template, page)).resolves.toMatchObject({
      template,
      page,
      manifest: { name },
    });
  });

  test('continua aceitando template legado e expõe editorial nulo', async () => {
    const { loadManifest } = require('./manifestLoader');

    await expect(loadManifest('fixture', 'valid')).resolves.toMatchObject({
      manifest: {
        editorial: null,
        dimensions: { width: 320, height: 480 },
      },
    });
  });
});
