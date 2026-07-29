(function exposeFrontendUtils(global, factory) {
  const utils = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = utils;
  } else if (global) {
    global.FrontendUtils = utils;
  }
})(typeof window !== 'undefined' ? window : globalThis, function createFrontendUtils() {
  function normalizeOptionalValue(value) {
    if (value === undefined || value === null) return '';
    return String(value).trim();
  }

  function isHttpUrl(value) {
    const normalizedValue = normalizeOptionalValue(value);
    if (!normalizedValue) return false;

    try {
      const url = new URL(normalizedValue);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
      return false;
    }
  }

  function isValidRemoteImageUrl(value) {
    return isHttpUrl(value);
  }

  function isValidResolvedImageValue(value) {
    const normalizedValue = normalizeOptionalValue(value);
    if (isValidRemoteImageUrl(normalizedValue)) return true;

    return /^data:image\/(?:png|jpeg|gif|webp);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      normalizedValue
    ) && !normalizedValue.endsWith(',');
  }

  function validateGenerationInput(input = {}) {
    const {
      template,
      newsUrl,
      manualImage,
      requireResolvedContent = false,
      resolvedCategory,
      effectiveImage
    } = input;

    if (!template) {
      return {
        valid: false,
        code: 'TEMPLATE_REQUIRED',
        message: 'Escolha um template antes de gerar a arte',
        focusField: null
      };
    }

    if (!newsUrl) {
      return {
        valid: false,
        code: 'NEWS_URL_REQUIRED',
        message: 'Por favor, insira o link da notícia',
        focusField: 'newsUrl'
      };
    }

    if (!isHttpUrl(newsUrl)) {
      return {
        valid: false,
        code: 'NEWS_URL_INVALID',
        message: 'Por favor, insira um link válido',
        focusField: 'newsUrl'
      };
    }

    if (manualImage && !isValidRemoteImageUrl(manualImage)) {
      return {
        valid: false,
        code: 'MANUAL_IMAGE_URL_INVALID',
        message: 'Informe um link de imagem válido (http ou https).',
        focusField: 'customImageUrl'
      };
    }

    if (requireResolvedContent && !resolvedCategory) {
      return {
        valid: false,
        code: 'CATEGORY_REQUIRED',
        message: 'Por favor, insira a categoria da notícia',
        focusField: 'customTag'
      };
    }

    if (requireResolvedContent && !isValidResolvedImageValue(effectiveImage)) {
      return {
        valid: false,
        code: 'IMAGE_REQUIRED',
        message: 'Não encontramos uma imagem válida. Informe um link de imagem ou tente novamente.',
        focusField: 'customImageUrl'
      };
    }

    return {
      valid: true,
      code: null,
      message: null,
      focusField: null
    };
  }

  function getToastIcon(type) {
    if (type === 'success') return 'check-circle';
    if (type === 'error') return 'exclamation-circle';
    return 'info-circle';
  }

  function normalizeFilenamePart(value, fallback) {
    const normalizedValue = normalizeOptionalValue(value)
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
      .replace(/^[.\s]+|[.\s]+$/g, '');

    return normalizedValue || fallback;
  }

  function buildExportFilename(template, page = 'index') {
    const templateName = normalizeFilenamePart(template, 'arte');
    const pageName = normalizeFilenamePart(page, 'index');
    return `${templateName}-${pageName}.png`;
  }

  return {
    buildExportFilename,
    getToastIcon,
    isHttpUrl,
    isValidRemoteImageUrl,
    isValidResolvedImageValue,
    normalizeOptionalValue,
    validateGenerationInput
  };
});
