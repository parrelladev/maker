const fs = require('fs').promises;
const path = require('path');
const { resolveBrandFont, resolveBrandLogo } = require('./brandRegistry');
const { SVG_MAX_BYTES } = require('./remoteRequestPolicy');
const { sanitizeSvg } = require('./svgSanitizer');

class RendererBrandAssetError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'RendererBrandAssetError';
    this.code = code;
  }
}

function quoteCssString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function fontFaceCss(font, data) {
  return [
    '@font-face {',
    `  font-family: ${quoteCssString(font.family)};`,
    `  src: url("data:font/woff2;base64,${data.toString('base64')}") format("woff2");`,
    `  font-weight: ${font.weight};`,
    `  font-style: ${font.style};`,
    '  font-display: swap;',
    '}',
  ].join('\n');
}

function createRendererBrandAssetResolver({
  fileSystem = fs,
  pathModule = path,
  resolveBrandLogoFn = resolveBrandLogo,
  resolveBrandFontFn = resolveBrandFont,
  sanitizeSvgFn = sanitizeSvg,
} = {}) {
  async function resolveLogo(brandId, alias) {
    if (!alias) return null;
    const assetPath = await resolveBrandLogoFn(brandId, alias);
    const extension = pathModule.extname(assetPath).toLowerCase();
    if (extension === '.png') {
      const data = await fileSystem.readFile(assetPath);
      const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');
      if (data.length === 0 || data.length > SVG_MAX_BYTES || !data.subarray(0, 8).equals(pngSignature)) {
        throw new RendererBrandAssetError(
          'RENDERER_BRAND_LOGO_INVALID',
          `Logo PNG de marca inválido: ${alias}`
        );
      }
      return { kind: 'image', src: `data:image/png;base64,${data.toString('base64')}` };
    }
    if (extension !== '.svg') {
      throw new RendererBrandAssetError(
        'RENDERER_BRAND_LOGO_TYPE_UNSUPPORTED',
        `Logo de marca não suportada pelo renderer: ${alias}`
      );
    }
    const markup = sanitizeSvgFn(await fileSystem.readFile(assetPath, 'utf8'), {
      maxBytes: SVG_MAX_BYTES,
    });
    return { kind: 'inline-svg', markup };
  }

  async function resolveFonts(brandId, fonts = []) {
    const rules = [];
    for (const font of fonts) {
      const assetPath = await resolveBrandFontFn(brandId, font.alias);
      if (pathModule.extname(assetPath).toLowerCase() !== '.woff2') {
        throw new RendererBrandAssetError(
          'RENDERER_BRAND_FONT_TYPE_UNSUPPORTED',
          `Fonte de marca não suportada pelo renderer: ${font.alias}`
        );
      }
      rules.push(fontFaceCss(font, await fileSystem.readFile(assetPath)));
    }
    return rules.join('\n\n');
  }

  async function resolveRendererBrandAssets({ brandId, brandAssets }) {
    if (!brandAssets) return { resolvedLogo: null, fontCss: '' };
    const [resolvedLogo, fontCss] = await Promise.all([
      resolveLogo(brandId, brandAssets.logo),
      resolveFonts(brandId, brandAssets.fonts),
    ]);
    return { resolvedLogo, fontCss };
  }

  return { resolveRendererBrandAssets };
}

const rendererBrandAssetResolver = createRendererBrandAssetResolver();

module.exports = {
  RendererBrandAssetError,
  createRendererBrandAssetResolver,
  resolveRendererBrandAssets: rendererBrandAssetResolver.resolveRendererBrandAssets,
};
