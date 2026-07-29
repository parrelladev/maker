const express = require('express');
const safeHttpClient = require('../lib/safeHttpClient');
const { validateImageResponse } = require('../lib/imageValidator');
const { IMAGE_REQUEST_POLICY } = require('../lib/remoteRequestPolicy');
const newsScraper = require('../services/newsScraper');
const { SafeHttpError } = safeHttpClient;

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

    if (chapeu) {
      // eslint-disable-next-line no-console
      console.debug('[scraper] Chapéu extraído:', chapeu);
    }

    return res.json({ h1, h2, bg: embeddedBg, bgSource: bg, chapeu });
  } catch (error) {
    return res.status(500).json({
      error: 'Erro ao extrair dados da notícia',
      detail: error.message,
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
    return res.status(422).json({
      error: 'Não foi possível baixar a imagem',
      detail: error.message,
    });
  }
});

module.exports = router;
