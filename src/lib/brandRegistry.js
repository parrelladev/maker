const fs = require('fs').promises;
const path = require('path');

const BRAND_ROOT = path.resolve('brands');

class BrandRegistryError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'BrandRegistryError';
    this.code = code;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isInvalidBrandId(value) {
  return typeof value !== 'string'
    || value.length === 0
    || value === '.'
    || value === '..'
    || value.includes('/')
    || value.includes('\\')
    || value.includes('\0')
    || path.isAbsolute(value)
    || path.win32.isAbsolute(value);
}

function isOutside(root, target) {
  const relative = path.relative(root, target);
  return relative === '..'
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative);
}

function validateAssetPath(assetPath, kind, alias, brandDirectory) {
  if (
    typeof assetPath !== 'string'
    || assetPath.length === 0
    || path.isAbsolute(assetPath)
    || path.win32.isAbsolute(assetPath)
    || isOutside(brandDirectory, path.resolve(brandDirectory, assetPath))
  ) {
    throw new BrandRegistryError(
      'BRAND_ASSET_PATH_INVALID',
      `Invalid ${kind} path for alias: ${alias}`
    );
  }
}

function validateBrandManifest(manifest, brandId, brandDirectory) {
  if (
    !isPlainObject(manifest)
    || manifest.id !== brandId
    || typeof manifest.name !== 'string'
    || manifest.name.length === 0
    || !isPlainObject(manifest.logos)
    || !isPlainObject(manifest.fonts)
  ) {
    throw new BrandRegistryError(
      'BRAND_MANIFEST_INVALID',
      `Invalid brand manifest: ${brandId}`
    );
  }

  for (const [alias, assetPath] of Object.entries(manifest.logos)) {
    if (!alias) {
      throw new BrandRegistryError('BRAND_MANIFEST_INVALID', `Invalid logo alias: ${brandId}`);
    }
    validateAssetPath(assetPath, 'logo', alias, brandDirectory);
  }

  for (const [family, weights] of Object.entries(manifest.fonts)) {
    if (!family || !isPlainObject(weights)) {
      throw new BrandRegistryError('BRAND_MANIFEST_INVALID', `Invalid font family: ${brandId}`);
    }
    for (const [weight, assetPath] of Object.entries(weights)) {
      if (!weight) {
        throw new BrandRegistryError('BRAND_MANIFEST_INVALID', `Invalid font alias: ${brandId}`);
      }
      validateAssetPath(assetPath, 'font', `${family}.${weight}`, brandDirectory);
    }
  }

  return manifest;
}

function cloneBrand(manifest) {
  return {
    id: manifest.id,
    name: manifest.name,
    logos: { ...manifest.logos },
    fonts: Object.fromEntries(
      Object.entries(manifest.fonts).map(([family, weights]) => [family, { ...weights }])
    )
  };
}

