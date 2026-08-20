(function exposeEditorUi(global, factory) {
  const editorUi = factory();
  if (typeof module === 'object' && module.exports) module.exports = editorUi;
  else global.EditorUi = editorUi;
})(typeof window !== 'undefined' ? window : globalThis, function createEditorUiModule() {
  const ACTIVE_FORMAT = 'story';

  function createEditorController({ document, api, state, catalogHelpers, frontendUtils, legacyBridge = null }) {
    let catalog = null;
    let publication = state.createPublication();
    let latestRendererRequest = 0;
    let renderer = null;
    let previewState = 'idle';
    let latestNewsImportId = 0;
    let latestContentSyncId = 0;

    const controls = {
      brand: document.querySelector('[data-control="brand"]'),
      family: document.querySelector('[data-control="family"]'),
      variants: document.querySelector('[data-control="variants"]'),
      themes: document.querySelector('[data-control="themes"]'),
      status: document.querySelector('[data-editor-status]'),
      downloadCurrent: document.querySelector('[data-action="download-current"]'),
      importNews: document.querySelector('[data-action="import-news"]'),
      imageAdjustments: document.querySelector('[data-control="image-adjustments"]'),
      resetImageAdjustments: document.querySelector('[data-action="reset-image-adjustments"]'),
    };

    function setStatus(message) {
      const target = controls.status?.querySelector('span:last-child') || controls.status;
      if (target) target.textContent = message;
    }

    function syncContentFields() {
      document.querySelectorAll('[data-field]').forEach(field => {
        const name = field.dataset.field;
        if (Object.prototype.hasOwnProperty.call(publication.content, name)) {
          field.value = publication.content[name];
        }
      });
    }

    function usefulValue(value) {
      return frontendUtils.normalizeOptionalValue(value);
    }

    function mapImportedContent(data) {
      const mapping = { h1: 'title', h2: 'subtitle', chapeu: 'tag', bg: 'image' };
      return Object.entries(mapping).reduce((patch, [transportField, contentField]) => {
        const value = usefulValue(data?.[transportField]);
        if (value) patch[contentField] = value;
        return patch;
      }, {});
    }

    function createNewsImportContext(url) {
      return { id: ++latestNewsImportId, url };
    }

    function assertContentSyncCurrent(syncId, assertCurrent = null) {
      if (syncId !== latestContentSyncId) {
        const error = new Error('SincronizaÃ§Ã£o de conteÃºdo obsoleta');
        error.code = 'OPERATION_STALE';
        throw error;
      }
      if (assertCurrent) assertCurrent();
    }

    async function syncPublicationContentToPreview({
      importedImage = null,
      assertCurrent = null,
      pendingStatus = 'Atualizando preview',
      readyStatus = 'Pronto',
    } = {}) {
      const syncId = ++latestContentSyncId;
      const content = { ...publication.content };
      const imageAdjustments = { ...publication.formats[ACTIVE_FORMAT].imageAdjustments };
      const assertSyncCurrent = () => assertContentSyncCurrent(syncId, assertCurrent);
      legacyBridge?.setContentSyncPending?.(true);
      if (pendingStatus) setStatus(pendingStatus);

      try {
        await legacyBridge.applyPublicationContent({
          content, imageAdjustments, importedImage, assertCurrent: assertSyncCurrent
        });
        assertSyncCurrent();
        legacyBridge?.setContentSyncPending?.(false);
        if (readyStatus) setStatus(readyStatus);
        return true;
      } catch (error) {
        if (syncId !== latestContentSyncId || error?.code === 'OPERATION_STALE') return false;
        setStatus('Preview nÃ£o pÃ´de ser atualizado');
        throw error;
      }
    }

    function reconcilePublicationContent(changedField) {
      const reconciled = legacyBridge?.reconcilePublicationContent?.({
        content: { ...publication.content },
        changedField,
      });
      if (reconciled) publication = state.applyContentPatch(publication, reconciled);
      syncContentFields();
    }

    function isNewsImportCurrent(context) {
      return context.id === latestNewsImportId && publication.content.url === context.url;
    }

    function assertNewsImportCurrent(context) {
      if (isNewsImportCurrent(context)) return;
      const error = new Error('ImportaÃ§Ã£o de notÃ­cia obsoleta');
      error.code = 'OPERATION_STALE';
      throw error;
    }

    async function importNews() {
      const urlField = document.querySelector('[data-field="url"]');
      const url = usefulValue(urlField?.value);
      publication = state.setContentField(publication, 'url', url);

      if (!url || !frontendUtils.isHttpUrl(url)) {
        latestNewsImportId += 1;
        setStatus('Informe uma URL vÃ¡lida');
        urlField?.focus?.();
        return;
      }

      const context = createNewsImportContext(url);
      const assertCurrent = () => assertNewsImportCurrent(context);
      controls.importNews && (controls.importNews.disabled = true);
      legacyBridge?.setNewsImportPending?.(true);
      setStatus('Importando notÃ­cia');

      try {
        const imported = await legacyBridge.importNews({ url, assertCurrent });
        assertCurrent();
        const patch = mapImportedContent(imported);
        if (!Object.keys(patch).length) throw new Error('NEWS_NOT_CONSUMABLE');
        publication = state.applyContentPatch(publication, patch);
        syncContentFields();
        const contentApplied = await syncPublicationContentToPreview({
          importedImage: patch.image ? { url, value: patch.image } : null,
          assertCurrent,
          pendingStatus: 'Importando notÃ­cia',
          readyStatus: null,
        });
        if (!contentApplied) return;
        assertCurrent();
        setStatus('Pronto');
      } catch (error) {
        if (!isNewsImportCurrent(context) || error?.code === 'OPERATION_STALE') return;
        if (isNewsImportCurrent(context)) setStatus('NÃ£o foi possÃ­vel importar a notÃ­cia');
      } finally {
        if (isNewsImportCurrent(context)) {
          controls.importNews && (controls.importNews.disabled = false);
          legacyBridge?.setNewsImportPending?.(false);
        }
      }
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
      renderImageAdjustments(format?.capabilities);
    }

    function renderImageAdjustments(capabilities = {}) {
      const supported = capabilities?.imageAdjustments || {};
      const visible = supported.zoom === true || supported.position === true;
      if (controls.imageAdjustments) controls.imageAdjustments.hidden = !visible;
      document.querySelectorAll('[data-image-adjustment]').forEach(input => {
        const key = input.dataset.imageAdjustment;
        input.disabled = !(key === 'zoom' ? supported.zoom === true : supported.position === true);
        input.value = String(publication.formats[ACTIVE_FORMAT].imageAdjustments[key]);
        const output = document.querySelector(`[data-value-for="${key}"]`);
        if (output) output.value = input.value;
      });
      if (controls.resetImageAdjustments) controls.resetImageAdjustments.disabled = !visible;
    }

    function updateImageAdjustment(input) {
      publication = state.setImageAdjustment(
        publication, ACTIVE_FORMAT, input.dataset.imageAdjustment, Number(input.value)
      );
      renderImageAdjustments(currentNodes().format?.capabilities);
      syncPublicationContentToPreview().catch(error => {
        if (error?.code !== 'OPERATION_STALE') console.error('Erro ao sincronizar enquadramento:', error);
      });
    }

    function resetCurrentImageAdjustments() {
      publication = state.resetImageAdjustments(publication, ACTIVE_FORMAT);
      renderImageAdjustments(currentNodes().format?.capabilities);
      return syncPublicationContentToPreview();
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
            activeFormat: ACTIVE_FORMAT,
            theme: publication.formats.story.theme,
            imageAdjustments: { ...publication.formats.story.imageAdjustments },
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
          if (field.dataset.field === 'url') {
            latestNewsImportId += 1;
            controls.importNews && (controls.importNews.disabled = false);
            legacyBridge?.setNewsImportPending?.(false);
          }
          reconcilePublicationContent(field.dataset.field);
          syncPublicationContentToPreview().catch(error => {
            if (error?.code !== 'OPERATION_STALE') console.error('Erro ao sincronizar conteÃºdo:', error);
          });
        });
      });
      document.querySelector('[data-field="url"]')?.addEventListener('keypress', event => {
        if (event.key === 'Enter') importNews();
      });
      controls.importNews?.addEventListener('click', importNews);
      document.querySelectorAll('[data-image-adjustment]')
        .forEach(input => input.addEventListener('input', () => updateImageAdjustment(input)));
      controls.resetImageAdjustments?.addEventListener('click', resetCurrentImageAdjustments);
      document.querySelector('[data-action="new-artwork"]')?.addEventListener('click', () => reset());
      document.querySelectorAll('[data-view-mode="feed"], [data-view-mode="compare"]')
        .forEach(button => button.addEventListener('click', () => setStatus('Em breve')));
    }

    async function reset() {
      latestRendererRequest += 1;
      latestNewsImportId += 1;
      latestContentSyncId += 1;
      legacyBridge?.setNewsImportPending?.(false);
      legacyBridge?.setContentSyncPending?.(true);
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
      if (previewState === 'ready') await syncPublicationContentToPreview();
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
      importNews,
      reset,
      syncPublicationContentToPreview,
      selectBrand,
      selectFamily,
      selectTheme,
      selectVariant,
      resetCurrentImageAdjustments,
      getPublication: () => publication,
      getRenderer: () => renderer,
      getPreviewState: () => previewState,
      getContentSyncId: () => latestContentSyncId,
    };
  }

  return { ACTIVE_FORMAT, createEditorController };
});
