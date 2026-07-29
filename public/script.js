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
  createArtworkData,
  getToastIcon,
  isHttpUrl,
  isValidResolvedImageValue,
  normalizeOptionalValue,
  validateGenerationInput
} = window.FrontendUtils;

const templateLookup = Object.fromEntries(storyTemplates.map(template => [template.id, template]));
const storyGroups = Array.from(new Set(storyTemplates.map(template => template.group)));
const DEFAULT_PAGE = 'index';
const STALE_GENERATION_CODE = 'GENERATION_STALE';

let currentTemplate = null;
let currentTemplateMeta = null;
let currentTheme = null;
let activeStoryGroup = storyGroups[0] || null;

// Estado da tela de geração
let lastNewsData = null;
let lastNewsUrl = null;
let currentManifestData = null;
let previewInitializedTemplate = null;
let previewInitializedPage = null;
let modalSessionVersion = 0;
let latestGenerationId = 0;
let resolvedImageFieldState = {
  source: null,
  value: null,
  newsUrl: null
};

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

function readGenerationFormData() {
  const imageFieldValue = normalizeOptionalValue(customImageUrl.value);
  const hasMatchingResolvedImage = (
    resolvedImageFieldState.source === 'extracted'
    && resolvedImageFieldState.value === customImageUrl.value
    && resolvedImageFieldState.newsUrl === normalizeOptionalValue(newsUrl.value)
  );

  return {
    newsUrl: normalizeOptionalValue(newsUrl.value),
    manualTitle: normalizeOptionalValue(customTitle.value),
    manualSubtitle: normalizeOptionalValue(customSubtitle.value),
    manualCategory: normalizeOptionalValue(customTag.value),
    manualImage: hasMatchingResolvedImage ? '' : imageFieldValue,
    resolvedImage: hasMatchingResolvedImage ? imageFieldValue : '',
    theme: currentTheme,
    template: currentTemplate
  };
}

function clearResolvedImageFieldState({ clearMatchingField = false } = {}) {
  if (
    clearMatchingField
    && resolvedImageFieldState.source === 'extracted'
    && resolvedImageFieldState.value === customImageUrl.value
  ) {
    customImageUrl.value = '';
  }

  resolvedImageFieldState = {
    source: null,
    value: null,
    newsUrl: null
  };
}

function setExtractedImageFieldValue(value, sourceNewsUrl) {
  customImageUrl.value = value;
  resolvedImageFieldState = {
    source: 'extracted',
    value,
    newsUrl: sourceNewsUrl
  };
}

function createGenerationContext(formData) {
  return {
    formData: { ...formData },
    generationId: ++latestGenerationId,
    modalSessionVersion,
    page: DEFAULT_PAGE,
    template: formData.template,
    url: formData.newsUrl
  };
}

function isGenerationContextCurrent(context) {
  return (
    context.generationId === latestGenerationId
    && context.modalSessionVersion === modalSessionVersion
    && context.template === currentTemplate
    && context.page === DEFAULT_PAGE
    && context.url === normalizeOptionalValue(newsUrl.value)
  );
}

function assertGenerationContextCurrent(context) {
  if (isGenerationContextCurrent(context)) return;

  const error = new Error('Geração obsoleta');
  error.code = STALE_GENERATION_CODE;
  throw error;
}

