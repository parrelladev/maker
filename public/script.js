const storyTemplates = [
  // PRINCIPAIS
  {
    id: 'agazeta-foto-abaixo',
    name: 'A Gazeta - Foto abaixo',
    group: 'Principais',
    preview: 'previews/stories/Marca-A-Gazeta.png',
    defaultTheme: 'azul',
    themes: [
      { id: 'azul', name: 'Azul', preview: 'previews/stories/horiz-foto-lateral-azul.png' },
      { id: 'branco', name: 'Branco', preview: 'previews/stories/horiz-conteudo-central-vermelho.png' },
      { id: 'preto', name: 'Preto', preview: 'previews/stories/horiz-foto-acima-laranja.png' }
    ]
  },
  {
    id: 'agazeta-foto-acima',
    name: 'A Gazeta - Foto acima',
    group: 'Principais',
    preview: 'previews/stories/Marca-A-Gazeta.png',
    defaultTheme: 'azul',
    themes: [
      { id: 'azul', name: 'Azul', preview: 'previews/stories/vert-foto-acima-azul.png' },
      { id: 'branco', name: 'Branco', preview: 'previews/stories/vert-conteudo-central-verde.png' },
      { id: 'preto', name: 'Preto', preview: 'previews/stories/vert-conteudo-inferior-roxo.png' }
    ]
  },
  {
    id: 'layout-hz',
    name: 'HZ Entretenimento',
    group: 'Principais',
    preview: 'previews/stories/Marca-HZ-Principal-Positivo.png',
    defaultTheme: 'rosa',
    themes: [
      { id: 'rosa', name: 'Rosa', preview: 'previews/stories/horiz-conteudo-diagonal-roxo.png' },
      { id: 'amarelo', name: 'Amarelo', preview: 'previews/stories/vert-foto-lateral-amarelo.png' }
    ]
  },

  // ESPECIAIS
  {
    id: 'colunistas',
    name: 'A Gazeta - Colunistas',
    group: 'Especiais',
    status: 'construction',
    preview: 'previews/stories/Marca-A-Gazeta-Black.png',
    themes: []
  },
  {
    id: 'opiniao',
    name: 'A Gazeta - Opinião',
    group: 'Especiais',
    status: 'construction',
    preview: 'previews/stories/Marca-A-Gazeta-Black.png',
    themes: []
  },
  {
    id: 'layout-bbc',
    name: 'BBC News',
    group: 'Especiais',
    status: 'construction',
    preview: 'previews/stories/Marca-BBC.png',
    themes: []
  },
  {
    id: 'fonte-hub',
    name: 'Fonte Hub',
    group: 'Especiais',
    preview: 'previews/stories/Marca-Fonte-Hub.png',
    themes: []
  },
  {
    id: 'se-cuida',
    name: 'HZ - Se Cuida',
    group: 'Especiais',
    status: 'construction',
    preview: 'previews/stories/Marca-Se-Cuida.png',
    themes: []
  },
  {
    id: 'rede-gazeta',
    name: 'Rede Gazeta',
    group: 'Especiais',
    preview: 'previews/stories/Marca-Rede-Gazeta.png',
    themes: []
  }
];

const {
  buildExportFilename,
  getToastIcon,
  isHttpUrl,
  normalizeOptionalValue
} = window.FrontendUtils;

const templateLookup = Object.fromEntries(storyTemplates.map(template => [template.id, template]));
const storyGroups = Array.from(new Set(storyTemplates.map(template => template.group)));

let currentTemplate = null;
let currentTemplateMeta = null;
let currentTheme = null;
let activeStoryGroup = storyGroups[0] || null;

// Estado da tela de geração
let lastNewsData = null;
let lastNewsUrl = null;
let currentManifestData = null;
let previewInitializedTemplate = null;

