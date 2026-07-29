const HTML_TIMEOUT_MS = 10000;
const IMAGE_TIMEOUT_MS = 15000;
const SVG_TIMEOUT_MS = 10000;

const HTML_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_MAX_BYTES = 12 * 1024 * 1024;
const SVG_MAX_BYTES = 1024 * 1024;

const MAX_REDIRECTS = 3;

const USER_AGENTS = Object.freeze({
  html:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  image: 'Mozilla/5.0 (compatible; Maker/1.0)',
});

const HTML_REQUEST_POLICY = Object.freeze({
  timeout: HTML_TIMEOUT_MS,
  maxBytes: HTML_MAX_BYTES,
  maxRedirects: MAX_REDIRECTS,
  headers: Object.freeze({ 'User-Agent': USER_AGENTS.html }),
});

const IMAGE_REQUEST_POLICY = Object.freeze({
  timeout: IMAGE_TIMEOUT_MS,
  maxBytes: IMAGE_MAX_BYTES,
  maxRedirects: MAX_REDIRECTS,
  headers: Object.freeze({ 'User-Agent': USER_AGENTS.image }),
});

const SVG_REQUEST_POLICY = Object.freeze({
  timeout: SVG_TIMEOUT_MS,
  maxBytes: SVG_MAX_BYTES,
  maxRedirects: MAX_REDIRECTS,
});

module.exports = {
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
};
