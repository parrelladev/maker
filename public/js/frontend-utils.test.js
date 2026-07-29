const {
  buildExportFilename,
  getToastIcon,
  isHttpUrl,
  isValidRemoteImageUrl,
  isValidResolvedImageValue,
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

  describe('contratos de imagem', () => {
    test.each([
      'http://example.com/imagem.jpg',
      'https://example.com/imagem.jpg'
    ])('aceita URL remota HTTP(S): %s', (value) => {
      expect(isValidRemoteImageUrl(value)).toBe(true);
    });

    test.each([
      'data:image/jpeg;base64,/9j/AA==',
      'data:image/png;base64,iVBORw0KGgo=',
      'data:image/gif;base64,R0lGODlh',
      'data:image/webp;base64,UklGRg==',
      'http://example.com/imagem.jpg',
      'https://example.com/imagem.jpg'
    ])('aceita imagem resolvida permitida: %s', (value) => {
      expect(isValidResolvedImageValue(value)).toBe(true);
    });

    test.each([
      'data:image/svg+xml;base64,PHN2Zz4=',
      'data:text/html;base64,PGgxPk9sw6E8L2gxPg==',
      'data:image/jpeg,conteudo-sem-base64',
      'data:image/jpeg;base64,',
      'data:;base64,AA==',
      'data:image/*;base64,AA==',
      'data:image/octet-stream;base64,AA==',
      'data:image/jpeg ;base64,AA==',
      'data:image/jpeg;\u0000base64,AA==',
      'javascript:alert(1)',
      'file:///tmp/imagem.jpg',
      'ftp://example.com/imagem.jpg'
    ])('rejeita imagem resolvida nao permitida: %s', (value) => {
      expect(isValidResolvedImageValue(value)).toBe(false);
    });

    test('mantem data URL fora do contrato de imagem manual', () => {
      expect(isValidRemoteImageUrl('data:image/jpeg;base64,/9j/AA==')).toBe(false);
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
    test('rejeita data URL JPEG valida quando digitada como imagem manual', () => {
      expect(validateGenerationInput({
        ...validInput,
        manualImage: 'data:image/jpeg;base64,/9j/AA=='
      })).toEqual({
        valid: false,
        code: 'MANUAL_IMAGE_URL_INVALID',
        message: 'Informe um link de imagem v\u00e1lido (http ou https).',
        focusField: 'customImageUrl'
      });
    });

    test('rejeita formato invalido na imagem efetiva da fase resolvida', () => {
      expect(validateGenerationInput({
        ...validInput,
        requireResolvedContent: true,
        resolvedCategory: 'Categoria',
        effectiveImage: 'data:image/svg+xml;base64,PHN2Zz4='
      })).toEqual({
        valid: false,
        code: 'IMAGE_REQUIRED',
        message: 'N\u00e3o encontramos uma imagem v\u00e1lida. Informe um link de imagem ou tente novamente.',
        focusField: 'customImageUrl'
      });
    });
  });
});
