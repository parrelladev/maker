(function exposeEditorCatalog(global, factory) {
  const helpers = factory();
  if (typeof module === 'object' && module.exports) module.exports = helpers;
  else global.EditorCatalog = helpers;
})(typeof window !== 'undefined' ? window : globalThis, function createCatalogHelpers() {
  function findBrand(catalog, id) {
    return catalog?.brands?.find(brand => brand.id === id) || null;
  }

  function findFamily(brand, id) {
    return brand?.families?.find(family => family.id === id) || null;
  }

  function getVariants(family, format) {
    return (family?.variants || []).filter(variant => (
      variant.formats?.some(candidate => candidate.id === format)
    ));
  }

  function getFormat(variant, format) {
    return variant?.formats?.find(candidate => candidate.id === format) || null;
  }

  function chooseDefault(catalog, format) {
    for (const brand of catalog?.brands || []) {
      for (const family of brand.families || []) {
        const variant = getVariants(family, format)[0];
        const formatNode = getFormat(variant, format);
        if (variant && formatNode) {
          return { brand, family, variant, theme: formatNode.themes?.[0] || null };
        }
      }
    }
    return null;
  }

  function chooseForBrand(catalog, brandId, format) {
    const brand = findBrand(catalog, brandId);
    if (!brand) return null;
    for (const family of brand.families || []) {
      const variant = getVariants(family, format)[0];
      if (variant) return { brand, family, variant, theme: getFormat(variant, format)?.themes?.[0] || null };
    }
    return null;
  }

  function chooseForFamily(catalog, brandId, familyId, format) {
    const brand = findBrand(catalog, brandId);
    const family = findFamily(brand, familyId);
    const variant = getVariants(family, format)[0];
    return variant ? { brand, family, variant, theme: getFormat(variant, format)?.themes?.[0] || null } : null;
  }

  return { chooseDefault, chooseForBrand, chooseForFamily, findBrand, findFamily, getFormat, getVariants };
});
