const { SafeHttpError } = require('./safeHttpClient');
const { validateImageResponse } = require('./imageValidator');

const signatures = {
  'image/png': Buffer.from('89504e470d0a1a0a00000000', 'hex'),
  'image/jpeg': Buffer.from('ffd8ffe000104a46494600', 'hex'),
  'image/gif': Buffer.from('47494638396101000100', 'hex'),
  'image/webp': Buffer.from('524946460400000057454250', 'hex'),
};

describe('validateImageResponse', () => {
  test.each(Object.entries(signatures))(
    'aceita %s quando MIME e assinatura são compatíveis',
    (contentType, data) => {
      expect(
        validateImageResponse(
          { data, headers: { 'content-type': `${contentType}; charset=binary` } },
          { maxBytes: 1024 }
        )
      ).toEqual({ contentType, buffer: data });
    }
  );

  test.each([
    undefined,
    'application/octet-stream',
    'text/plain',
    'image/svg+xml',
    'image/bmp',
  ])('rejeita tipo ausente, genérico ou não permitido: %s', (contentType) => {
    expect(() =>
      validateImageResponse(
        { data: signatures['image/png'], headers: { 'content-type': contentType } },
        { maxBytes: 1024 }
      )
    ).toThrow(expect.objectContaining({ code: 'UNEXPECTED_CONTENT_TYPE' }));
  });

  test('rejeita resposta vazia com erro estável', () => {
    expect(() =>
      validateImageResponse(
        { data: Buffer.alloc(0), headers: { 'content-type': 'image/png' } },
        { maxBytes: 1024 }
      )
    ).toThrow(
      expect.objectContaining({
        code: 'EMPTY_RESPONSE',
        message: 'Servidor remoto retornou uma imagem vazia',
      })
    );
  });

  test('rejeita corpo não binário e assinatura incompatível com erro estável', () => {
    for (const data of ['not-binary', Buffer.from('not-a-png')]) {
      expect(() =>
        validateImageResponse(
          { data, headers: { 'content-type': 'image/png' } },
          { maxBytes: 1024 }
        )
      ).toThrow(
        expect.objectContaining({
          code: 'INVALID_IMAGE_CONTENT',
          message: 'O conteúdo remoto não corresponde a uma imagem válida',
        })
      );
    }
  });

  test('rejeita buffer acima do limite com o erro classificado do cliente', () => {
    expect(() =>
      validateImageResponse(
        {
          data: Buffer.concat([signatures['image/png'], Buffer.alloc(10)]),
          headers: { 'content-type': 'image/png' },
        },
        { maxBytes: signatures['image/png'].length }
      )
    ).toThrow(
      expect.objectContaining({
        code: 'RESPONSE_TOO_LARGE',
        message: 'Resposta externa excede o limite permitido',
      })
    );
  });

  test('os erros produzidos continuam sendo SafeHttpError', () => {
    expect(() =>
      validateImageResponse(
        { data: Buffer.alloc(0), headers: { 'content-type': 'image/png' } },
        { maxBytes: 1024 }
      )
    ).toThrow(SafeHttpError);
  });
});
