const {
  buildExportFilename,
  createArtworkData,
  getToastIcon,
  isHttpUrl,
  isValidResolvedImageValue,
  normalizeOptionalValue,
  validateGenerationInput
} = window.FrontendUtils;

const DEFAULT_PAGE = 'index';
const STALE_OPERATION_CODE = 'OPERATION_STALE';

let currentTemplate = null;
let currentPage = DEFAULT_PAGE;
let currentTheme = null;

// Estado da tela de geração
let lastNewsData = null;
let lastNewsUrl = null;
let currentManifestData = null;
let previewInitializedTemplate = null;
let previewInitializedPage = null;
let previewInitializationVersion = 0;
// Estado técnico de sessão do renderer; a seleção editorial pertence à publication.
let editorSessionVersion = 0;
let latestGenerationId = 0;
let latestBestEffortPreviewUpdateId = 0;
let editorPreviewReady = false;
const contentSyncPending = { feed: false, story: false };
let currentImageAdjustments = { zoom: 1, x: 50, y: 50 };
let currentFormat = null;
const generateDisableReasons = new Set();
let resolvedImageFieldState = {
  source: null,
  value: null,
  newsUrl: null
};

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
const previewFrame = document.getElementById('previewFrame');
const previewFrameFeed = document.getElementById('previewFrameFeed');
const previewPlaceholder = document.getElementById('previewPlaceholder');
const previewContexts = {
  story: {
    frame: previewFrame,
    placeholder: previewPlaceholder,
    template: null, page: DEFAULT_PAGE, theme: null, format: 'story',
    manifestData: null, initializedTemplate: null, initializedPage: null,
    initializationVersion: 0, ready: false,
    imageAdjustments: { zoom: 1, x: 50, y: 50 }
  },
  feed: {
    frame: previewFrameFeed,
    placeholder: document.querySelector('[data-preview-placeholder="feed"]'),
    template: null, page: DEFAULT_PAGE, theme: null, format: 'feed',
    manifestData: null, initializedTemplate: null, initializedPage: null,
    initializationVersion: 0, ready: false,
    imageAdjustments: { zoom: 1, x: 50, y: 50 }
  }
};

function getPreviewContext(format = currentFormat) {
  return previewContexts[format || 'story'] || null;
}

function selectLegacyContextAlias(format) {
  const context = getPreviewContext(format);
  currentFormat = format;
  currentTemplate = context?.template || null;
  currentPage = context?.page || DEFAULT_PAGE;
  currentTheme = context?.theme || null;
  currentManifestData = context?.manifestData || null;
  previewInitializedTemplate = context?.initializedTemplate || null;
  previewInitializedPage = context?.initializedPage || null;
  editorPreviewReady = context?.ready === true;
}

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
    editorSessionVersion,
    page: currentPage,
    template: formData.template,
    url: formData.newsUrl
  };
}

function isGenerationContextCurrent(context) {
  return (
    context.generationId === latestGenerationId
    && context.editorSessionVersion === editorSessionVersion
    && context.template === currentTemplate
    && context.page === currentPage
    && context.url === normalizeOptionalValue(newsUrl.value)
  );
}

function assertGenerationContextCurrent(context) {
  if (isGenerationContextCurrent(context)) return;

  const error = new Error('Geração obsoleta');
  error.code = STALE_OPERATION_CODE;
  throw error;
}

function isStaleOperationError(error) {
  return error && error.code === STALE_OPERATION_CODE;
}

