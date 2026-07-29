const fs = require('fs').promises;
const path = require('path');
const safeHttpClient = require('./safeHttpClient');
const { SVG_MAX_BYTES, SVG_REQUEST_POLICY } = require('./remoteRequestPolicy');
const { SvgValidationError, sanitizeSvg } = require('./svgSanitizer');
const { assertContentType } = safeHttpClient;

const INPUT_DIR = path.resolve('input');
const LOGO_EXTENSIONS = ['.svg', '.png', '.jpg', '.jpeg', '.webp'];
const LOGO_CACHE_CAPACITY = 32;
const LOGO_CACHE = new Map();

function isRemoteUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

function createInlineSvgAsset(markup, source, sourceType) {
  return { kind: 'inline-svg', markup, source, sourceType };
}

function createImageAsset(src, source, sourceType) {
  return { kind: 'image', src, source, sourceType };
}

function withAltText(asset, altText) {
  return { ...asset, alt: altText };
}

async function loadRemoteSvg(value) {
  const response = await safeHttpClient.get(value, {
    ...SVG_REQUEST_POLICY,
    responseType: 'text',
  });
  assertContentType(response.headers?.['content-type'], ['image/svg+xml']);
  const markup = sanitizeSvg(String(response.data || ''), {
    maxBytes: SVG_MAX_BYTES,
  });
  return createInlineSvgAsset(markup, value, 'remote');
}

async function resolveRemoteAsset(value) {
  if (/\.svg(\?|#|$)/i.test(value)) {
    return loadRemoteSvg(value);
  }
  return createImageAsset(value, value, 'remote');
}

async function findLocalAsset(value) {
  const extension = path.extname(value);
  const candidateNames = extension ? [value] : LOGO_EXTENSIONS.map((ext) => `${value}${ext}`);

  for (const candidate of candidateNames) {
    const candidatePath = path.isAbsolute(candidate) ? candidate : path.join(INPUT_DIR, candidate);
    try {
      await fs.access(candidatePath);
    } catch (_) {
      continue;
    }
    return { candidate, candidatePath };
  }
  return null;
}

async function loadLocalSvg(candidatePath) {
  if ((await fs.stat(candidatePath)).size > SVG_MAX_BYTES) {
    throw new SvgValidationError('SVG_TOO_LARGE');
  }
  const markup = sanitizeSvg(await fs.readFile(candidatePath, 'utf-8'), {
    maxBytes: SVG_MAX_BYTES,
  });
  return createInlineSvgAsset(markup, candidatePath, 'local');
}

async function resolveLocalAsset(value) {
  const localAsset = await findLocalAsset(value);
  if (!localAsset) {
    throw new Error(`Logo não encontrada: ${value}`);
  }

  const { candidate, candidatePath } = localAsset;
  if (candidate.toLowerCase().endsWith('.svg')) {
    return loadLocalSvg(candidatePath);
  }
  return createImageAsset(candidatePath, candidatePath, 'local');
}

function createLogoAssetResolver({
  cache = new Map(),
  capacity = LOGO_CACHE_CAPACITY,
} = {}) {
  function cacheAsset(value, asset) {
    if (!cache.has(value) && cache.size >= capacity) {
      cache.delete(cache.keys().next().value);
    }
    cache.set(value, asset);
    return asset;
  }

  async function resolveLogoAsset(value, altText) {
    if (!value) {
      return null;
    }

    const cachedAsset = cache.get(value);
    if (cachedAsset) {
      return withAltText(cachedAsset, altText);
    }

    const asset = isRemoteUrl(value)
      ? await resolveRemoteAsset(value)
      : await resolveLocalAsset(value);

    return withAltText(cacheAsset(value, asset), altText);
  }

  return resolveLogoAsset;
}

const resolveLogoAsset = createLogoAssetResolver({
  cache: LOGO_CACHE,
  capacity: LOGO_CACHE_CAPACITY,
});

module.exports = {
  LOGO_CACHE_CAPACITY,
  createLogoAssetResolver,
  resolveLogoAsset,
};