function createBrandRegistry({ brandRoot = BRAND_ROOT, fileSystem = fs } = {}) {
  const resolvedBrandRoot = path.resolve(brandRoot);

  function resolveBrandDirectory(brandId) {
    if (isInvalidBrandId(brandId)) {
      throw new BrandRegistryError('BRAND_ID_INVALID', `Invalid brand id: ${String(brandId)}`);
    }

    const brandDirectory = path.resolve(resolvedBrandRoot, brandId);
    if (isOutside(resolvedBrandRoot, brandDirectory)) {
      throw new BrandRegistryError('BRAND_ID_INVALID', `Invalid brand id: ${brandId}`);
    }
    return brandDirectory;
  }

  async function resolveRealBrandDirectory(brandId) {
    const brandDirectory = resolveBrandDirectory(brandId);
    try {
      const [realBrandRoot, realBrandDirectory] = await Promise.all([
        fileSystem.realpath(resolvedBrandRoot),
        fileSystem.realpath(brandDirectory)
      ]);
      if (isOutside(realBrandRoot, realBrandDirectory)) {
        throw new BrandRegistryError('BRAND_ID_INVALID', `Invalid brand id: ${brandId}`);
      }
      return realBrandDirectory;
    } catch (error) {
      if (error instanceof BrandRegistryError) throw error;
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
        throw new BrandRegistryError('BRAND_NOT_FOUND', `Brand not found: ${brandId}`, { cause: error });
      }
      throw new BrandRegistryError('BRAND_MANIFEST_UNREADABLE', `Brand directory unreadable: ${brandId}`, { cause: error });
    }
  }

  async function loadBrand(brandId) {
    const brandDirectory = await resolveRealBrandDirectory(brandId);
    const manifestPath = path.join(brandDirectory, 'brand.json');
    let raw;

    try {
      raw = await fileSystem.readFile(manifestPath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
        throw new BrandRegistryError('BRAND_NOT_FOUND', `Brand not found: ${brandId}`, { cause: error });
      }
      throw new BrandRegistryError('BRAND_MANIFEST_UNREADABLE', `Brand manifest unreadable: ${brandId}`, { cause: error });
    }

    let manifest;
    try {
      manifest = JSON.parse(raw);
    } catch (error) {
      throw new BrandRegistryError('BRAND_MANIFEST_INVALID', `Invalid brand manifest: ${brandId}`, { cause: error });
    }

    validateBrandManifest(manifest, brandId, brandDirectory);
    return cloneBrand(manifest);
  }

  async function resolveAsset(brandId, kind, alias, assetPath) {
    const brandDirectory = await resolveRealBrandDirectory(brandId);
    validateAssetPath(assetPath, kind, alias, brandDirectory);
    const resolvedAssetPath = path.resolve(brandDirectory, assetPath);

    if (isOutside(brandDirectory, resolvedAssetPath)) {
      throw new BrandRegistryError(
        'BRAND_ASSET_PATH_INVALID',
        `Invalid ${kind} path for alias: ${alias}`
      );
    }

    try {
      const [realBrandDirectory, realAssetPath] = await Promise.all([
        fileSystem.realpath(brandDirectory),
        fileSystem.realpath(resolvedAssetPath)
      ]);
      if (isOutside(realBrandDirectory, realAssetPath)) {
        throw new BrandRegistryError(
          'BRAND_ASSET_PATH_INVALID',
          `Invalid ${kind} path for alias: ${alias}`
        );
      }
      const stats = await fileSystem.stat(realAssetPath);
      if (!stats.isFile()) {
        throw new BrandRegistryError('BRAND_ASSET_NOT_FOUND', `${kind} asset not found: ${alias}`);
      }
      return realAssetPath;
    } catch (error) {
      if (error instanceof BrandRegistryError) throw error;
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
        throw new BrandRegistryError('BRAND_ASSET_NOT_FOUND', `${kind} asset not found: ${alias}`, { cause: error });
      }
      throw new BrandRegistryError('BRAND_ASSET_UNREADABLE', `${kind} asset unreadable: ${alias}`, { cause: error });
    }
  }

  async function resolveBrandLogo(brandId, logoAlias) {
    const brand = await loadBrand(brandId);
    if (!Object.prototype.hasOwnProperty.call(brand.logos, logoAlias)) {
      throw new BrandRegistryError('BRAND_LOGO_NOT_FOUND', `Logo alias not found: ${logoAlias}`);
    }
    return resolveAsset(brandId, 'logo', logoAlias, brand.logos[logoAlias]);
  }

  async function resolveBrandFont(brandId, fontAlias) {
    if (typeof fontAlias !== 'string' || fontAlias.split('.').length !== 2) {
      throw new BrandRegistryError('BRAND_FONT_ALIAS_INVALID', `Invalid font alias: ${String(fontAlias)}`);
    }
    const [family, weight] = fontAlias.split('.');
    const brand = await loadBrand(brandId);
    const assetPath = brand.fonts[family]?.[weight];
    if (!assetPath) {
      throw new BrandRegistryError('BRAND_FONT_NOT_FOUND', `Font alias not found: ${fontAlias}`);
    }
    return resolveAsset(brandId, 'font', fontAlias, assetPath);
  }

  async function listBrands({ logger = console } = {}) {
    let entries;
    try {
      entries = await fileSystem.readdir(resolvedBrandRoot, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return [];
      throw error;
    }

    const brands = [];
    for (const brandId of entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort()) {
      try {
        const brand = await loadBrand(brandId);
        await Promise.all([
          ...Object.keys(brand.logos).map(alias => resolveBrandLogo(brandId, alias)),
          ...Object.entries(brand.fonts).flatMap(([family, weights]) =>
            Object.keys(weights).map(weight => resolveBrandFont(brandId, `${family}.${weight}`))
          )
        ]);
        brands.push({ id: brand.id, name: brand.name });
      } catch (error) {
        logger.warn('[brands] brand ignored during listing', {
          brandId,
          code: error.code || 'BRAND_LOAD_FAILED'
        });
      }
    }
    return brands;
  }

  return {
    listBrands,
    loadBrand,
    resolveBrandFont,
    resolveBrandLogo
  };
}

const defaultRegistry = createBrandRegistry();

module.exports = {
  BRAND_ROOT,
  BrandRegistryError,
  createBrandRegistry,
  ...defaultRegistry
};