function isStaleGenerationError(error) {
  return error && error.code === STALE_GENERATION_CODE;
}

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

  newsUrl.addEventListener('input', () => {
    clearResolvedImageFieldState({ clearMatchingField: true });
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
      clearResolvedImageFieldState();
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

  modalSessionVersion += 1;
  currentTemplateMeta = templateData || null;
  currentTemplate = templateData ? templateData.id : templateKey;
  lastNewsData = null;
  lastNewsUrl = null;
  currentManifestData = null;
  previewInitializedTemplate = null;
  previewInitializedPage = null;
  clearResolvedImageFieldState();

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
  modalSessionVersion += 1;
  modal.classList.remove('show');
  currentTemplate = null;
  currentTemplateMeta = null;
  currentTheme = null;
  lastNewsData = null;
  lastNewsUrl = null;
  currentManifestData = null;
  previewInitializedTemplate = null;
  previewInitializedPage = null;
  clearResolvedImageFieldState();

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
  
  async function getOrExtractNewsData(url, assertCurrent = null) {
  if (assertCurrent) assertCurrent();

  if (lastNewsUrl === url && lastNewsData) {
    return lastNewsData;
  }

  clearResolvedImageFieldState({ clearMatchingField: true });
  const data = (await window.Api.extractNewsData(url)) || {};
  if (assertCurrent) assertCurrent();
  lastNewsUrl = url;
  lastNewsData = data;
  return data;
}

// Etapa 1: busca dados da matéria e monta o preview HTML
async function handleFetchNewsAndPreview() {
  const formData = readGenerationFormData();
  const url = formData.newsUrl;

  if (!formData.template) {
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

    const currentFormData = readGenerationFormData();

    if (!currentFormData.manualTitle && extractedData.h1) {
      customTitle.value = extractedData.h1;
    }
    if (!currentFormData.manualSubtitle && extractedData.h2) {
      customSubtitle.value = extractedData.h2;
    }
    if (!currentFormData.manualCategory && extractedData.chapeu) {
      customTag.value = extractedData.chapeu;
    }
    if (!currentFormData.manualImage && extractedData.bg) {
      setExtractedImageFieldValue(extractedData.bg, url);
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
async function ensurePreviewInitialized({
  template = currentTemplate,
  page = DEFAULT_PAGE,
  manifestData: providedManifestData = null,
  assertCurrent = null
} = {}) {
  if (!previewFrame || !template) {
    return null;
  }

  if (
    previewInitializedTemplate === template
    && previewInitializedPage === page
    && currentManifestData
  ) {
    if (assertCurrent) assertCurrent();
    return currentManifestData;
  }

  const manifestData = providedManifestData || await loadManifest(template, page);
  if (assertCurrent) assertCurrent();
  currentManifestData = manifestData;
  previewInitializedTemplate = template;
  previewInitializedPage = page;

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

function buildPreviewData(
  manifestData,
  backgroundOverride = null,
  formData = readGenerationFormData(),
  extractedDataOverride = null
) {
  const url = formData.newsUrl;
  const hasMatchingNews = lastNewsUrl && lastNewsUrl === url && lastNewsData;
  const extractedData = extractedDataOverride || (hasMatchingNews ? lastNewsData : {});

  return createArtworkData({
    formData,
    extractedData,
    manifest: manifestData.manifest,
    resolvedLogo: manifestData.resolvedLogo,
    theme: formData.theme,
    backgroundOverride
  });
}

function applyArtworkDataToPreview(artworkData) {
  const frameWindow = previewFrame && previewFrame.contentWindow;
  if (!frameWindow || typeof frameWindow.__updatePreview !== 'function') {
    return;
  }

  frameWindow.__updatePreview(artworkData);
}

async function updatePreview(backgroundOverride = null) {
  if (!previewFrame || !currentTemplate) {
    return;
  }

  try {
    const manifestData = await ensurePreviewInitialized();
    if (!manifestData) return;

    const artworkData = buildPreviewData(manifestData, backgroundOverride);
    applyArtworkDataToPreview(artworkData);
  } catch (error) {
    console.error('Erro ao atualizar preview:', error);
  }
}

// Etapa 3: gera o PNG final reaproveitando o que foi visto no preview.
async function generateArtWithPreviewFlow() {
  const formData = readGenerationFormData();

  const inputValidation = validateGenerationInput(formData);
  if (!applyGenerationValidation(inputValidation)) {
    return;
  }

  const generationContext = createGenerationContext(formData);
  const assertCurrent = () => assertGenerationContextCurrent(generationContext);

  try {
    showLoading();

    const manifestData = await loadManifest(
      generationContext.template,
      generationContext.page
    );
    assertCurrent();
    currentManifestData = manifestData;

    const extractedData = await getOrExtractNewsData(
      generationContext.url,
      assertCurrent
    );
    assertCurrent();

    if (
      !generationContext.formData.manualCategory
      && extractedData.chapeu
      && normalizeOptionalValue(customTag.value)
        === generationContext.formData.manualCategory
    ) {
      assertCurrent();
      customTag.value = extractedData.chapeu;
    }

    const artworkData = buildPreviewData(
      manifestData,
      null,
      generationContext.formData,
      extractedData
    );

    const resolvedContentValidation = validateGenerationInput({
      ...generationContext.formData,
      requireResolvedContent: true,
      resolvedCategory: artworkData.tag,
      effectiveImage: artworkData.bg
    });
    if (!applyGenerationValidation(resolvedContentValidation)) {
      return;
    }

    const pageName = manifestData.page || 'index';
    const exportBg = /^https?:\/\//i.test(artworkData.bg)
      ? await window.Api.embedImage(artworkData.bg)
      : artworkData.bg;
    assertCurrent();

    if (!isValidResolvedImageValue(exportBg)) {
      applyGenerationValidation({
        valid: false,
        code: 'IMAGE_REQUIRED',
        message: 'Não encontramos uma imagem válida. Informe um link de imagem ou tente novamente.',
        focusField: 'customImageUrl'
      });
      return;
    }

    const exportArtworkData = buildPreviewData(
      manifestData,
      exportBg,
      generationContext.formData,
      extractedData
    );
    await ensurePreviewInitialized({
      template: generationContext.template,
      page: generationContext.page,
      manifestData,
      assertCurrent
    });
    assertCurrent();
    applyArtworkDataToPreview(exportArtworkData);
    await window.PreviewExport.downloadPreview(
      previewFrame,
      manifestData,
      buildExportFilename(generationContext.template, pageName),
    );
    assertCurrent();

    showToast('Arte gerada e download iniciado!', 'success');
  } catch (error) {
    if (
      isStaleGenerationError(error)
      || !isGenerationContextCurrent(generationContext)
    ) {
      return;
    }
    console.error('Erro ao gerar arte:', error);
    showToast('Erro ao gerar arte: ' + error.message, 'error');
  } finally {
    if (generationContext.generationId === latestGenerationId) {
      hideLoading();
    }
  }
}

function applyGenerationValidation(validation) {
  if (validation.valid) return true;

  showToast(validation.message, 'error');

  const focusTargets = {
    newsUrl,
    customImageUrl,
    customTag
  };
  const focusTarget = focusTargets[validation.focusField];
  if (focusTarget) {
    focusTarget.focus();
  }

  return false;
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