function resizePreviewFrame(format = null) {
  if (!format) {
    Object.keys(previewContexts).forEach(resizePreviewFrame);
    return;
  }
  const context = getPreviewContext(format);
  const wrapper = document.querySelector(`[data-preview-viewport][data-preview-format="${format}"]`)
    || (format === 'story' ? document.querySelector('.preview-frame-wrapper') : null);
  const container = wrapper?.parentElement || (format === 'story' ? document.querySelector('.preview-container') : null);
  if (!wrapper || !context.frame) return;

  wrapper.style.width = '';
  wrapper.style.height = '';

  const availableWidth = wrapper.clientWidth;
  const availableHeight = container?.clientHeight;
  if (!availableWidth) return;

  const dimensions = context.manifestData?.manifest?.dimensions || { width: 1080, height: format === 'feed' ? 1350 : 1920 };
  const renderWidth = Number(dimensions.width) || 1080;
  const renderHeight = Number(dimensions.height) || 1920;
  context.frame.style.width = `${renderWidth}px`;
  context.frame.style.height = `${renderHeight}px`;
  wrapper.style.aspectRatio = `${renderWidth} / ${renderHeight}`;
  const widthScale = availableWidth / renderWidth;
  const heightScale = availableHeight ? availableHeight / renderHeight : widthScale;
  const scale = Math.min(widthScale, heightScale);

  wrapper.style.width = `${renderWidth * scale}px`;
  wrapper.style.height = `${renderHeight * scale}px`;
  context.frame.style.transform = `translate(-50%, -50%) scale(${scale})`;
}

document.addEventListener('DOMContentLoaded', () => {
  if (themeWrapper) {
    themeWrapper.style.display = 'none';
  }

  setupEventListeners();
  resizePreviewFrame();
});

function setupEventListeners() {
  newsUrl.addEventListener('input', () => {
    clearResolvedImageFieldState({ clearMatchingField: true });
  });

  if (customTitle) {
    customTitle.addEventListener('input', () => {
      if (!window.EditorController) requestBestEffortPreviewUpdate();
    });
  }

  if (customSubtitle) {
    customSubtitle.addEventListener('input', () => {
      if (!window.EditorController) requestBestEffortPreviewUpdate();
    });
  }

  if (customTag) {
    customTag.addEventListener('input', () => {
      if (!window.EditorController) requestBestEffortPreviewUpdate();
    });
  }

  if (customImageUrl) {
    customImageUrl.addEventListener('input', () => {
      clearResolvedImageFieldState();
      if (!window.EditorController) requestBestEffortPreviewUpdate();
    });
  }

  if (customTheme) {
    customTheme.addEventListener('change', (event) => {
      currentTheme = event.target.value || null;
      requestBestEffortPreviewUpdate();
    });
  }

  window.addEventListener('resize', resizePreviewFrame);
}

async function loadManifest(template, page = 'index') {
    return window.Api.loadManifest(template, page);
  }

function hasUsefulNewsData(data) {
  if (!data || typeof data !== 'object') return false;

  return ['h1', 'h2', 'chapeu', 'bg']
    .some(field => normalizeOptionalValue(data[field]));
}

  async function getOrExtractNewsData(url, assertCurrent = null) {
  if (assertCurrent) assertCurrent();

  if (lastNewsUrl === url && lastNewsData) {
    return lastNewsData;
  }

  clearResolvedImageFieldState({ clearMatchingField: true });
  const data = (await window.Api.extractNewsData(url)) || {};
  if (assertCurrent) assertCurrent();
  if (hasUsefulNewsData(data)) {
    lastNewsUrl = url;
    lastNewsData = data;
  }
  return data;
}

