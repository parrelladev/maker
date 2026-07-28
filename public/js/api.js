(function (global) {
  const manifestCache = {};

  async function loadManifest(template, page = 'index') {
    const cacheKey = `${template}/${page}`;
    if (manifestCache[cacheKey]) return manifestCache[cacheKey];

    const response = await fetch(`/api/templates/${template}/${page}`);
    if (!response.ok) throw new Error('Template não encontrado');

    const data = await response.json();
    manifestCache[cacheKey] = data;
    return data;
  }

  async function extractNewsData(url) {
    try {
      const response = await fetch('/api/news/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      if (!response.ok) throw new Error('Erro ao extrair dados da notícia');
      return await response.json();
    } catch (error) {
      console.error('Erro ao extrair dados:', error);
      return {};
    }
  }

  async function embedImage(url) {
    const response = await fetch('/api/news/embed-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.detail || data.error || 'Não foi possível baixar a imagem');
    }
    if (!data.dataUrl) {
      throw new Error('O servidor não retornou uma imagem válida');
    }

    return data.dataUrl;
  }

  global.Api = { loadManifest, extractNewsData, embedImage };
})(window);
