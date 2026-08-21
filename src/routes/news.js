const express = require('express');
const safeHttpClient = require('../lib/safeHttpClient');
const { validateImageResponse } = require('../lib/imageValidator');
const { IMAGE_REQUEST_POLICY } = require('../lib/remoteRequestPolicy');
const {
  getPublicRemoteError,
  logRequestError,
} = require('../lib/httpErrorResponse');
const newsScraper = require('../services/newsScraper');
const { SafeHttpError } = safeHttpClient;
const NEWS_URL_ERROR_CODES = new Set([
  'INVALID_URL',
  'UNSUPPORTED_PROTOCOL',
  'URL_CREDENTIALS',
]);

const router = express.Router();

async function embedImage(imageUrl) {
  if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) return imageUrl;

  try {
    const response = await safeHttpClient.get(imageUrl, {
      ...IMAGE_REQUEST_POLICY,
      responseType: 'arraybuffer',
    });

    const { contentType, buffer } = validateImageResponse(response, {
      maxBytes: IMAGE_REQUEST_POLICY.maxBytes,
    });

    return `data:${contentType};base64,${buffer.toString('base64')}`;
  } catch (error) {
    if (error instanceof SafeHttpError) throw error;
    if (error?.name === 'SafeHttpError' && typeof error.code === 'string') {
      throw new SafeHttpError(error.code, { cause: error });
    }
    throw new SafeHttpError('REQUEST_FAILED', { cause: error });
  }
}

router.post('/extract', async (req, res) => {
  const { url } = req.body || {};

  if (!url) {
    return res.status(400).json({ error: 'URL é obrigatória' });
  }

  try {
    const { h1, h2, bg, chapeu } = await newsScraper.fetch(url);
    const embeddedBg = bg ? await embedImage(bg) : null;

    return res.json({ h1, h2, bg: embeddedBg, bgSource: bg, chapeu });
  } catch (error) {
    const publicError = getPublicRemoteError(error, {
      fallbackCode: 'NEWS_EXTRACTION_FAILED',
    });
    const invalidNewsUrl = NEWS_URL_ERROR_CODES.has(publicError.code);
    const status = invalidNewsUrl ? 400 : 500;
    logRequestError('news.extract', req, error, {
      status,
      code: publicError.code,
    });
    return res.status(status).json({
      error: invalidNewsUrl
        ? 'URL da notícia inválida'
        : 'Erro ao extrair dados da notícia',
      ...publicError,
    });
  }
});

router.post('/embed-image', async (req, res) => {
  const { url } = req.body || {};

  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'URL de imagem inválida' });
  }

  try {
    const dataUrl = await embedImage(url);
    return res.json({ dataUrl });
  } catch (error) {
    const publicError = getPublicRemoteError(error, {
      fallbackCode: 'IMAGE_DOWNLOAD_FAILED',
      fallbackDetail: 'Falha ao baixar a imagem',
    });
    logRequestError('news.embed-image', req, error, {
      status: 422,
      code: publicError.code,
    });
    return res.status(422).json({
      error: 'Não foi possível baixar a imagem',
      ...publicError,
    });
  }
});

module.exports = router;