const modal = document.getElementById('templateModal');
const closeModal = document.getElementById('closeModal');
const cancelBtn = document.getElementById('cancelBtn');
const generateBtn = document.getElementById('generateBtn');
const loadingOverlay = document.getElementById('loadingOverlay');
const toastContainer = document.getElementById('toastContainer');
const newsUrl = document.getElementById('newsUrl');
const customTitle = document.getElementById('customTitle');
const customSubtitle = document.getElementById('customSubtitle');
const customImageUrl = document.getElementById('customImageUrl');
const themeWrapper = document.getElementById('themeWrapper');
const customTheme = document.getElementById('customTheme');
const customTag = document.getElementById('customTag');
const modalTitle = document.getElementById('modalTitle');
const storyCategoryTabs = document.getElementById('storyCategoryTabs');
const storyTemplateGrid = document.getElementById('storyTemplateGrid');
const fetchDataBtn = document.getElementById('fetchDataBtn');
const previewFrame = document.getElementById('previewFrame');
const previewPlaceholder = document.getElementById('previewPlaceholder');

function resizePreviewFrame() {
  const wrapper = document.querySelector('.preview-frame-wrapper');
  if (!wrapper || !previewFrame) return;

  const wrapperWidth = wrapper.clientWidth;
  if (!wrapperWidth) return;

  const scale = wrapperWidth / 1080; // 1080 = largura real do canvas
  previewFrame.style.transform = `translate(-50%, -50%) scale(${scale})`;
}

document.addEventListener('DOMContentLoaded', () => {
  if (themeWrapper) {
    themeWrapper.style.display = 'none';
  }

  renderCategoryTabs();
  renderTemplateCards();
  setupEventListeners();
  resizePreviewFrame();
});

function setupEventListeners() {
  if (storyCategoryTabs) {
    storyCategoryTabs.addEventListener('click', (event) => {
      const tab = event.target.closest('[data-group]');
      if (!tab) return;

      const { group } = tab.dataset;
      if (group && group !== activeStoryGroup) {
        activeStoryGroup = group;
        renderCategoryTabs();
        renderTemplateCards();
      }
    });
  }

  if (storyTemplateGrid) {
    storyTemplateGrid.addEventListener('click', (event) => {
      const card = event.target.closest('.template-card');
      if (!card) return;

      const templateId = card.dataset.template;
      if (templateId) {
        openModal(templateId);
      }
    });
  }

  document.addEventListener('click', (event) => {
    const card = event.target.closest('.template-card');
    if (!card || card.closest('#storyTemplateGrid')) return;

    const templateId = card.dataset.template;
    if (templateId) {
      openModal(templateId);
    }
  });

  if (closeModal) {
    closeModal.addEventListener('click', closeModalHandler);
  }
  if (cancelBtn) {
    cancelBtn.addEventListener('click', closeModalHandler);
  }

  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      closeModalHandler();
    }
  });

  generateBtn.addEventListener('click', generateArtWithPreviewFlow);

  newsUrl.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
      handleFetchNewsAndPreview();
    }
  });

  if (fetchDataBtn) {
    fetchDataBtn.addEventListener('click', handleFetchNewsAndPreview);
  }

  if (customTitle) {
    customTitle.addEventListener('input', () => {
      updatePreview().catch(() => {});
    });
  }

  if (customSubtitle) {
    customSubtitle.addEventListener('input', () => {
      updatePreview().catch(() => {});
    });
  }

  if (customTag) {
    customTag.addEventListener('input', () => {
      updatePreview().catch(() => {});
    });
  }

  if (customImageUrl) {
    customImageUrl.addEventListener('input', () => {
      updatePreview().catch(() => {});
    });
  }

  if (customTheme) {
    customTheme.addEventListener('change', (event) => {
      currentTheme = event.target.value || null;
      updateModalTitle();
      updatePreview().catch(() => {});
    });
  }

  window.addEventListener('resize', resizePreviewFrame);
}

