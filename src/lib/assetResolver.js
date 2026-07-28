const fs = require('fs');
const path = require('path');
const axios = require('axios');

const INPUT_DIR = path.resolve('input');
const LOGO_EXTENSIONS = ['.svg', '.png', '.jpg', '.jpeg', '.webp'];
const LOGO_CACHE = new Map();

function isRemoteUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

async function resolveLogoAsset(value, altText) {
  if (!value) {
    return null;
  }

  const cached = LOGO_CACHE.get(value);
  if (cached) {
    return { ...cached, alt: altText || cached.alt };
  }

  if (isRemoteUrl(value)) {
    if (/\.svg(\?|#|$)/i.test(value)) {
      const response = await axios.get(value, { responseType: 'text' });
      const markup = String(response.data || '').trim();
      if (!markup.includes('<svg')) {
        throw new Error(`Conteúdo SVG inválido em ${value}`);
      }
      const result = { kind: 'inline-svg', markup, source: value, sourceType: 'remote', alt: altText };
      LOGO_CACHE.set(value, result);
      return result;
    }

    const result = { kind: 'image', src: value, source: value, sourceType: 'remote', alt: altText };
    LOGO_CACHE.set(value, result);
    return result;
  }

  const extension = path.extname(value);
  const candidateNames = extension ? [value] : LOGO_EXTENSIONS.map((ext) => `${value}${ext}`);

  for (const candidate of candidateNames) {
    const candidatePath = path.isAbsolute(candidate) ? candidate : path.join(INPUT_DIR, candidate);
    if (!fs.existsSync(candidatePath)) continue;

    if (candidate.toLowerCase().endsWith('.svg')) {
      const markup = fs.readFileSync(candidatePath, 'utf-8');
      if (!markup.includes('<svg')) {
        throw new Error(`Conteúdo SVG inválido em ${candidatePath}`);
      }
      const result = {
        kind: 'inline-svg',
        markup: markup.trim(),
        source: candidatePath,
        sourceType: 'local',
        alt: altText,
      };
      LOGO_CACHE.set(value, result);
      return result;
    }

    const result = {
      kind: 'image',
      src: candidatePath,
      source: candidatePath,
      sourceType: 'local',
      alt: altText,
    };
    LOGO_CACHE.set(value, result);
    return result;
  }

  throw new Error(`Logo não encontrada: ${value}`);
}

module.exports = {
  resolveLogoAsset,
};

