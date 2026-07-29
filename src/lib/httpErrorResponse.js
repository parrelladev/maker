const { SafeHttpError } = require('./safeHttpClient');

const PUBLIC_SAFE_HTTP_CODES = new Set([
  'INVALID_URL',
  'UNSUPPORTED_PROTOCOL',
  'URL_CREDENTIALS',
  'DNS_ERROR',
  'BLOCKED_ADDRESS',
  'TOO_MANY_REDIRECTS',
  'TIMEOUT',
  'RESPONSE_TOO_LARGE',
  'HTTP_STATUS',
  'UNEXPECTED_CONTENT_TYPE',
  'EMPTY_RESPONSE',
  'INVALID_IMAGE_CONTENT',
  'REQUEST_FAILED',
]);

function getPublicRemoteError(
  error,
  { fallbackCode, fallbackDetail } = {}
) {
  if (
    error?.name === 'SafeHttpError' &&
    PUBLIC_SAFE_HTTP_CODES.has(error.code)
  ) {
    const stableError = new SafeHttpError(error.code);
    return {
      code: stableError.code,
      detail: stableError.message,
    };
  }

  return {
    code: fallbackCode,
    ...(fallbackDetail ? { detail: fallbackDetail } : {}),
  };
}

function getGlobalErrorResponse(error) {
  if (error?.type === 'entity.parse.failed') {
    return {
      status: 400,
      body: {
        error: 'JSON inválido',
        code: 'INVALID_JSON',
      },
    };
  }

  if (error?.type === 'entity.too.large' || error?.status === 413) {
    return {
      status: 413,
      body: {
        error: 'Corpo da requisição excede o limite permitido',
        code: 'PAYLOAD_TOO_LARGE',
      },
    };
  }

  return {
    status: 500,
    body: {
      error: 'Erro interno do servidor',
      code: 'INTERNAL_ERROR',
    },
  };
}

function logRequestError(scope, req, error, context = {}) {
  // eslint-disable-next-line no-console
  console.error(
    `[${scope}] falha na requisição`,
    {
      method: req.method,
      path: req.originalUrl,
      ...context,
    },
    error
  );
}

module.exports = {
  getGlobalErrorResponse,
  getPublicRemoteError,
  logRequestError,
};