// Monta o HTML/CSS do template dentro do iframe de preview reaproveitando o manifest.
async function ensurePreviewInitialized({
  template = currentTemplate,
  page = currentPage,
  activeFormat = currentFormat,
  manifestData: providedManifestData = null,
  assertCurrent = null
} = {}) {
  const context = getPreviewContext(activeFormat);
  const frame = context.frame;
  if (!frame || !template) {
    return null;
  }

  if (
    context.initializedTemplate === template
    && context.initializedPage === page
    && context.manifestData
  ) {
    if (assertCurrent) assertCurrent();
    return context.manifestData;
  }

  const manifestData = providedManifestData || await loadManifest(template, page);
  if (assertCurrent) assertCurrent();

  const frameWindow = frame.contentWindow;
  const frameDoc = frame.contentDocument || frameWindow?.document;
  if (!frameWindow || !frameDoc) {
    throw new Error('Falha ao inicializar o runtime do preview');
  }
  const initializationVersion = ++context.initializationVersion;

  const cssContent = Array.isArray(manifestData.css)
    ? manifestData.css.map(file => file.content || '').join('\n')
    : '';

  const manifestJson = JSON.stringify(manifestData.manifest || {})
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  const runtimeBootstrap = `
    (function () {
      var pendingUpdates = [];
      var resolveReady = window.__resolvePreviewRuntimeReady;
      var rejectReady = window.__rejectPreviewRuntimeReady;

      window.__updatePreview = function (data) {
        pendingUpdates.push(data);
      };

      function rejectRuntime() {
        rejectReady(new Error('Falha ao inicializar o runtime do preview'));
      }

      function initializeRuntime() {
        try {
          var runtime = window.PreviewRuntime;
          if (
            !runtime
            || typeof runtime.initialize !== 'function'
            || typeof runtime.update !== 'function'
            || typeof runtime.applyScale !== 'function'
            || typeof runtime.handleResize !== 'function'
          ) {
            rejectRuntime();
            return;
          }

          runtime.initialize(${manifestJson});
          pendingUpdates.forEach(function (data) {
            runtime.update(data);
          });
          pendingUpdates = [];
          resolveReady();
        } catch (error) {
          rejectRuntime();
        }
      }

      var runtimeScript = document.createElement('script');
      runtimeScript.src = '/js/preview-runtime.js';
      runtimeScript.addEventListener('load', initializeRuntime, { once: true });
      runtimeScript.addEventListener('error', rejectRuntime, { once: true });
      document.head.appendChild(runtimeScript);
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
      <script>${runtimeBootstrap}<\/script>
    </body>
  </html>`;

  let resolveRuntimeReady;
  let rejectRuntimeReady;
  const runtimeReady = new Promise((resolve, reject) => {
    resolveRuntimeReady = resolve;
    rejectRuntimeReady = reject;
  });

  frameDoc.open();
  frameWindow.__previewRuntimeReady = runtimeReady;
  frameWindow.__resolvePreviewRuntimeReady = resolveRuntimeReady;
  frameWindow.__rejectPreviewRuntimeReady = rejectRuntimeReady;
  frameDoc.write(iframeHtml);
  frameDoc.close();

  try {
    await runtimeReady;
    if (assertCurrent) assertCurrent();
    if (initializationVersion !== context.initializationVersion) {
      return null;
    }

    context.manifestData = manifestData;
    context.initializedTemplate = template;
    context.initializedPage = page;
    resizePreviewFrame(activeFormat);
    if (context === previewContexts.story) {
      currentManifestData = manifestData;
      previewInitializedTemplate = template;
      previewInitializedPage = page;
    }

    if (context.placeholder) {
      context.placeholder.style.display = 'none';
    }

    return manifestData;
  } catch (error) {
    if (initializationVersion === context.initializationVersion) {
      context.manifestData = null;
      context.initializedTemplate = null;
      context.initializedPage = null;
    }
    throw new Error('Falha ao inicializar o runtime do preview');
  } finally {
    if (frameWindow.__resolvePreviewRuntimeReady === resolveRuntimeReady) {
      delete frameWindow.__resolvePreviewRuntimeReady;
      delete frameWindow.__rejectPreviewRuntimeReady;
    }
  }
}

function buildPreviewData(
  manifestData,
  backgroundOverride = null,
  formData = readGenerationFormData(),
  extractedDataOverride = null,
  contentOverride = null,
  imageAdjustments = currentImageAdjustments,
  activeFormat = currentFormat,
  themeOverride = currentTheme
) {
  if (contentOverride) {
    const contentImage = normalizeOptionalValue(contentOverride.image);
    const hasMatchingResolvedImage = (
      resolvedImageFieldState.source === 'extracted'
      && resolvedImageFieldState.value === contentImage
      && resolvedImageFieldState.newsUrl === normalizeOptionalValue(contentOverride.url)
    );
    formData = {
      newsUrl: normalizeOptionalValue(contentOverride.url),
      manualTitle: normalizeOptionalValue(contentOverride.title),
      manualSubtitle: normalizeOptionalValue(contentOverride.subtitle),
      manualCategory: normalizeOptionalValue(contentOverride.tag),
      manualImage: hasMatchingResolvedImage ? '' : contentImage,
      resolvedImage: hasMatchingResolvedImage ? contentImage : '',
      theme: themeOverride,
      template: currentTemplate
    };
    extractedDataOverride = hasMatchingResolvedImage ? { bg: contentImage } : {};
  }
  const url = formData.newsUrl;
  const hasMatchingNews = lastNewsUrl && lastNewsUrl === url && lastNewsData;
  const extractedData = extractedDataOverride || (hasMatchingNews ? lastNewsData : {});

  return {
    ...createArtworkData({
    formData,
    extractedData,
    manifest: manifestData.manifest,
    resolvedLogo: manifestData.resolvedLogo,
    theme: formData.theme,
    backgroundOverride
    }),
    imageAdjustments: { ...imageAdjustments },
    ...(activeFormat ? { activeFormat } : {})
  };
}

