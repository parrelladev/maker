const express = require('express');
const { buildEditorCatalog, resolveRenderer, EditorCatalogError } = require('../lib/editorCatalog');
const { logRequestError } = require('../lib/httpErrorResponse');

function createEditorRouter({ buildCatalog = buildEditorCatalog, resolve = resolveRenderer } = {}) {
  const router = express.Router();
  let catalogPromise = null;

  function getCatalog() {
    if (!catalogPromise) {
      catalogPromise = Promise.resolve().then(() => buildCatalog());
      catalogPromise.catch(() => { catalogPromise = null; });
    }
    return catalogPromise;
  }

  router.get('/catalog', async (req, res) => {
    try {
      res.json(await getCatalog());
    } catch (error) {
      logRequestError('editor.catalog', req, error, { status: 500, code: 'EDITOR_CATALOG_UNAVAILABLE' });
      res.status(500).json({ error: 'Catálogo editorial indisponível', code: 'EDITOR_CATALOG_UNAVAILABLE' });
    }
  });

  router.post('/resolve', async (req, res) => {
    const selection = req.body || {};
    if (!['brand', 'family', 'variant', 'format'].every(key => (
      typeof selection[key] === 'string' && selection[key].length > 0
    ))) {
      return res.status(400).json({ error: 'Seleção editorial inválida', code: 'EDITOR_SELECTION_INVALID' });
    }

    try {
      return res.json(resolve(await getCatalog(), selection));
    } catch (error) {
      const notFound = error instanceof EditorCatalogError
        && error.code === 'EDITOR_CATALOG_RENDERER_NOT_FOUND';
      const status = notFound ? 404 : 500;
      const code = notFound ? 'EDITOR_RENDERER_NOT_FOUND' : 'EDITOR_RESOLVE_FAILED';
      logRequestError('editor.resolve', req, error, { status, code });
      return res.status(status).json({
        error: notFound ? 'Renderer editorial não encontrado' : 'Não foi possível resolver o renderer',
        code,
      });
    }
  });

  return router;
}

module.exports = createEditorRouter();
module.exports.createEditorRouter = createEditorRouter;