function renderCategoryTabs() {
  if (!storyCategoryTabs) return;

  storyCategoryTabs.innerHTML = '';

  storyGroups.forEach(group => {
    const tabButton = document.createElement('button');
    tabButton.type = 'button';
    tabButton.className = `category-tab${group === activeStoryGroup ? ' active' : ''}`;
    tabButton.dataset.group = group;
    tabButton.textContent = group;
    storyCategoryTabs.appendChild(tabButton);
  });
}

function renderTemplateCards() {
  if (!storyTemplateGrid) return;

  storyTemplateGrid.innerHTML = '';

  const templatesToRender = activeStoryGroup
    ? storyTemplates.filter(template => template.group === activeStoryGroup)
    : storyTemplates;

  templatesToRender.forEach(template => {
    const card = document.createElement('div');
    card.className = 'template-card story-card';
    card.dataset.group = template.group;
    card.dataset.template = template.id;

    const themeInfo = Array.isArray(template.themes) && template.themes.length
      ? (template.themes.length === 1
        ? '<span class="template-meta">Tema unico</span>'
        : `<span class="template-meta">${template.themes.length} temas</span>`)
      : '';

    const statusPill = template.status === 'construction'
      ? '<span class="template-pill template-pill-warning">Em construção</span>'
      : '';

    card.innerHTML = `
      <div class="template-preview">
        <img src="${template.preview}" alt="${template.name}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
        <div class="template-placeholder" style="display: none;">
          <i class="fa-solid fa-image"></i>
        </div>
      </div>
      <div class="template-info">
        <span class="template-pill">${template.group}</span>
        ${statusPill}
        <p class="template-label">${template.name}</p>
        ${themeInfo}
      </div>
    `;

    storyTemplateGrid.appendChild(card);
  });

  if (!storyTemplateGrid.children.length) {
    const emptyState = document.createElement('div');
    emptyState.className = 'empty-state';
    emptyState.textContent = 'Nenhum template disponivel para este agrupamento.';
    storyTemplateGrid.appendChild(emptyState);
  }
}

function updateModalTitle() {
  if (!modalTitle) return;

  if (!currentTemplateMeta) {
    modalTitle.textContent = currentTemplate ? `Gerar Arte - ${currentTemplate}` : 'Gerar Arte';
    return;
  }

  let title = `Gerar Arte - ${currentTemplateMeta.name}`;
  if (Array.isArray(currentTemplateMeta.themes) && currentTemplateMeta.themes.length) {
    const activeTheme = currentTemplateMeta.themes.find(theme => theme.id === currentTheme);
    if (activeTheme) {
      title += ` (${activeTheme.name})`;
    }
  }

  modalTitle.textContent = title;
}

function openModal(templateKey) {
  const templateData = templateLookup[templateKey];

  currentTemplateMeta = templateData || null;
  currentTemplate = templateData ? templateData.id : templateKey;
  lastNewsData = null;
  lastNewsUrl = null;
  currentManifestData = null;
  previewInitializedTemplate = null;

  if (templateData && Array.isArray(templateData.themes) && templateData.themes.length) {
    const defaultTheme = templateData.defaultTheme || templateData.themes[0].id;
    currentTheme = defaultTheme;

    if (customTheme) {
      customTheme.innerHTML = templateData.themes
        .map(theme => `<option value="${theme.id}">${theme.name}</option>`)
        .join('');
      customTheme.value = currentTheme;
    }

    if (themeWrapper) {
      themeWrapper.style.display = '';
    }
  } else {
    currentTheme = null;
    if (customTheme) {
      customTheme.innerHTML = '';
    }
    if (themeWrapper) {
      themeWrapper.style.display = 'none';
    }
  }

  updateModalTitle();

  newsUrl.value = '';
  customTitle.value = '';
  customSubtitle.value = '';
  customImageUrl.value = '';
  customTag.value = '';

  if (previewFrame) {
    const frameDoc = previewFrame.contentDocument || previewFrame.contentWindow?.document;
    if (frameDoc) {
      frameDoc.open();
      frameDoc.write('<!DOCTYPE html><html><head><meta charset="utf-8"></head><body></body></html>');
      frameDoc.close();
    }
  }
  if (previewPlaceholder) {
    previewPlaceholder.style.display = '';
  }

  modal.classList.add('show');
  newsUrl.focus();
  resizePreviewFrame();
}