function applyArtworkDataToPreview(artworkData, activeFormat = currentFormat) {
  const frame = getPreviewContext(activeFormat).frame;
  const frameWindow = frame && frame.contentWindow;
  if (!frameWindow || typeof frameWindow.__updatePreview !== 'function') {
    throw new Error('O runtime do preview não está disponível');
  }

  frameWindow.__updatePreview(artworkData);
}

function isBestEffortPreviewContextCurrent(context) {
  return (
    context.updateId === latestBestEffortPreviewUpdateId
    && context.editorSessionVersion === editorSessionVersion
    && context.template === currentTemplate
    && context.page === currentPage
  );
}

function assertBestEffortPreviewContextCurrent(context) {
  if (isBestEffortPreviewContextCurrent(context)) return;

  const error = new Error('Atualização auxiliar do preview obsoleta');
  error.code = STALE_OPERATION_CODE;
  throw error;
}

function handleBestEffortPreviewUpdateError(error, context) {
  if (!isBestEffortPreviewContextCurrent(context)) return;
  if (isStaleOperationError(error)) return;
  console.error('Erro ao atualizar preview:', error);
}

function requestBestEffortPreviewUpdate() {
  const context = {
    updateId: ++latestBestEffortPreviewUpdateId,
    editorSessionVersion,
    template: currentTemplate,
    page: currentPage
  };
  const assertCurrent = () => assertBestEffortPreviewContextCurrent(context);
  updatePreview(null, assertCurrent)
    .catch(error => handleBestEffortPreviewUpdateError(error, context));
}

async function updatePreview(
  backgroundOverride = null,
  assertCurrent = null,
  contentOverride = null,
  imageAdjustments = currentImageAdjustments,
  activeFormat = currentFormat
) {
  const context = getPreviewContext(activeFormat);
  if (!context) throw new Error('Formato de preview indisponÃ­vel');
  if (!context.frame) throw new Error('Iframe do formato nÃ£o estÃ¡ disponÃ­vel');
  if (!context.template) {
    return;
  }

  try {
    const manifestData = await ensurePreviewInitialized({
      template: context.template, page: context.page, activeFormat, assertCurrent
    });
    if (!manifestData) return;
    if (assertCurrent) assertCurrent();

    const artworkData = buildPreviewData(
      manifestData, backgroundOverride, undefined, null, contentOverride, imageAdjustments, activeFormat, context.theme
    );
    if (assertCurrent) assertCurrent();
    applyArtworkDataToPreview(artworkData, activeFormat);
  } catch (error) {
    if (isStaleOperationError(error)) return;
    if (assertCurrent) assertCurrent();
    throw error;
  }
}

// Sincroniza somente o estado técnico necessário ao renderer. A escolha editorial
// de brand/family/variant/theme já ocorreu na publication antes desta fronteira.
function selectRendererState(renderer, theme, activeFormat = null) {
  const format = activeFormat || 'story';
  const context = getPreviewContext(format);
  if (!context) throw new Error(`Formato de preview indisponÃ­vel: ${String(format)}`);
  editorSessionVersion += 1;
  context.template = renderer.template;
  context.page = renderer.page || DEFAULT_PAGE;
  context.theme = theme || null;
  context.manifestData = null;
  context.initializedTemplate = null;
  context.initializedPage = null;
  context.ready = false;
  context.initializationVersion += 1;
  selectLegacyContextAlias(format);
  if (context === previewContexts.story) {
    currentManifestData = null;
    previewInitializedTemplate = null;
    previewInitializedPage = null;
    previewInitializationVersion += 1;
  }

  if (customTheme) {
    customTheme.innerHTML = (renderer.themes || [])
      .map(item => `<option value="${item.id}">${item.label}</option>`)
      .join('');
    customTheme.value = currentTheme || '';
  }
}

