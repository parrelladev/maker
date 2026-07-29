const fs = require('fs');
const path = require('path');
const { loadManifest } = require('../lib/manifestLoader');
const { resolveLogoAsset } = require('../lib/assetResolver');

function createTemplatePageService({
  fileSystem = fs,
  pathModule = path,
  loadManifestFn = loadManifest,
  resolveLogoAssetFn = resolveLogoAsset,
  logger = console,
} = {}) {
  function readCssFrom(dir) {
    if (!fileSystem.existsSync(dir) || !fileSystem.statSync(dir).isDirectory()) {
      return [];
    }

    return fileSystem
      .readdirSync(dir)
      .filter((file) => file.endsWith('.css'))
      .map((file) => ({
        name: pathModule.join(pathModule.basename(dir), file),
        content: fileSystem.readFileSync(pathModule.join(dir, file), 'utf-8'),
      }));
  }

  async function resolveManifestLogo(template, page, manifest) {
    const defaultLogo = manifest.defaultLogo || null;
    if (!defaultLogo) return null;

    try {
      const logoAsset = await resolveLogoAssetFn(defaultLogo, manifest.logoAlt);
      if (!logoAsset) return null;

      if (logoAsset.kind === 'inline-svg') {
        return {
          kind: 'inline-svg',
          markup: logoAsset.markup,
        };
      }

      if (logoAsset.kind === 'image') {
        const isRemote = /^https?:\/\//i.test(defaultLogo);
        return {
          kind: 'image',
          src: isRemote ? logoAsset.src : `/input/${defaultLogo}`,
        };
      }

      return null;
    } catch (error) {
      logger.warn(
        '[templates] falha ao resolver logo',
        { template, page, code: error?.code || 'LOGO_RESOLUTION_FAILED' },
        error
      );
      return null;
    }
  }

  async function loadTemplatePage(template, page) {
    const manifestInfo = loadManifestFn(template, page);
    const html = fileSystem.readFileSync(manifestInfo.htmlPath, 'utf-8');
    const css = [
      ...readCssFrom(pathModule.join(manifestInfo.templateDir, 'css')),
      ...readCssFrom(manifestInfo.pageDir),
    ];
    const manifest = manifestInfo.manifest || {};
    const resolvedLogo = await resolveManifestLogo(template, page, manifest);

    return {
      template,
      page,
      manifest,
      html,
      css,
      resolvedLogo,
    };
  }

  return { loadTemplatePage };
}

const templatePageService = createTemplatePageService();

module.exports = {
  createTemplatePageService,
  loadTemplatePage: templatePageService.loadTemplatePage,
};