function closeModalHandler() {
  modal.classList.remove('show');
  currentTemplate = null;
  currentTemplateMeta = null;
  currentTheme = null;
  lastNewsData = null;
  lastNewsUrl = null;
  currentManifestData = null;
  previewInitializedTemplate = null;

  if (customTheme) {
    customTheme.innerHTML = '';
  }
  if (themeWrapper) {
    themeWrapper.style.display = 'none';
  }
}

async function loadManifest(template, page = 'index') {
    return window.Api.loadManifest(template, page);
  }
  
  async function getOrExtractNewsData(url) {
  if (lastNewsUrl === url && lastNewsData) {
    return lastNewsData;
  }

  const data = (await window.Api.extractNewsData(url)) || {};
  lastNewsUrl = url;
  lastNewsData = data;
  return data;
}

// Etapa 1: busca dados da matéria e monta o preview HTML
async function handleFetchNewsAndPreview() {
  const url = normalizeOptionalValue(newsUrl.value);

  if (!currentTemplate) {
    showToast('Escolha um template antes de buscar os dados', 'error');
    return;
  }

  if (!url) {
    showToast('Por favor, insira o link da notícia', 'error');
    newsUrl.focus();
    return;
  }

  if (!isHttpUrl(url)) {
    showToast('Por favor, insira um link válido', 'error');
    newsUrl.focus();
    return;
  }

  try {
    if (fetchDataBtn) {
      fetchDataBtn.disabled = true;
    }

    const extractedData = await getOrExtractNewsData(url);

    if (!extractedData || (!extractedData.h1 && !extractedData.h2 && !extractedData.bg)) {
      showToast('Não foi possível extrair dados desta notícia.', 'error');
      return;
    }

    if (!normalizeOptionalValue(customTitle.value) && extractedData.h1) {
      customTitle.value = extractedData.h1;
    }
    if (!normalizeOptionalValue(customSubtitle.value) && extractedData.h2) {
      customSubtitle.value = extractedData.h2;
    }
    if (!normalizeOptionalValue(customTag.value) && extractedData.chapeu) {
      customTag.value = extractedData.chapeu;
    }
    if (!normalizeOptionalValue(customImageUrl.value) && extractedData.bg) {
      customImageUrl.value = extractedData.bg;
    }

    await updatePreview();

    showToast('Dados da notícia carregados. Ajuste o texto se quiser.', 'success');
  } catch (error) {
    console.error('Erro ao buscar dados da notícia:', error);
    showToast('Erro ao buscar dados da notícia: ' + error.message, 'error');
  } finally {
    if (fetchDataBtn) {
      fetchDataBtn.disabled = false;
    }
  }
}

