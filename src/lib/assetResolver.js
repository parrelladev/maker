const fs = require('fs').promises;
const path = require('path');
const safeHttpClient = require('./safeHttpClient');
const { SVG_MAX_BYTES, SVG_REQUEST_POLICY } = require('./remoteRequestPolicy');
const { SvgValidationError, sanitizeSvg } = require('./svgSanitizer');
const { assertContentType } = safeHttpClient;

const INPUT_DIR = path.resolve('input');
const LOGO_EXTENSIONS = ['.svg', '.png', '.jpg', '.jpeg', '.webp'];
const LOGO_CACHE = new Map();

function isRemoteUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

async function resolveLogoAsset(value, altText) {
  if (!value) {
    return null;
  }

  const cached = LOGO_CACHE.get(value);
  if (cached) {
    return { ...cached, alt: altText || cached.alt };
  }

  if (isRemoteUrl(value)) {
    if (/\.svg(\?|#|$)/i.test(value)) {
      const response = await safeHttpClient.get(value, {
        ...SVG_REQUEST_POLICY,
        responseType: 'text',
      });
      assertContentType(response.headers?.['content-type'], ['image/svg+xml']);
      const markup = sanitizeSvg(String(response.data || ''), {
        maxBytes: SVG_MAX_BYTES,
      });
      const result = { kind: 'inline-svg', markup, source: value, sourceType: 'remote', alt: altText };
      LOGO_CACHE.set(value, result);
      return result;
    }

    const result = { kind: 'image', src: value, source: value, sourceType: 'remote', alt: altText };
    LOGO_CACHE.set(value, result);
    return result;
  }

  const extension = path.extname(value);
  const candidateNames = extension ? [value] : LOGO_EXTENSIONS.map((ext) => `${value}${ext}`);

  for (const candidate of candidateNames) {
    const candidatePath = path.isAbsolute(candidate) ? candidate : path.join(INPUT_DIR, candidate);
    try {
      await fs.access(candidatePath);
    } catch (_) {
      continue;
    }

    if (candidate.toLowerCase().endsWith('.svg')) {
      if ((await fs.stat(candidatePath)).size > SVG_MAX_BYTES) {
        throw new SvgValidationError('SVG_TOO_LARGE');
      }
      const markup = sanitizeSvg(await fs.readFile(candidatePath, 'utf-8'), {
        maxBytes: SVG_MAX_BYTES,
      });
      const result = {
        kind: 'inline-svg',
        markup,
        source: candidatePath,
        sourceType: 'local',
        alt: altText,
      };
      LOGO_CACHE.set(value, result);
      return result;
    }

    const result = {
      kind: 'image',
      src: candidatePath,
      source: candidatePath,
      sourceType: 'local',
      alt: altText,
    };
    LOGO_CACHE.set(value, result);
    return result;
  }

  throw new Error(`Logo não encontrada: ${value}`);
}

module.exports = {
  resolveLogoAsset,
};

