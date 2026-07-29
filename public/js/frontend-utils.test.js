const {
  buildExportFilename,
  getToastIcon,
  isHttpUrl,
  normalizeOptionalValue,
  validateGenerationInput
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

  describe('validateGenerationInput', () => {
    const validInput = {
      template: 'layout-hz',
      newsUrl: 'https://example.com/noticia',
      manualImage: ''
    };

    test.each([
      [{}, 'TEMPLATE_REQUIRED', 'Escolha um template antes de gerar a arte', null],
      [
        { template: 'layout-hz' },
        'NEWS_URL_REQUIRED',
        'Por favor, insira o link da notícia',
        'newsUrl'
      ],
      [
        { template: 'layout-hz', newsUrl: 'notícia inválida' },
        'NEWS_URL_INVALID',
        'Por favor, insira um link válido',
        'newsUrl'
      ],
      [
        { ...validInput, manualImage: 'imagem inválida' },
        'MANUAL_IMAGE_URL_INVALID',
        'Informe um link de imagem válido (http ou https).',
        'customImageUrl'
      ],
      [
        { ...validInput, requireResolvedContent: true, effectiveImage: 'data:image/png;base64,AA==' },
        'CATEGORY_REQUIRED',
        'Por favor, insira a categoria da notícia',
        'customTag'
      ],
      [
        { ...validInput, requireResolvedContent: true, resolvedCategory: 'Categoria' },
        'IMAGE_REQUIRED',
        'Não encontramos uma imagem válida. Informe um link de imagem ou tente novamente.',
        'customImageUrl'
      ]
    ])('retorna resultado estruturado para a falha %#', (input, code, message, focusField) => {
      expect(validateGenerationInput(input)).toEqual({
        valid: false,
        code,
        message,
        focusField
      });
    });

    test('não exige conteúdo resolvido durante as pré-condições iniciais', () => {
      expect(validateGenerationInput(validInput)).toEqual({
        valid: true,
        code: null,
        message: null,
        focusField: null
      });
    });

    test('aceita todos os dados efetivos necessários para gerar', () => {
      expect(validateGenerationInput({
        ...validInput,
        requireResolvedContent: true,
        resolvedCategory: 'Categoria',
        effectiveImage: 'data:image/png;base64,AA=='
      })).toEqual({
        valid: true,
        code: null,
        message: null,
        focusField: null
      });
    });
  });
});