// Monta o HTML/CSS do template dentro do iframe de preview reaproveitando o manifest.
async function ensurePreviewInitialized() {
  if (!previewFrame || !currentTemplate) {
    return null;
  }

  if (previewInitializedTemplate === currentTemplate && currentManifestData) {
    return currentManifestData;
  }

  const manifestData = await loadManifest(currentTemplate, 'index');
  currentManifestData = manifestData;
  previewInitializedTemplate = currentTemplate;

  const frameDoc = previewFrame.contentDocument || previewFrame.contentWindow.document;
  if (!frameDoc) {
    return manifestData;
  }

  const cssContent = Array.isArray(manifestData.css)
    ? manifestData.css.map(file => file.content || '').join('\n')
    : '';

  const manifestJson = JSON.stringify(manifestData.manifest || {});

  // Runtime de binding usado pelo preview e pela exportação client-side.
  const bindingScript = `
    (function () {
      var manifest = ${manifestJson};

      // Mantém o canvas do template proporcional dentro da janela do iframe
      var designWidth = (manifest && manifest.dimensions && manifest.dimensions.width) || 1080;
      var designHeight = (manifest && manifest.dimensions && manifest.dimensions.height) || 1920;

      function applyPreviewScale() {
        try {
          var vw = window.innerWidth || document.documentElement.clientWidth;
          var vh = window.innerHeight || document.documentElement.clientHeight;
          if (!vw || !vh) return;

          var scaleX = vw / designWidth;
          var scaleY = vh / designHeight;
          var scale = Math.min(scaleX, scaleY);

          var root = document.documentElement;
          var body = document.body;

          root.style.transformOrigin = 'top left';
          root.style.transform = 'scale(' + scale + ')';
          root.style.width = designWidth + 'px';
          root.style.height = designHeight + 'px';

          if (body) {
            body.style.margin = '0';
            body.style.padding = '0';
            body.style.overflow = 'hidden';
            body.style.display = 'flex';
            body.style.alignItems = 'stretch';
            body.style.justifyContent = 'center';
            body.style.backgroundColor = '#000';
          }
        } catch (e) {
          console.error('Erro ao aplicar escala de preview:', e);
        }
      }

      window.addEventListener('resize', applyPreviewScale);
      window.addEventListener('load', applyPreviewScale);
      setTimeout(applyPreviewScale, 0);

      function toClassList(value) {
        if (Array.isArray(value)) return value.filter(Boolean);
        if (typeof value === 'string') return value.split(/\\s+/).filter(Boolean);
        if (value === undefined || value === null) return [];
        return [String(value)];
      }

      function getValue(data, field, fallback) {
        if (!field) return fallback;
        var parts = field.split('.');
        var acc = data;
        for (var i = 0; i < parts.length; i++) {
          if (acc && typeof acc === 'object' && Object.prototype.hasOwnProperty.call(acc, parts[i])) {
            acc = acc[parts[i]];
          } else {
            return fallback;
          }
        }
        return acc;
      }

      function applyBindings(manifest, data) {
        data = data || {};
        var bindings = Array.isArray(manifest.bindings) ? manifest.bindings : [];
        var cssVars = Array.isArray(manifest.cssVars) ? manifest.cssVars : [];
        var classes = Array.isArray(manifest.classes) ? manifest.classes : [];
        var attributes = Array.isArray(manifest.attributes) ? manifest.attributes : [];

        bindings.forEach(function (binding) {
          if (!binding || !binding.selector) return;
          var value = Object.prototype.hasOwnProperty.call(binding, 'value')
            ? binding.value
            : getValue(data, binding.field);
          if (value === undefined || value === null) return;

          var targets = Array.prototype.slice.call(document.querySelectorAll(binding.selector));
          if (!targets.length) return;

          targets.forEach(function (el) {
            var type = binding.type || 'text';
            if (type === 'html') {
              el.innerHTML = String(value);
            } else if (type === 'image') {
              el.src = String(value);
            } else if (type === 'logo') {
              if (value && value.kind === 'inline-svg' && value.markup) {
                el.innerHTML = value.markup;
              } else if (value && value.src) {
                if (el.tagName && el.tagName.toLowerCase() === 'img') {
                  el.src = value.src;
                } else {
                  el.style.backgroundImage = 'url(' + value.src + ')';
                }
              }
            } else {
              el.textContent = String(value);
            }
          });
        });

        cssVars.forEach(function (entry) {
          if (!entry || !entry.name) return;
          var selector = entry.selector || ':root';
          var value = Object.prototype.hasOwnProperty.call(entry, 'value')
            ? entry.value
            : getValue(data, entry.field);
          if (value === undefined || value === null) return;
          var targets = selector === ':root'
            ? [document.documentElement]
            : Array.prototype.slice.call(document.querySelectorAll(selector));
          targets.forEach(function (el) {
            el.style.setProperty(entry.name, String(value));
          });
        });

        classes.forEach(function (entry) {
          if (!entry || !entry.selector) return;
          var value = Object.prototype.hasOwnProperty.call(entry, 'value')
            ? entry.value
            : getValue(data, entry.field);
          if (value === undefined || value === null) return;
          var targetList = Array.prototype.slice.call(document.querySelectorAll(entry.selector));
          var classList = toClassList(value);
          targetList.forEach(function (el) {
            classList.forEach(function (cls) {
              el.classList.add(cls);
            });
          });
        });

        attributes.forEach(function (entry) {
          if (!entry || !entry.selector || !entry.name) return;
          var value = Object.prototype.hasOwnProperty.call(entry, 'value')
            ? entry.value
            : getValue(data, entry.field);
          if (value === undefined || value === null) return;
          var targetList = Array.prototype.slice.call(document.querySelectorAll(entry.selector));
          targetList.forEach(function (el) {
            el.setAttribute(entry.name, String(value));
          });
        });
      }

      window.__updatePreview = function (data) {
        try {
          applyBindings(manifest, data || {});
          applyPreviewScale();
        } catch (err) {
          console.error('Erro ao aplicar bindings no preview:', err);
        }
      };
    })();
  `;

  const baseHref = `/templates/${manifestData.template}/${manifestData.page || 'index'}/`;

  const iframeHtml = `<!DOCTYPE html>
  <html lang="pt-BR">
    <head>
      <meta charset="utf-8">
      <base href="${baseHref}">
      <style>
      ${cssContent}
      html, body {
        margin: 0;
        padding: 0;
      }
      </style>
    </head>
    <body>
      ${manifestData.html}
      <script src="/vendor/html-to-image.js"><\/script>
      <script>${bindingScript}<\/script>
    </body>
  </html>`;

  frameDoc.open();
  frameDoc.write(iframeHtml);
  frameDoc.close();

  if (previewPlaceholder) {
    previewPlaceholder.style.display = 'none';
  }

  return manifestData;
}

