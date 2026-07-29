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
    normalizeOptionalValue
  };
});
