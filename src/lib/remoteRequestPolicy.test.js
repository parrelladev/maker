const {
  HTML_TIMEOUT_MS,
  IMAGE_TIMEOUT_MS,
  SVG_TIMEOUT_MS,
  HTML_MAX_BYTES,
  IMAGE_MAX_BYTES,
  SVG_MAX_BYTES,
  MAX_REDIRECTS,
  USER_AGENTS,
  HTML_REQUEST_POLICY,
  IMAGE_REQUEST_POLICY,
  SVG_REQUEST_POLICY,
} = require('./remoteRequestPolicy');

describe('políticas de requisições remotas', () => {
  test('mantém a política concreta de páginas HTML', () => {
    expect(HTML_REQUEST_POLICY).toEqual({
      timeout: 10000,
      maxBytes: 5 * 1024 * 1024,
      maxRedirects: 3,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      },
    });
    expect(HTML_REQUEST_POLICY.timeout).toBe(HTML_TIMEOUT_MS);
    expect(HTML_REQUEST_POLICY.maxBytes).toBe(HTML_MAX_BYTES);
    expect(HTML_REQUEST_POLICY.maxRedirects).toBe(MAX_REDIRECTS);
    expect(HTML_REQUEST_POLICY.headers['User-Agent']).toBe(USER_AGENTS.html);
  });

  test('mantém a política concreta de imagens', () => {
    expect(IMAGE_REQUEST_POLICY).toEqual({
      timeout: 15000,
      maxBytes: 12 * 1024 * 1024,
      maxRedirects: 3,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Maker/1.0)' },
    });
    expect(IMAGE_REQUEST_POLICY.timeout).toBe(IMAGE_TIMEOUT_MS);
    expect(IMAGE_REQUEST_POLICY.maxBytes).toBe(IMAGE_MAX_BYTES);
    expect(IMAGE_REQUEST_POLICY.maxRedirects).toBe(MAX_REDIRECTS);
    expect(IMAGE_REQUEST_POLICY.headers['User-Agent']).toBe(USER_AGENTS.image);
  });

  test('mantém a política concreta de SVG remoto', () => {
    expect(SVG_REQUEST_POLICY).toEqual({
      timeout: 10000,
      maxBytes: 1024 * 1024,
      maxRedirects: 3,
    });
    expect(SVG_REQUEST_POLICY.timeout).toBe(SVG_TIMEOUT_MS);
    expect(SVG_REQUEST_POLICY.maxBytes).toBe(SVG_MAX_BYTES);
    expect(SVG_REQUEST_POLICY.maxRedirects).toBe(MAX_REDIRECTS);
  });

  test('expõe políticas imutáveis', () => {
    expect(Object.isFrozen(USER_AGENTS)).toBe(true);
    expect(Object.isFrozen(HTML_REQUEST_POLICY)).toBe(true);
    expect(Object.isFrozen(HTML_REQUEST_POLICY.headers)).toBe(true);
    expect(Object.isFrozen(IMAGE_REQUEST_POLICY)).toBe(true);
    expect(Object.isFrozen(IMAGE_REQUEST_POLICY.headers)).toBe(true);
    expect(Object.isFrozen(SVG_REQUEST_POLICY)).toBe(true);
  });
});