// Ponte temporária e única entre a seleção editorial e o estado do script legado.
// O catálogo e a publication permanecem sob responsabilidade do novo controller.
window.LegacyEditorBridge = {
  isFormatExportable(format, renderer = null) {
    const context = getReadyExportContext(format);
    return Boolean(context
      && (!renderer || (
        context.template === renderer.template
        && context.page === (renderer.page || DEFAULT_PAGE)
      )));
  },

  captureExportAuthority,

  isExportAuthorityCurrent,

  setExportPending(pending) {
    if (pending) showLoading();
    else hideLoading();
  },

  reportExportError(error) {
    showToast('Erro ao gerar arte: ' + error.message, 'error');
  },

  async downloadExport(authority, filename, assertCurrent) {
    if (!isExportAuthorityCurrent(authority) || (assertCurrent && !assertCurrent())) return false;
    return window.PreviewExport.downloadPreview(
      authority.frame,
      authority.manifestData,
      filename,
      { assertCurrent: () => isExportAuthorityCurrent(authority) && (!assertCurrent || assertCurrent()) },
    );
  },

  importNews({ url, assertCurrent }) {
    return getOrExtractNewsData(url, assertCurrent);
  },

  async applyPublicationContent({
    content,
    theme = currentTheme,
    activeFormat = currentFormat,
    imageAdjustments = currentImageAdjustments,
    importedImage = null,
    assertCurrent = null
  }) {
    if (assertCurrent) assertCurrent();
    const context = getPreviewContext(activeFormat);
    context.theme = theme || null;
    selectLegacyContextAlias(activeFormat || 'story');
    if (customTheme) customTheme.value = currentTheme || '';
    if (importedImage) {
      setExtractedImageFieldValue(importedImage.value, importedImage.url);
    }
    await updatePreview(null, assertCurrent, content, imageAdjustments, activeFormat);
    if (assertCurrent) assertCurrent();
    context.imageAdjustments = { ...imageAdjustments };
    currentImageAdjustments = { ...imageAdjustments };
  },

  reconcilePublicationContent({ content, changedField }) {
    const nextContent = { ...content };
    if (
      changedField === 'url'
      && resolvedImageFieldState.source === 'extracted'
      && resolvedImageFieldState.newsUrl !== normalizeOptionalValue(content.url)
      && resolvedImageFieldState.value === content.image
    ) {
      nextContent.image = '';
      clearResolvedImageFieldState();
    } else if (
      changedField === 'image'
      && resolvedImageFieldState.value !== content.image
    ) {
      clearResolvedImageFieldState();
    }
    return nextContent;
  },

  setNewsImportPending(pending) {
    setGenerateDisabled('news-import', pending);
  },

  setContentSyncPending(pending, activeFormat = currentFormat) {
    const format = activeFormat || 'story';
    if (!getPreviewContext(format)) return;
    contentSyncPending[format] = pending;
    if (format === currentFormat || (!currentFormat && format === 'story')) {
      setGenerateDisabled('content-sync', pending);
    }
  },

  setActiveFormat(activeFormat) {
    const format = activeFormat || 'story';
    selectLegacyContextAlias(format);
    setGenerateDisabled('content-sync', contentSyncPending[format]);
    setGenerateDisabled('editor-preview', !getPreviewContext(format)?.ready);
  },

  async selectRenderer({
    renderer,
    activeFormat = null,
    theme,
    content = null,
    imageAdjustments = currentImageAdjustments,
    assertCurrent
  }) {
    if (assertCurrent) assertCurrent();
    selectRendererState(renderer, theme, activeFormat);
    await updatePreview(null, assertCurrent, content, imageAdjustments, activeFormat);
    if (assertCurrent) assertCurrent();
    getPreviewContext(activeFormat).imageAdjustments = { ...imageAdjustments };
    currentImageAdjustments = { ...imageAdjustments };
  },

  setEditorPreviewReady(format, ready) {
    // Compatibilidade temporaria com chamadas legadas que enviavam apenas boolean.
    if (typeof format === 'boolean') {
      ready = format;
      format = currentFormat || 'story';
    }
    const context = getPreviewContext(format);
    if (!context) return;
    context.ready = ready === true;
    if (format === currentFormat || (!currentFormat && format === 'story')) {
      editorPreviewReady = context.ready;
      setGenerateDisabled('editor-preview', !context.ready);
    }
  },

  resizePreview: resizePreviewFrame,

  clearPreview(activeFormat = currentFormat) {
    const context = getPreviewContext(activeFormat);
    editorSessionVersion += 1;
    context.template = null;
    context.page = DEFAULT_PAGE;
    context.manifestData = null;
    context.initializedTemplate = null;
    context.initializedPage = null;
    context.ready = false;
    context.initializationVersion += 1;
    const frameDoc = context.frame?.contentDocument;
    if (frameDoc) {
      frameDoc.open();
      frameDoc.write('<!doctype html><html><body></body></html>');
      frameDoc.close();
    }
    if (context.placeholder) context.placeholder.style.display = '';
  }
};

