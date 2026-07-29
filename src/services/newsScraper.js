const cheerio = require('cheerio');
const safeHttpClient = require('../lib/safeHttpClient');
const { HTML_REQUEST_POLICY } = require('../lib/remoteRequestPolicy');
const { assertContentType } = safeHttpClient;

function cleanText(value, limit) {
  if (!value) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text.length) return null;
  return limit ? text.substring(0, limit) : text;
}

function extractChapeu($) {
  // Layout antigo da A Gazeta.
  const legacyChapeu = cleanText(
    $('label.text-tw-theme-box-kicker-default[id^="kicker-"]').first().text(),
    80
  );

  if (legacyChapeu) return legacyChapeu;

  // Layout atual (Netdeal): o chapéu fica na seção imediatamente anterior
  // à seção do título. As classes ND... são geradas dinamicamente, então a
  // relação entre as seções é mais estável do que seus nomes.
  const titleEl = $('h1')
    .filter((_, element) => cleanText($(element).text()))
    .first();
  const titleSection = titleEl.closest('.ND_PAGE_SECTION');
  if (!titleSection.length) return null;

  const kickerSection = titleSection.prevAll('.ND_PAGE_SECTION').first();
  if (!kickerSection.length) return null;

  const chapeu = cleanText(
    kickerSection.find('.nd-element-textable').first().text(),
    80
  );

  return chapeu;
}

async function fetch(url) {
  const response = await safeHttpClient.get(url, {
    ...HTML_REQUEST_POLICY,
    responseType: 'text',
  });
  assertContentType(response.headers?.['content-type'], [
    'text/html',
    'application/xhtml+xml',
  ]);
  const html = response.data;

  const $ = cheerio.load(html);

  const h1 =
    $('meta[property="og:title"]').attr('content') ||
    $('title').text() ||
    $('h1').first().text() ||
    null;

  const h2 =
    $('meta[property="og:description"]').attr('content') ||
    $('meta[name="description"]').attr('content') ||
    $('h2').first().text() ||
    null;

  const bg =
    $('meta[property="og:image"]').attr('content') ||
    $('meta[name="image"]').attr('content') ||
    $('img').first().attr('src') ||
    null;

  const chapeu = extractChapeu($);

  return {
    h1: cleanText(h1, 120),
    h2: cleanText(h2, 220),
    bg: cleanText(bg),
    chapeu: cleanText(chapeu, 80),
  };
}

module.exports = {
  fetch,
  extractChapeu,
};
