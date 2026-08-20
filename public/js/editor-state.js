(function exposeEditorState(global, factory) {
  const editorState = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = editorState;
  } else if (global) {
    global.EditorState = editorState;
  }
})(typeof window !== 'undefined' ? window : globalThis, function createEditorState() {
  const CONTENT_FIELDS = new Set(['url', 'title', 'subtitle', 'tag', 'image']);
  const IMAGE_ADJUSTMENTS = new Set(['zoom', 'x', 'y']);
  const DEFAULT_IMAGE_ADJUSTMENTS = Object.freeze({
    zoom: 1,
    x: 50,
    y: 50
  });
  const IMAGE_ADJUSTMENT_LIMITS = Object.freeze({
    zoom: Object.freeze({ min: 1, max: 3 }),
    x: Object.freeze({ min: 0, max: 100 }),
    y: Object.freeze({ min: 0, max: 100 })
  });

  function createFormatState() {
    return {
      variant: null,
      theme: null,
      imageAdjustments: { ...DEFAULT_IMAGE_ADJUSTMENTS }
    };
  }

  function createPublication() {
    return {
      brand: null,
      family: null,
      content: {
        url: '',
        title: '',
        subtitle: '',
        tag: '',
        image: ''
      },
      formats: {
        feed: createFormatState(),
        story: createFormatState()
      }
    };
  }

  function requireFormat(publication, format) {
    if (!publication || !publication.formats || !Object.prototype.hasOwnProperty.call(publication.formats, format)) {
      throw new Error(`Unknown publication format: ${String(format)}`);
    }

    return publication.formats[format];
  }

  function requireAllowedKey(keys, key, description) {
    if (!keys.has(key)) {
      throw new Error(`Unknown ${description}: ${String(key)}`);
    }
  }

  function updateFormat(publication, format, update) {
    const currentFormat = requireFormat(publication, format);

    return {
      ...publication,
      formats: {
        ...publication.formats,
        [format]: update(currentFormat)
      }
    };
  }

  function setBrand(publication, brand) {
    return { ...publication, brand };
  }

  function setFamily(publication, family) {
    return { ...publication, family };
  }

  function setContentField(publication, field, value) {
    requireAllowedKey(CONTENT_FIELDS, field, 'content field');

    return {
      ...publication,
      content: {
        ...publication.content,
        [field]: value
      }
    };
  }

  function applyContentPatch(publication, patch) {
    Object.keys(patch).forEach(field => {
      requireAllowedKey(CONTENT_FIELDS, field, 'content field');
    });

    return {
      ...publication,
      content: {
        ...publication.content,
        ...patch
      }
    };
  }

  function setFormatVariant(publication, format, variant) {
    return updateFormat(publication, format, currentFormat => ({
      ...currentFormat,
      variant
    }));
  }

  function setFormatTheme(publication, format, theme) {
    return updateFormat(publication, format, currentFormat => ({
      ...currentFormat,
      theme
    }));
  }

  function setImageAdjustment(publication, format, adjustment, value) {
    requireAllowedKey(IMAGE_ADJUSTMENTS, adjustment, 'image adjustment');
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`Invalid image adjustment value: ${String(value)}`);
    }
    const limits = IMAGE_ADJUSTMENT_LIMITS[adjustment];
    if (value < limits.min || value > limits.max) {
      throw new Error(`Image adjustment out of bounds: ${adjustment}`);
    }

    return updateFormat(publication, format, currentFormat => ({
      ...currentFormat,
      imageAdjustments: {
        ...currentFormat.imageAdjustments,
        [adjustment]: value
      }
    }));
  }

  function resetImageAdjustments(publication, format, defaults = {}) {
    Object.keys(defaults).forEach(adjustment => {
      requireAllowedKey(IMAGE_ADJUSTMENTS, adjustment, 'image adjustment');
      const limits = IMAGE_ADJUSTMENT_LIMITS[adjustment];
      const value = defaults[adjustment];
      if (typeof value !== 'number' || !Number.isFinite(value)
        || value < limits.min || value > limits.max) {
        throw new Error(`Invalid image adjustment value: ${String(value)}`);
      }
    });

    return updateFormat(publication, format, currentFormat => ({
      ...currentFormat,
      imageAdjustments: {
        ...DEFAULT_IMAGE_ADJUSTMENTS,
        ...defaults
      }
    }));
  }

  return {
    DEFAULT_IMAGE_ADJUSTMENTS,
    IMAGE_ADJUSTMENT_LIMITS,
    applyContentPatch,
    createPublication,
    resetImageAdjustments,
    setBrand,
    setContentField,
    setFamily,
    setFormatTheme,
    setFormatVariant,
    setImageAdjustment
  };
});
