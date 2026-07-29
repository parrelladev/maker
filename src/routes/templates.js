const express = require('express');
const { listTemplates } = require('../lib/manifestLoader');
const { logRequestError } = require('../lib/httpErrorResponse');
const { loadTemplatePage } = require('../services/templatePageService');

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
    const templatePage = await loadTemplatePage(template, page);
    res.json(templatePage);
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
