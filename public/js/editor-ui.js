(function exposeEditorUi(global, factory) {
  const editorUi = factory();
  if (typeof module === 'object' && module.exports) module.exports = editorUi;
  else global.EditorUi = editorUi;
})(typeof window !== 'undefined' ? window : globalThis, function createEditorUiModule() {
  const ACTIVE_FORMAT = 'story';

  function createEditorController({ document, api, state, catalogHelpers, legacyBridge = null }) {
    let catalog = null;
    let publication = state.createPublication();
    let latestRendererRequest = 0;
    let renderer = null;
    let previewState = 'idle';

    const controls = {
      brand: document.querySelector('[data-control="brand"]'),
      family: document.querySelector('[data-control="family"]'),
      variants: document.querySelector('[data-control="variants"]'),
      themes: document.querySelector('[data-control="themes"]'),
      status: document.querySelector('[data-editor-status]'),
      downloadCurrent: document.querySelector('[data-action="download-current"]'),
    };

    function setStatus(message) {
      const target = controls.status?.querySelector('span:last-child') || controls.status;
      if (target) target.textContent = message;
    }

    function setPreviewState(nextState) {
      previewState = nextState;
      const ready = nextState === 'ready';
      if (legacyBridge?.setEditorPreviewReady) {
        legacyBridge.setEditorPreviewReady(ready);
      } else if (controls.downloadCurrent) {
        controls.downloadCurrent.disabled = !ready;
      }
    }

    function applySelection(selection) {
      publication = state.setBrand(publication, selection.brand.id);
      publication = state.setFamily(publication, selection.family.id);
      publication = state.setFormatVariant(publication, ACTIVE_FORMAT, selection.variant.id);
      publication = state.setFormatTheme(publication, ACTIVE_FORMAT, selection.theme?.id || null);
    }

    function currentNodes() {
      const brand = catalogHelpers.findBrand(catalog, publication.brand);
      const family = catalogHelpers.findFamily(brand, publication.family);
      const variant = catalogHelpers.getVariants(family, ACTIVE_FORMAT)
        .find(candidate => candidate.id === publication.formats.story.variant) || null;
      return { brand, family, variant, format: catalogHelpers.getFormat(variant, ACTIVE_FORMAT) };
    }

    function fillSelect(select, entries, value, labelKey) {
      if (!select) return;
      select.innerHTML = '';
      entries.forEach(entry => {
        const option = document.createElement('option');
        option.value = entry.id;
        option.textContent = entry[labelKey];
        option.selected = entry.id === value;
        select.appendChild(option);
      });
      select.disabled = entries.length === 0;
      select.value = value || '';
    }

    function renderButtons(container, entries, selectedId, dataKey, onSelect) {
      if (!container) return;
      container.innerHTML = '';
      entries.forEach(entry => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset[dataKey] = entry.id;
        button.textContent = entry.label;
        button.setAttribute('aria-pressed', String(entry.id === selectedId));
        if (entry.id === selectedId) button.classList.add('is-selected');
        button.addEventListener('click', () => onSelect(entry.id));
        container.appendChild(button);
      });
    }

    function render() {
      const { brand, family, variant, format } = currentNodes();
      fillSelect(controls.brand, catalog?.brands || [], publication.brand, 'name');
      fillSelect(controls.family, brand?.families || [], publication.family, 'label');
      renderButtons(
        controls.variants,
        catalogHelpers.getVariants(family, ACTIVE_FORMAT),
        publication.formats.story.variant,
        'variantId',
        selectVariant
      );
      renderButtons(
        controls.themes,
        format?.themes || [],
        publication.formats.story.theme,
        'themeId',
        selectTheme
      );
    }

    async function resolvePreview() {
      const requestId = ++latestRendererRequest;
      const selection = {
        brand: publication.brand,
        family: publication.family,
        variant: publication.formats.story.variant,
        format: ACTIVE_FORMAT,
      };
      setPreviewState('loading');
      setStatus('Atualizando preview');
      try {
        const resolved = await api.resolveEditorRenderer(selection);
        if (requestId !== latestRendererRequest) return;
        renderer = resolved;
        if (legacyBridge) {
          await legacyBridge.selectRenderer({
            renderer: resolved,
            theme: publication.formats.story.theme,
            assertCurrent: () => {
              if (requestId !== latestRendererRequest) {
                const error = new Error('Renderer obsoleto');
                error.code = 'OPERATION_STALE';
                throw error;
              }
            },
          });
        }
        if (requestId === latestRendererRequest) {
          setPreviewState('ready');
          setStatus('Pronto');
        }
      } catch (error) {
        if (requestId !== latestRendererRequest || error?.code === 'OPERATION_STALE') return;
        renderer = null;
        setPreviewState('error');
        setStatus('Preview não pôde ser carregado');
      }
    }

    async function selectVariant(variantId) {
      const { family } = currentNodes();
      const variant = catalogHelpers.getVariants(family, ACTIVE_FORMAT)
        .find(candidate => candidate.id === variantId);
      if (!variant) return;
      const theme = catalogHelpers.getFormat(variant, ACTIVE_FORMAT)?.themes?.[0] || null;
      publication = state.setFormatVariant(publication, ACTIVE_FORMAT, variant.id);
      publication = state.setFormatTheme(publication, ACTIVE_FORMAT, theme?.id || null);
      render();
      await resolvePreview();
    }

    function selectTheme(themeId) {
      const { format } = currentNodes();
      if (!(format?.themes || []).some(theme => theme.id === themeId)) return;
      publication = state.setFormatTheme(publication, ACTIVE_FORMAT, themeId);
      render();
      legacyBridge?.selectTheme(themeId);
      if (previewState === 'ready') setStatus('Pronto');
    }

    async function selectBrand(brandId) {
      const selection = catalogHelpers.chooseForBrand(catalog, brandId, ACTIVE_FORMAT);
      if (!selection) {
        render();
        setStatus('Nenhuma variante Story disponível');
        return;
      }
      applySelection(selection);
      render();
      await resolvePreview();
    }

    async function selectFamily(familyId) {
      const selection = catalogHelpers.chooseForFamily(catalog, publication.brand, familyId, ACTIVE_FORMAT);
      if (!selection) {
        render();
        setStatus('Nenhuma variante Story disponível');
        return;
      }
      applySelection(selection);
      render();
      await resolvePreview();
    }

    function bindEvents() {
      controls.brand?.addEventListener('change', event => selectBrand(event.target.value));
      controls.family?.addEventListener('change', event => selectFamily(event.target.value));
      document.querySelectorAll('[data-field]').forEach(field => {
        field.addEventListener('input', () => {
          publication = state.setContentField(publication, field.dataset.field, field.value);
        });
      });
      document.querySelector('[data-action="new-artwork"]')?.addEventListener('click', () => reset());
      document.querySelectorAll('[data-view-mode="feed"], [data-view-mode="compare"]')
        .forEach(button => button.addEventListener('click', () => setStatus('Em breve')));
    }

    async function reset() {
      latestRendererRequest += 1;
      publication = state.createPublication();
      document.querySelectorAll('[data-field]').forEach(field => { field.value = ''; });
      const selection = catalogHelpers.chooseDefault(catalog, ACTIVE_FORMAT);
      if (!selection) {
        render();
        setStatus('Nenhuma variante Story disponível');
        return;
      }
      applySelection(selection);
      render();
      await resolvePreview();
    }

    async function initialize() {
      setPreviewState('idle');
      setStatus('Carregando editor');
      bindEvents();
      try {
        catalog = await api.getEditorCatalog();
      } catch (error) {
        setStatus('Catálogo indisponível');
        return;
      }
      if (!catalogHelpers.chooseDefault(catalog, ACTIVE_FORMAT)) {
        render();
        setStatus('Nenhuma variante Story disponível');
        return;
      }
      await reset();
    }

    return {
      initialize,
      reset,
      selectBrand,
      selectFamily,
      selectTheme,
      selectVariant,
      getPublication: () => publication,
      getRenderer: () => renderer,
      getPreviewState: () => previewState,
    };
  }

  return { ACTIVE_FORMAT, createEditorController };
});
