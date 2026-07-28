const express = require('express');
const axios = require('axios');
const newsScraper = require('../services/newsScraper');

const router = express.Router();

async function embedImage(imageUrl) {
  if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) return imageUrl;

  const response = await axios.get(imageUrl, {
    responseType: 'arraybuffer',
    timeout: 15000,
    maxContentLength: 12 * 1024 * 1024,
    maxBodyLength: 12 * 1024 * 1024,
    maxRedirects: 3,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Maker/1.0)' },
  });

  const contentType = String(response.headers['content-type'] || '').split(';')[0];
  if (!contentType.startsWith('image/')) {
    throw new Error('A imagem extraída não possui um tipo válido');
  }

  return `data:${contentType};base64,${Buffer.from(response.data).toString('base64')}`;
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

module.exports = router;