function buildPreviewData(manifestData, backgroundOverride = null) {
  const url = normalizeOptionalValue(newsUrl.value);
  const hasMatchingNews = lastNewsUrl && lastNewsUrl === url && lastNewsData;
  const extractedData = hasMatchingNews ? lastNewsData : {};

  const manualTitle = normalizeOptionalValue(customTitle.value);
  const manualSubtitle = normalizeOptionalValue(customSubtitle.value);
  const manualTag = normalizeOptionalValue(customTag.value);
  const manualBg = normalizeOptionalValue(customImageUrl.value);

  const effectiveTitle = manualTitle || extractedData.h1 || '';
  const effectiveSubtitle = manualSubtitle || extractedData.h2 || '';
  const extractedChapeu = extractedData.chapeu || '';
  const effectiveTag = manualTag || extractedChapeu || '';
  const effectiveBg = backgroundOverride || manualBg || extractedData.bg || '';

  const logoField = manifestData.manifest?.logoField || 'logo';
  const defaultLogo = manifestData.manifest?.defaultLogo || 'logo-a-gazeta';

  const themeName = currentTheme || null;
  const themeStylesheet = themeName ? `../css/theme-${themeName}.css` : null;

  const data = {
    h1: effectiveTitle,
    h2: effectiveSubtitle,
    tag: effectiveTag,
    chapeu: extractedChapeu || null,
    bg: effectiveBg,
    resolvedBg: effectiveBg,
    themeName,
    themeStylesheet
  };

  data[logoField] = defaultLogo;

  const manifestResolvedLogo = manifestData.resolvedLogo || null;

  if (manifestResolvedLogo && manifestResolvedLogo.kind === 'inline-svg' && manifestResolvedLogo.markup) {
    data.resolvedLogo = {
      kind: 'inline-svg',
      markup: manifestResolvedLogo.markup
    };
  } else if (manifestResolvedLogo && manifestResolvedLogo.kind === 'image' && manifestResolvedLogo.src) {
    data.resolvedLogo = {
      kind: 'image',
      src: manifestResolvedLogo.src
    };
  } else {
    // fallback antigo: resolve logo para o preview, usando as mesmas convenções do generator:
    // - se for URL absoluta (http/https), usa direto
    // - se for um nome de arquivo (logo-a-gazeta.svg, logo-hz.png etc.), aponta para /input/<arquivo>
    let logoSrc = null;
    if (defaultLogo) {
      if (/^https?:\/\//i.test(defaultLogo)) {
        logoSrc = defaultLogo;
      } else {
        logoSrc = `/input/${defaultLogo}`;
      }
    }

    data.resolvedLogo = logoSrc
      ? { kind: 'image', src: logoSrc }
      : null;
  }

  return data;
}

