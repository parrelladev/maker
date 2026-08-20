const { loadBrand } = require('./brandRegistry');
const { inspectTemplateCatalog } = require('./manifestLoader');
const { getEditorialMetadata } = require('./templateManifest');

const rendererIndexes = new WeakMap();

class EditorCatalogError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'EditorCatalogError';
    this.code = code;
    this.details = details;
  }
}

function compareIds(left, right) {
  return left.id.localeCompare(right.id, 'pt-BR');
}

function selectionKey({ brand, family, variant, format }) {
  return JSON.stringify([brand, family, variant, format]);
}

function rendererRef(template, page) {
  return { template, page };
}

function compareRendererRefs(left, right) {
  return `${left.template}/${left.page}`.localeCompare(`${right.template}/${right.page}`);
}

function sameRendererRef(left, right) {
  return left.template === right.template && left.page === right.page;
}

function conflict(code, message, selection, references, extra = {}) {
  throw new EditorCatalogError(code, message, {
    ...selection,
    ...extra,
    references: [...references].sort(compareRendererRefs),
  });
}

async function buildEditorCatalog({
  inspectTemplateCatalogFn = inspectTemplateCatalog,
  loadBrandFn = loadBrand,
  getEditorialMetadataFn = getEditorialMetadata,
} = {}) {
  const { templates } = await inspectTemplateCatalogFn();
  const brands = new Map();
  const brandDetails = new Map();
  const rendererIndex = new Map();

  for (const templateEntry of templates) {
    for (const pageEntry of templateEntry.pages) {
      const metadata = getEditorialMetadataFn(pageEntry.manifest);
      if (metadata === null) continue;

      const { brand, family, variant, label } = metadata.editorial;
      const reference = rendererRef(templateEntry.template, pageEntry.name);
      let brandDetail = brandDetails.get(brand);
      if (!brandDetail) {
        try {
          brandDetail = await loadBrandFn(brand);
        } catch (error) {
          throw new EditorCatalogError(
            'EDITOR_CATALOG_UNKNOWN_BRAND',
            `Manifest editorial referencia marca desconhecida: ${brand}`,
            { brand, reference, causeCode: error?.code }
          );
        }
        brandDetails.set(brand, brandDetail);
        brands.set(brand, { id: brand, name: brandDetail.name, families: new Map() });
      }

      const brandNode = brands.get(brand);
      let familyNode = brandNode.families.get(family);
      if (!familyNode) {
        familyNode = { id: family, label: family, variants: new Map() };
        brandNode.families.set(family, familyNode);
      }

      let variantNode = familyNode.variants.get(variant);
      if (!variantNode) {
        variantNode = { id: variant, label, formats: new Map(), reference };
        familyNode.variants.set(variant, variantNode);
      } else if (variantNode.label !== label) {
        conflict(
          'EDITOR_CATALOG_VARIANT_LABEL_CONFLICT',
          `Labels conflitantes para ${brand}/${family}/${variant}`,
          { brand, family, variant },
          [variantNode.reference, reference],
          { labels: [variantNode.label, label].sort() }
        );
      }

      for (const [format, formatMetadata] of Object.entries(metadata.formats)) {
        const selection = { brand, family, variant, format };
        const key = selectionKey(selection);
        const existing = rendererIndex.get(key);
        if (existing && !sameRendererRef(existing, reference)) {
          conflict(
            'EDITOR_CATALOG_RENDERER_CONFLICT',
            `Renderers conflitantes para ${brand}/${family}/${variant}/${format}`,
            selection,
            [existing, reference]
          );
        }
        if (!existing) {
          rendererIndex.set(key, reference);
          variantNode.formats.set(format, {
            id: format,
            dimensions: { ...formatMetadata.dimensions },
            themes: metadata.themes.map(theme => ({ ...theme })).sort(compareIds),
          });
        }
      }
    }
  }

  const catalog = {
    brands: [...brands.values()].sort(compareIds).map(brand => ({
      id: brand.id,
      name: brand.name,
      families: [...brand.families.values()].sort(compareIds).map(family => ({
        id: family.id,
        label: family.label,
        variants: [...family.variants.values()].sort(compareIds).map(variant => ({
          id: variant.id,
          label: variant.label,
          formats: [...variant.formats.values()].sort(compareIds),
        })),
      })),
    })),
  };
  rendererIndexes.set(catalog, rendererIndex);
  return catalog;
}

function resolveRenderer(catalog, selection) {
  const rendererIndex = rendererIndexes.get(catalog);
  if (!rendererIndex) {
    throw new EditorCatalogError(
      'EDITOR_CATALOG_INVALID',
      'Catálogo editorial inválido ou não construído por buildEditorCatalog'
    );
  }
  const reference = rendererIndex.get(selectionKey(selection));
  if (!reference) {
    throw new EditorCatalogError(
      'EDITOR_CATALOG_RENDERER_NOT_FOUND',
      `Renderer editorial não encontrado: ${selection.brand}/${selection.family}/${selection.variant}/${selection.format}`,
      { ...selection }
    );
  }
  return { ...reference };
}

module.exports = {
  EditorCatalogError,
  buildEditorCatalog,
  resolveRenderer,
};
