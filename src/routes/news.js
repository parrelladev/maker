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
const REQUIRED_NEWS_FIELDS = ['h1', 'h2', 'chapeu', 'bg'];

const router = express.Router();

function hasRequiredNewsContent(news) {
  return REQUIRED_NEWS_FIELDS.every(
    (field) => typeof news?.[field] === 'string' && news[field].trim() !== ''
  );
}

async function embedImage(imageUrl) {
  if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) {
    throw new SafeHttpError('REQUEST_FAILED');
  }

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
    const scrapedNews = await newsScraper.fetch(url);

    if (!hasRequiredNewsContent(scrapedNews)) {
      const error = new Error('Extração de notícia incompleta');
      error.code = 'NEWS_EXTRACTION_INCOMPLETE';
      throw error;
    }

    const { h1, h2, bg, chapeu } = scrapedNews;
    const embeddedBg = await embedImage(bg);

    return res.json({ h1, h2, bg: embeddedBg, bgSource: bg, chapeu });
  } catch (error) {
    if (error?.code === 'NEWS_EXTRACTION_INCOMPLETE') {
      logRequestError('news.extract', req, error, {
        status: 422,
        code: error.code,
      });
      return res.status(422).json({
        error: 'Não foi possível extrair todos os dados necessários da notícia',
        code: error.code,
      });
    }

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
