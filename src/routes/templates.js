const express = require('express');
const fs = require('fs');
const path = require('path');
const { listTemplates, loadManifest } = require('../lib/manifestLoader');
const { resolveLogoAsset } = require('../lib/assetResolver');
const { logRequestError } = require('../lib/httpErrorResponse');

const router = express.Router();

function getTemplateErrorResponse(error) {
  if (error instanceof SyntaxError) {
    return {
      status: 500,
      body: {
        error: 'Template inválido',
        code: 'TEMPLATE_INVALID',
      },
    };
  }

  if (error?.code) {
    return {
      status: 500,
      body: {
        error: 'Não foi possível carregar o template',
        code: 'TEMPLATE_LOAD_FAILED',
      },
    };
  }

  return {
    status: 404,
    body: {
      error: 'Template não encontrado',
      code: 'TEMPLATE_NOT_FOUND',
    },
  };
}

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
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn(
          '[templates] falha ao resolver logo',
          { template, page, code: error?.code || 'LOGO_RESOLUTION_FAILED' },
          error
        );
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
    const response = getTemplateErrorResponse(error);
    logRequestError('templates.load', req, error, {
      status: response.status,
      code: response.body.code,
      template: req.params.template,
      page: req.params.page,
    });
    res.status(response.status).json(response.body);
  }
});

module.exports = router;
