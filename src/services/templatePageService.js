const fs = require('fs').promises;
const path = require('path');
const { loadManifest } = require('../lib/manifestLoader');
const { resolveLogoAsset } = require('../lib/assetResolver');
const {
  TemplateRemoteAssetError,
  TemplateRequiredFileUnreadableError,
} = require('../lib/templatePageErrors');

function createTemplatePageService({
  fileSystem = fs,
  pathModule = path,
  loadManifestFn = loadManifest,
  resolveLogoAssetFn = resolveLogoAsset,
  logger = console,
} = {}) {
  async function readCssFrom(dir) {
    let directoryInfo;
    try {
      await fileSystem.access(dir);
      directoryInfo = await fileSystem.stat(dir);
    } catch (_) {
      return [];
    }

    if (!directoryInfo.isDirectory()) {
      return [];
    }

    const files = await fileSystem.readdir(dir);
    const css = [];
    for (const file of files.filter((entry) => entry.endsWith('.css'))) {
      css.push({
        name: pathModule.join(pathModule.basename(dir), file),
        content: await fileSystem.readFile(pathModule.join(dir, file), 'utf-8'),
      });
    }
    return css;
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
      if (/^https?:\/\//i.test(defaultLogo)) {
        throw new TemplateRemoteAssetError('Falha ao resolver asset remoto', {
          cause: error,
        });
      }
      logger.warn(
        '[templates] falha ao resolver logo',
        { template, page, code: error?.code || 'LOGO_RESOLUTION_FAILED' },
        error
      );
      return null;
    }
  }

  async function loadTemplatePage(template, page) {
    const manifestInfo = await loadManifestFn(template, page);
    let html;
    try {
      html = await fileSystem.readFile(manifestInfo.htmlPath, 'utf-8');
    } catch (error) {
      throw new TemplateRequiredFileUnreadableError('index.html ilegível', {
        cause: error,
      });
    }
    const sharedCss = await readCssFrom(pathModule.join(manifestInfo.templateDir, 'css'));
    const pageCss = await readCssFrom(manifestInfo.pageDir);
    const css = [...sharedCss, ...pageCss];
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
