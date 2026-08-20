class TemplateManifestSchemaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TemplateManifestSchemaError';
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TemplateManifestSchemaError(`${field} deve ser uma string não vazia`);
  }
}

function validateDimensions(dimensions, field) {
  if (!isObject(dimensions)) {
    throw new TemplateManifestSchemaError(`${field} deve ser um objeto`);
  }
  for (const dimension of ['width', 'height']) {
    if (!Number.isInteger(dimensions[dimension]) || dimensions[dimension] <= 0) {
      throw new TemplateManifestSchemaError(
        `${field}.${dimension} deve ser um número inteiro positivo`
      );
    }
  }
}

function validateThemes(themes) {
  if (themes === undefined) return;
  if (!Array.isArray(themes)) {
    throw new TemplateManifestSchemaError('themes deve ser um array');
  }
  const ids = new Set();
  for (const [index, theme] of themes.entries()) {
    if (!isObject(theme)) {
      throw new TemplateManifestSchemaError(`themes[${index}] deve ser um objeto`);
    }
    requireNonEmptyString(theme.id, `themes[${index}].id`);
    requireNonEmptyString(theme.label, `themes[${index}].label`);
    if (ids.has(theme.id)) {
      throw new TemplateManifestSchemaError(`theme id duplicado: ${theme.id}`);
    }
    ids.add(theme.id);
  }
}

function validateCapabilities(capabilities, field) {
  if (capabilities === undefined) return;
  if (!isObject(capabilities)) {
    throw new TemplateManifestSchemaError(`${field} deve ser um objeto`);
  }
  const knownCapabilities = new Set(['imageAdjustments']);
  for (const capability of Object.keys(capabilities)) {
    if (!knownCapabilities.has(capability)) {
      throw new TemplateManifestSchemaError(`${field}.${capability} nÃ£o Ã© suportada`);
    }
  }
  if (capabilities.imageAdjustments === undefined) return;
  if (!isObject(capabilities.imageAdjustments)) {
    throw new TemplateManifestSchemaError(`${field}.imageAdjustments deve ser um objeto`);
  }
  const knownAdjustments = new Set(['zoom', 'position']);
  for (const [adjustment, enabled] of Object.entries(capabilities.imageAdjustments)) {
    if (!knownAdjustments.has(adjustment)) {
      throw new TemplateManifestSchemaError(`${field}.imageAdjustments.${adjustment} nÃ£o Ã© suportado`);
    }
    if (typeof enabled !== 'boolean') {
      throw new TemplateManifestSchemaError(`${field}.imageAdjustments.${adjustment} deve ser booleano`);
    }
  }
}

function normalizeCapabilities(capabilities) {
  if (!capabilities) return undefined;
  return {
    ...(capabilities.imageAdjustments
      ? { imageAdjustments: { ...capabilities.imageAdjustments } }
      : {}),
  };
}

function validateBrandAssets(brandAssets) {
  if (brandAssets === undefined) return;
  if (!isObject(brandAssets)) {
    throw new TemplateManifestSchemaError('brandAssets deve ser um objeto');
  }
  requireNonEmptyString(brandAssets.logo, 'brandAssets.logo');
  if (!Array.isArray(brandAssets.fonts)) {
    throw new TemplateManifestSchemaError('brandAssets.fonts deve ser um array');
  }
  for (const [index, font] of brandAssets.fonts.entries()) {
    if (!isObject(font)) {
      throw new TemplateManifestSchemaError(`brandAssets.fonts[${index}] deve ser um objeto`);
    }
    requireNonEmptyString(font.alias, `brandAssets.fonts[${index}].alias`);
    requireNonEmptyString(font.family, `brandAssets.fonts[${index}].family`);
    requireNonEmptyString(font.style, `brandAssets.fonts[${index}].style`);
    if (!Number.isInteger(font.weight) || font.weight < 1 || font.weight > 1000) {
      throw new TemplateManifestSchemaError(
        `brandAssets.fonts[${index}].weight deve ser um inteiro entre 1 e 1000`
      );
    }
  }
}

function validateManifest(manifest) {
  if (!isObject(manifest)) {
    throw new TemplateManifestSchemaError('manifest deve ser um objeto');
  }
  if (manifest.editor === undefined) return manifest;
  if (!isObject(manifest.editor)) {
    throw new TemplateManifestSchemaError('editor deve ser um objeto');
  }
  for (const field of ['brand', 'family', 'variant', 'label']) {
    requireNonEmptyString(manifest.editor[field], `editor.${field}`);
  }
  if (!isObject(manifest.formats) || Object.keys(manifest.formats).length === 0) {
    throw new TemplateManifestSchemaError('formats deve ser um objeto não vazio');
  }
  for (const [formatId, format] of Object.entries(manifest.formats)) {
    requireNonEmptyString(formatId, 'format id');
    if (!isObject(format)) {
      throw new TemplateManifestSchemaError(`formats.${formatId} deve ser um objeto`);
    }
    validateDimensions(format.dimensions, `formats.${formatId}.dimensions`);
    validateCapabilities(format.capabilities, `formats.${formatId}.capabilities`);
  }
  validateThemes(manifest.themes);
  validateBrandAssets(manifest.brandAssets);
  return manifest;
}

function normalizeManifest(manifest) {
  validateManifest(manifest);
  if (manifest.editor === undefined) {
    return { ...manifest, editorial: null };
  }
  const formats = Object.fromEntries(
    Object.entries(manifest.formats).map(([id, format]) => [
      id,
      {
        ...format,
        dimensions: { ...format.dimensions },
        ...(format.capabilities
          ? { capabilities: normalizeCapabilities(format.capabilities) }
          : {}),
      },
    ])
  );
  const formatIds = Object.keys(formats);
  const normalized = {
    ...manifest,
    editorial: { ...manifest.editor },
    formats,
    themes: manifest.themes ? manifest.themes.map((theme) => ({ ...theme })) : [],
  };
  if (formatIds.length === 1) {
    normalized.dimensions = { ...formats[formatIds[0]].dimensions };
  } else {
    delete normalized.dimensions;
  }
  return normalized;
}

function getEditorialMetadata(manifest) {
  const normalized = normalizeManifest(manifest);
  if (normalized.editorial === null) return null;
  return {
    editorial: normalized.editorial,
    formats: normalized.formats || {},
    themes: normalized.themes || [],
  };
}

module.exports = {
  TemplateManifestSchemaError,
  getEditorialMetadata,
  normalizeManifest,
  validateManifest,
};