async function updatePreview(backgroundOverride = null) {
  if (!previewFrame || !currentTemplate) {
    return;
  }

  try {
    const manifestData = await ensurePreviewInitialized();
    if (!manifestData) return;

    const frameWindow = previewFrame.contentWindow;
    if (!frameWindow || typeof frameWindow.__updatePreview !== 'function') {
      return;
    }

    const payload = buildPreviewData(manifestData, backgroundOverride);
    frameWindow.__updatePreview(payload);
  } catch (error) {
    console.error('Erro ao atualizar preview:', error);
  }
}

// Etapa 3: gera o PNG final reaproveitando o que foi visto no preview.
async function generateArtWithPreviewFlow() {
  const url = normalizeOptionalValue(newsUrl.value);
  const imageOverride = normalizeOptionalValue(customImageUrl.value);

  if (!currentTemplate) {
    showToast('Escolha um template antes de gerar a arte', 'error');
    return;
  }

  if (!url) {
    showToast('Por favor, insira o link da notícia', 'error');
    newsUrl.focus();
    return;
  }

  if (!isHttpUrl(url)) {
    showToast('Por favor, insira um link válido', 'error');
    newsUrl.focus();
    return;
  }

  if (imageOverride && !isHttpUrl(imageOverride)) {
    showToast('Informe um link de imagem válido (http ou https).', 'error');
    customImageUrl.focus();
    return;
  }

  try {
    showLoading();

    const manifestData = await loadManifest(currentTemplate, 'index');
    currentManifestData = manifestData;

    const extractedData = await getOrExtractNewsData(url);
    const extractedChapeu = extractedData.chapeu || null;

    if (!normalizeOptionalValue(customTag.value) && extractedChapeu) {
      customTag.value = extractedChapeu;
    }

    const manualTag = normalizeOptionalValue(customTag.value);
    const resolvedChapeu = manualTag || extractedChapeu || '';
    const effectiveBg = imageOverride || extractedData.bg || null;

    if (!resolvedChapeu) {
      showToast('Por favor, insira a categoria da notícia', 'error');
      customTag.focus();
      return;
    }

    if (!effectiveBg) {
      showToast('Não encontramos uma imagem válida. Informe um link de imagem ou tente novamente.', 'error');
      customImageUrl.focus();
      return;
    }

    const pageName = manifestData.page || 'index';
    const exportBg = /^https?:\/\//i.test(effectiveBg)
      ? await window.Api.embedImage(effectiveBg)
      : effectiveBg;

    await updatePreview(exportBg);
    await window.PreviewExport.downloadPreview(
      previewFrame,
      manifestData,
      buildExportFilename(currentTemplate, pageName),
    );

    showToast('Arte gerada e download iniciado!', 'success');
  } catch (error) {
    console.error('Erro ao gerar arte:', error);
    showToast('Erro ao gerar arte: ' + error.message, 'error');
  } finally {
    hideLoading();
  }
}

function showLoading() {
  loadingOverlay.classList.add('show');
  generateBtn.disabled = true;
}

function hideLoading() {
  loadingOverlay.classList.remove('show');
  generateBtn.disabled = false;
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icon = getToastIcon(type);

  toast.innerHTML = `
    <i class="fas fa-${icon}"></i>
    <span>${message}</span>
  `;

  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 5000);
}
