const express = require('express');
const fs = require('fs');
const path = require('path');
const { listTemplates, loadManifest } = require('../lib/manifestLoader');
const { resolveLogoAsset } = require('../lib/assetResolver');

const router = express.Router();

router.get('/', (req, res) => {
  const templates = listTemplates().map((entry) => ({
    template: entry.template,
    pages: entry.pages.map((page) => ({
      name: page.name,
      logoField: page.manifest?.logoField,
      defaultLogo: page.manifest?.defaultLogo,
      dimensions: page.manifest?.dimensions,
    })),
  }));

  res.json(templates);
});

router.get('/:template/:page', async (req, res) => {
  try {
    const { template, page } = req.params;
    const manifestInfo = loadManifest(template, page);
    const html = fs.readFileSync(manifestInfo.htmlPath, 'utf-8');

    const readCssFrom = (dir) => {
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
        return [];
      }
      return fs
        .readdirSync(dir)
        .filter((file) => file.endsWith('.css'))
        .map((file) => ({
          name: path.join(path.basename(dir), file),
          content: fs.readFileSync(path.join(dir, file), 'utf-8'),
        }));
    };

    const cssFiles = [
      ...readCssFrom(path.join(manifestInfo.templateDir, 'css')),
      ...readCssFrom(path.join(manifestInfo.pageDir)),
    ];

    const manifest = manifestInfo.manifest || {};
    const defaultLogo = manifest.defaultLogo || null;
    let resolvedLogo = null;

    if (defaultLogo) {
      try {
        const logoAsset = await resolveLogoAsset(defaultLogo, manifest.logoAlt);

        if (logoAsset) {
          if (logoAsset.kind === 'inline-svg') {
            resolvedLogo = {
              kind: 'inline-svg',
              markup: logoAsset.markup,
            };
          } else if (logoAsset.kind === 'image') {
            const isRemote = /^https?:\/\//i.test(defaultLogo);
            resolvedLogo = {
              kind: 'image',
              src: isRemote ? logoAsset.src : `/input/${defaultLogo}`,
            };
          }
        }
      } catch (e) {
        resolvedLogo = null;
      }
    }

    res.json({
      template,
      page,
      manifest,
      html,
      css: cssFiles,
      resolvedLogo,
    });
  } catch (error) {
    res.status(404).json({
      error: 'Template nǜo encontrado',
      detail: error.message,
    });
  }
});

module.exports = router;