function getReadyExportContext(format) {
  const context = getPreviewContext(format);
  if (
    !context
    || context.ready !== true
    || contentSyncPending[format]
    || !context.frame
    || !context.template
    || !context.page
    || !context.manifestData
    || !context.manifestData.manifest
    || context.manifestData.template !== context.template
    || (context.manifestData.page || DEFAULT_PAGE) !== context.page
    || context.initializedTemplate !== context.template
    || context.initializedPage !== context.page
  ) {
    return null;
  }
  return context;
}

function captureExportAuthority(format) {
  const context = getReadyExportContext(format);
  if (!context) return null;
  return {
    format,
    context,
    frame: context.frame,
    manifestData: context.manifestData,
    template: context.template,
    page: context.page,
    initializedTemplate: context.initializedTemplate,
    initializedPage: context.initializedPage,
    initializationVersion: context.initializationVersion
  };
}

function isExportAuthorityCurrent(authority) {
  if (!authority) return false;
  const context = getReadyExportContext(authority.format);
  return Boolean(
    context
    && context === authority.context
    && context.frame === authority.frame
    && context.manifestData === authority.manifestData
    && context.template === authority.template
    && context.page === authority.page
    && context.initializedTemplate === authority.initializedTemplate
    && context.initializedPage === authority.initializedPage
    && context.initializationVersion === authority.initializationVersion
  );
}

// Etapa 3: gera o PNG final reaproveitando o que foi visto no preview.
async function generateArtWithPreviewFlow() {
  const exportFormat = currentFormat || 'story';
  const formData = readGenerationFormData();

  const inputValidation = validateGenerationInput(formData);
  if (!applyGenerationValidation(inputValidation)) {
    return;
  }

  const exportAuthority = captureExportAuthority(exportFormat);
  if (!exportAuthority) {
    showToast('Aguarde o preview ficar pronto para baixar', 'info');
    return;
  }

  const generationContext = createGenerationContext(formData);
  const assertCurrent = () => assertGenerationContextCurrent(generationContext);

  try {
    showLoading();

    const manifestData = exportAuthority.manifestData;
    assertCurrent();
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
    if (!isExportAuthorityCurrent(exportAuthority)) return;
    applyArtworkDataToPreview(exportArtworkData, exportFormat);
    if (!isExportAuthorityCurrent(exportAuthority)) return;
    await window.PreviewExport.downloadPreview(
      exportAuthority.frame,
      manifestData,
      buildExportFilename(generationContext.template, pageName),
    );
    assertCurrent();

    showToast('Arte gerada e download iniciado!', 'success');
  } catch (error) {
    if (
      isStaleOperationError(error)
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
  setGenerateDisabled('export', true);
}

function hideLoading() {
  loadingOverlay.classList.remove('show');
  setGenerateDisabled('export', false);
}

function setGenerateDisabled(reason, disabled) {
  if (disabled) {
    generateDisableReasons.add(reason);
  } else {
    generateDisableReasons.delete(reason);
  }
  generateBtn.disabled = generateDisableReasons.size > 0;
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
