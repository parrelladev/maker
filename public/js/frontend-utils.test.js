const {
  buildExportFilename,
  getToastIcon,
  isHttpUrl,
  normalizeOptionalValue
} = require('./frontend-utils');

describe('frontend-utils', () => {
  describe('isHttpUrl', () => {
    test.each([
      ['http://example.com/noticia', true],
      ['https://example.com/noticia', true],
      ['  https://example.com/noticia  ', true],
      ['ftp://example.com/arquivo', false],
      ['javascript:alert(1)', false],
      ['/noticia/relativa', false],
      ['', false],
      [null, false]
    ])('retorna %s para %p', (value, expected) => {
      expect(isHttpUrl(value)).toBe(expected);
    });
  });

  test.each([
    [undefined, ''],
    [null, ''],
    ['', ''],
    ['  texto  ', 'texto'],
    [42, '42']
  ])('normaliza o valor opcional %p', (value, expected) => {
    expect(normalizeOptionalValue(value)).toBe(expected);
  });

  test.each([
    ['success', 'check-circle'],
    ['error', 'exclamation-circle'],
    ['info', 'info-circle'],
    ['warning', 'info-circle'],
    [undefined, 'info-circle']
  ])('escolhe o ícone %s para %p', (type, expected) => {
    expect(getToastIcon(type)).toBe(expected);
  });

  test('preserva o nome atual para template e página comuns', () => {
    expect(buildExportFilename('layout-hz', 'index')).toBe('layout-hz-index.png');
  });

  test('remove caracteres inválidos e usa fallbacks para segmentos vazios', () => {
    expect(buildExportFilename(' layout/hz:* ', ' página? ')).toBe(
      'layout-hz---página-.png'
    );
    expect(buildExportFilename('', '')).toBe('arte-index.png');
    expect(buildExportFilename('...', '.')).toBe('arte-index.png');
  });
});
