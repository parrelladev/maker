(function exposeEditorUi(global, factory) {
  const editorUi = factory();
  if (typeof module === 'object' && module.exports) module.exports = editorUi;
  else global.EditorUi = editorUi;
})(typeof window !== 'undefined' ? window : globalThis, function createEditorUiModule() {
  const INITIAL_FORMAT = 'story';

  function createEditorController({ document, api, state, catalogHelpers, frontendUtils, legacyBridge = null }) {
    let catalog = null;
    let publication = state.createPublication();
    const previewContexts = {
      feed: { renderer: null, previewState: 'idle', rendererRequestId: 0, contentSyncId: 0, syncPending: false, dimensions: null, structuralSelection: null },
      story: { renderer: null, previewState: 'idle', rendererRequestId: 0, contentSyncId: 0, syncPending: false, dimensions: null, structuralSelection: null },
    };
    let latestNewsImportId = 0;
    let activeFormat = INITIAL_FORMAT;
    let viewMode = INITIAL_FORMAT;
    let exportPending = false;

    const controls = {
      brand: document.querySelector('[data-control="brand"]'),
      family: document.querySelector('[data-control="family"]'),
      variants: document.querySelector('[data-control="variants"]'),
      themes: document.querySelector('[data-control="themes"]'),
      status: document.querySelector('[data-editor-status]'),
      downloadCurrent: document.querySelector('[data-action="download-current"]'),
      downloadAll: document.querySelector('[data-action="download-all"]'),
      importNews: document.querySelector('[data-action="import-news"]'),
      imageAdjustments: document.querySelector('[data-control="image-adjustments"]'),
      resetImageAdjustments: document.querySelector('[data-action="reset-image-adjustments"]'),
      previewStage: document.querySelector('[data-preview-stage]'),
    };

    function setStatus(message) {
      const target = controls.status?.querySelector('span:last-child') || controls.status;
      if (target) target.textContent = message;
    }

    function currentStructuralSelection(format) {
      return {
        brand: publication.brand,
        family: publication.family,
        variant: publication.formats[format]?.variant,
        format,
      };
    }

    function sameStructuralSelection(left, right) {
      return Boolean(left && right
        && left.brand === right.brand
        && left.family === right.family
        && left.variant === right.variant
        && left.format === right.format);
    }

    function isFormatExportable(format) {
      const context = previewContexts[format];
      return Boolean(context
        && context.previewState === 'ready'
        && context.syncPending === false
        && context.renderer
        && sameStructuralSelection(context.structuralSelection, currentStructuralSelection(format))
        && legacyBridge?.isFormatExportable?.(format, context.renderer));
    }

    function refreshExportButtons() {
      if (controls.downloadCurrent) {
        controls.downloadCurrent.disabled = exportPending || !isFormatExportable(activeFormat);
      }
      if (controls.downloadAll) {
        controls.downloadAll.disabled = exportPending
          || !isFormatExportable('feed') || !isFormatExportable('story');
      }
    }

    function captureExportAuthority(format) {
      if (!isFormatExportable(format)) return null;
      const context = previewContexts[format];
      const technicalAuthority = legacyBridge.captureExportAuthority(format);
      if (!technicalAuthority) return null;
      return {
        format, context, technicalAuthority,
        renderer: context.renderer,
        rendererRequestId: context.rendererRequestId,
        contentSyncId: context.contentSyncId,
        structuralSelection: context.structuralSelection,
      };
    }

    function isExportAuthorityCurrent(authority) {
      if (!authority || !isFormatExportable(authority.format)) return false;
      const context = previewContexts[authority.format];
      return context === authority.context
        && context.renderer === authority.renderer
        && context.rendererRequestId === authority.rendererRequestId
        && context.contentSyncId === authority.contentSyncId
        && context.structuralSelection === authority.structuralSelection
        && legacyBridge.isExportAuthorityCurrent(authority.technicalAuthority);
    }

    async function withExportLock(operation) {
      if (exportPending) return false;
      exportPending = true;
      legacyBridge?.setExportPending?.(true);
      refreshExportButtons();
      try {
        return await operation();
      } catch (error) {
        console.error('Erro ao exportar arte:', error);
        legacyBridge?.reportExportError?.(error);
        return false;
      } finally {
        exportPending = false;
        legacyBridge?.setExportPending?.(false);
        refreshExportButtons();
      }
    }

    async function downloadCurrent() {
      const format = activeFormat;
      if (exportPending || !isFormatExportable(format)) return false;
      const authority = captureExportAuthority(format);
      if (!authority) return false;
      return withExportLock(async () => {
        if (!isExportAuthorityCurrent(authority)) return false;
        const downloaded = await legacyBridge.downloadExport(
          authority.technicalAuthority, `maker-${format}.png`,
          () => isExportAuthorityCurrent(authority),
        );
        return downloaded !== false;
      });
    }

    async function downloadAll() {
      if (exportPending || !isFormatExportable('feed') || !isFormatExportable('story')) return false;
      const feed = captureExportAuthority('feed');
      const story = captureExportAuthority('story');
      if (!feed || !story) return false;
      const bothCurrent = () => isExportAuthorityCurrent(feed) && isExportAuthorityCurrent(story);
      return withExportLock(async () => {
        if (!bothCurrent()) return false;
        const feedDownloaded = await legacyBridge.downloadExport(
          feed.technicalAuthority, 'maker-feed.png', bothCurrent,
        );
        if (feedDownloaded === false) return false;
        if (!bothCurrent()) return false;
        const storyDownloaded = await legacyBridge.downloadExport(
          story.technicalAuthority, 'maker-story.png', bothCurrent,
        );
        return storyDownloaded !== false;
      });
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

    function assertContentSyncCurrent(syncId, format, assertCurrent = null) {
      if (syncId !== previewContexts[format].contentSyncId) {
        const error = new Error('SincronizaÃ§Ã£o de conteÃºdo obsoleta');
        error.code = 'OPERATION_STALE';
        throw error;
      }
      if (assertCurrent) assertCurrent();
    }

    async function syncFormatContent(format, {
      importedImage = null,
      assertCurrent = null,
      pendingStatus = 'Atualizando preview',
      readyStatus = 'Pronto',
    } = {}) {
      const context = previewContexts[format];
      if (context.previewState !== 'ready') return false;
      const syncId = ++context.contentSyncId;
      const content = { ...publication.content };
      const theme = publication.formats[format].theme;
      const imageAdjustments = { ...publication.formats[format].imageAdjustments };
      const assertSyncCurrent = () => assertContentSyncCurrent(syncId, format, assertCurrent);
      context.syncPending = true;
      legacyBridge?.setContentSyncPending?.(true, format);
      refreshExportButtons();
      if (pendingStatus) setStatus(pendingStatus);

      try {
        await legacyBridge.applyPublicationContent({
          content, theme, activeFormat: format, imageAdjustments, importedImage,
          assertCurrent: assertSyncCurrent
        });
        assertSyncCurrent();
        context.syncPending = false;
        legacyBridge?.setContentSyncPending?.(false, format);
        refreshExportButtons();
        if (readyStatus) setStatus(readyStatus);
        return true;
      } catch (error) {
        if (syncId !== context.contentSyncId || error?.code === 'OPERATION_STALE') return false;
        setStatus('Preview nÃ£o pÃ´de ser atualizado');
        throw error;
      }
    }

    async function syncPublicationContentToPreview(options = {}) {
      const formats = viewMode === 'compare' ? ['feed', 'story'] : [activeFormat];
      try {
        const results = await Promise.all(formats.map(format => syncFormatContent(format, options)));
        return results.some(Boolean);
      } finally {
        legacyBridge?.setActiveFormat?.(activeFormat);
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

    function setPreviewState(format, nextState) {
      previewContexts[format].previewState = nextState;
      const ready = nextState === 'ready';
      if (legacyBridge?.setEditorPreviewReady) {
        legacyBridge.setEditorPreviewReady(format, ready);
      } else if (controls.downloadCurrent) {
        controls.downloadCurrent.disabled = !ready;
      }
      refreshExportButtons();
    }

    function applySelection(selection) {
      publication = state.setBrand(publication, selection.brand.id);
      publication = state.setFamily(publication, selection.family.id);
      publication = state.setFormatVariant(publication, activeFormat, selection.variant.id);
      publication = state.setFormatTheme(publication, activeFormat, selection.theme?.id || null);
    }

    function currentNodes() {
      const brand = catalogHelpers.findBrand(catalog, publication.brand);
      const family = catalogHelpers.findFamily(brand, publication.family);
      const variant = catalogHelpers.getVariants(family, activeFormat)
        .find(candidate => candidate.id === publication.formats[activeFormat].variant) || null;
      return { brand, family, variant, format: catalogHelpers.getFormat(variant, activeFormat) };
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
        catalogHelpers.getVariants(family, activeFormat),
        publication.formats[activeFormat].variant,
        'variantId',
        selectVariant
      );
      renderButtons(
        controls.themes,
        format?.themes || [],
        publication.formats[activeFormat].theme,
        'themeId',
        selectTheme
      );
      renderImageAdjustments(format?.capabilities);
      document.querySelectorAll('[data-view-mode]').forEach(button => {
        const selected = button.dataset.viewMode === viewMode;
        button.setAttribute('aria-pressed', String(selected));
        button.classList.toggle?.('is-active', selected);
      });
      if (controls.previewStage) controls.previewStage.dataset.viewMode = viewMode;
      document.querySelectorAll('[data-preview-panel]').forEach(panel => {
        const formatId = panel.dataset.previewPanel;
        panel.hidden = viewMode !== 'compare' && viewMode !== formatId;
        panel.classList.toggle?.('is-active', formatId === activeFormat);
      });
      document.querySelectorAll('[data-select-preview-format]').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.selectPreviewFormat === activeFormat));
      });
      refreshExportButtons();
    }

    function formatLabel(format) {
      return format === 'story' ? 'Story' : format === 'feed' ? 'Feed' : format;
    }

    function updatePreviewDimensions(format, dimensions) {
      const width = Number(dimensions?.width);
      const height = Number(dimensions?.height);
      if (!width || !height) return;
      const viewport = document.querySelector(`[data-preview-viewport][data-preview-format="${format}"]`);
      const frame = document.querySelector(`[data-preview-frame="${format}"]`);
      const targetViewport = viewport || (format === activeFormat ? document.querySelector('[data-preview-viewport]') : null);
      const targetFrame = frame || (format === activeFormat ? document.querySelector('#previewFrame') : null);
      if (targetViewport) targetViewport.style.aspectRatio = `${width} / ${height}`;
      if (targetFrame) {
        targetFrame.style.width = `${width}px`;
        targetFrame.style.height = `${height}px`;
      }
      legacyBridge?.resizePreview?.(format);
    }

    function renderImageAdjustments(capabilities = {}) {
      const supported = capabilities?.imageAdjustments || {};
      const visible = supported.zoom === true || supported.position === true;
      if (controls.imageAdjustments) controls.imageAdjustments.hidden = !visible;
      document.querySelectorAll('[data-image-adjustment]').forEach(input => {
        const key = input.dataset.imageAdjustment;
        input.disabled = !(key === 'zoom' ? supported.zoom === true : supported.position === true);
        input.value = String(publication.formats[activeFormat].imageAdjustments[key]);
        const output = document.querySelector(`[data-value-for="${key}"]`);
        if (output) output.value = input.value;
      });
      if (controls.resetImageAdjustments) controls.resetImageAdjustments.disabled = !visible;
    }

    function updateImageAdjustment(input) {
      publication = state.setImageAdjustment(
        publication, activeFormat, input.dataset.imageAdjustment, Number(input.value)
      );
      renderImageAdjustments(currentNodes().format?.capabilities);
      if (previewContexts[activeFormat].previewState !== 'ready') return;
      syncPublicationContentToPreview().catch(error => {
        if (error?.code !== 'OPERATION_STALE') console.error('Erro ao sincronizar enquadramento:', error);
      });
    }

    function resetCurrentImageAdjustments() {
      publication = state.resetImageAdjustments(publication, activeFormat);
      renderImageAdjustments(currentNodes().format?.capabilities);
      if (previewContexts[activeFormat].previewState !== 'ready') return Promise.resolve(false);
      return syncPublicationContentToPreview();
    }

    function isStructuralSelectionCurrent(selection, requestId) {
      return requestId === previewContexts[selection.format].rendererRequestId
        && selection.brand === publication.brand
        && selection.family === publication.family
        && selection.variant === publication.formats[selection.format].variant;
    }

    function assertStructuralSelectionCurrent(selection, requestId) {
      if (isStructuralSelectionCurrent(selection, requestId)) return;
      const error = new Error('Renderer obsoleto');
      error.code = 'OPERATION_STALE';
      throw error;
    }

    function readPublicationSnapshot(format) {
      return {
        activeFormat: format,
        theme: publication.formats[format].theme,
        imageAdjustments: { ...publication.formats[format].imageAdjustments },
        content: { ...publication.content },
      };
    }

    function samePublicationSnapshot(left, right) {
      return left.activeFormat === right.activeFormat
        && left.theme === right.theme
        && Object.keys(left.imageAdjustments).every(key => (
          left.imageAdjustments[key] === right.imageAdjustments[key]
        ))
        && Object.keys(left.content).every(key => left.content[key] === right.content[key]);
    }

    async function applyCurrentSnapshotUntilStable(selection, requestId, initialSnapshot) {
      let appliedSnapshot = initialSnapshot;
      while (true) {
        assertStructuralSelectionCurrent(selection, requestId);
        const currentSnapshot = readPublicationSnapshot(selection.format);
        if (samePublicationSnapshot(appliedSnapshot, currentSnapshot)) return;
        await legacyBridge.applyPublicationContent({
          ...currentSnapshot,
          assertCurrent: () => assertStructuralSelectionCurrent(selection, requestId),
        });
        appliedSnapshot = currentSnapshot;
      }
    }

    async function resolvePreview(format = activeFormat) {
      const context = previewContexts[format];
      const requestId = ++context.rendererRequestId;
      const selection = {
        brand: publication.brand,
        family: publication.family,
        variant: publication.formats[format].variant,
        format,
      };
      context.structuralSelection = selection;
      setPreviewState(format, 'loading');
      context.syncPending = true;
      legacyBridge?.setContentSyncPending?.(true, format);
      setStatus('Atualizando preview');
      try {
        const resolved = await api.resolveEditorRenderer(selection);
        assertStructuralSelectionCurrent(selection, requestId);
        context.renderer = resolved;
        context.dimensions = resolved.dimensions;
        updatePreviewDimensions(format, resolved.dimensions);
        if (legacyBridge) {
          const snapshot = readPublicationSnapshot(format);
          await legacyBridge.selectRenderer({
            renderer: resolved,
            ...snapshot,
            assertCurrent: () => assertStructuralSelectionCurrent(selection, requestId),
          });
          await applyCurrentSnapshotUntilStable(selection, requestId, snapshot);
        }
        if (isStructuralSelectionCurrent(selection, requestId)) {
          context.syncPending = false;
          legacyBridge?.setContentSyncPending?.(false, format);
          setPreviewState(format, 'ready');
          setStatus('Pronto');
        }
        legacyBridge?.setActiveFormat?.(activeFormat);
      } catch (error) {
        if (requestId !== context.rendererRequestId || error?.code === 'OPERATION_STALE') return;
        context.renderer = null;
        context.structuralSelection = null;
        context.syncPending = false;
        legacyBridge?.clearPreview?.(format);
        setPreviewState(format, 'error');
        setStatus('Preview não pôde ser carregado');
      }
    }

    async function selectFormat(format) {
      if (format !== 'story' && format !== 'feed') return;
      if (viewMode !== 'compare' && activeFormat !== format) {
        previewContexts[activeFormat].contentSyncId += 1;
        previewContexts[activeFormat].syncPending = false;
      }
      viewMode = format;
      activeFormat = format;
      legacyBridge?.setActiveFormat?.(activeFormat);
      const brand = catalogHelpers.findBrand(catalog, publication.brand);
      const family = catalogHelpers.findFamily(brand, publication.family);
      const variant = catalogHelpers.getVariants(family, format)
        .find(candidate => candidate.id === publication.formats[format].variant);
      if (!variant) {
        const selection = catalogHelpers.chooseForFamily(catalog, publication.brand, publication.family, format);
        if (!selection) {
          previewContexts[format].rendererRequestId += 1;
          previewContexts[format].contentSyncId += 1;
          previewContexts[format].renderer = null;
          setPreviewState(format, 'error');
          legacyBridge?.clearPreview?.(format);
          render();
          setStatus(`${formatLabel(format)} não disponível para esta configuração`);
          return;
        }
        applySelection(selection);
      }
      render();
      await resolvePreview(format);
    }

    function invalidatePreviewContext(format, { clear = true } = {}) {
      const context = previewContexts[format];
      context.rendererRequestId += 1;
      context.contentSyncId += 1;
      context.renderer = null;
      context.previewState = 'idle';
      context.syncPending = false;
      context.dimensions = null;
      context.structuralSelection = null;
      if (clear) legacyBridge?.clearPreview?.(format);
    }

    async function selectViewMode(mode) {
      if (mode !== 'compare') return selectFormat(mode);
      viewMode = 'compare';
      legacyBridge?.setActiveFormat?.(activeFormat);
      render();
      legacyBridge?.setActiveFormat?.(activeFormat);
      await Promise.all(['feed', 'story'].map(format => {
        if (previewContexts[format].previewState === 'ready') return Promise.resolve();
        const selection = catalogHelpers.chooseForFamily(catalog, publication.brand, publication.family, format);
        if (!selection) {
          previewContexts[format].rendererRequestId += 1;
          previewContexts[format].contentSyncId += 1;
          previewContexts[format].renderer = null;
          setPreviewState(format, 'error');
          legacyBridge?.clearPreview?.(format);
          return Promise.resolve();
        }
        publication = state.setFormatVariant(publication, format, selection.variant.id);
        publication = state.setFormatTheme(publication, format, selection.theme?.id || null);
        return resolvePreview(format);
      }));
      render();
    }

    async function selectVariant(variantId) {
      const { family } = currentNodes();
      const variant = catalogHelpers.getVariants(family, activeFormat)
        .find(candidate => candidate.id === variantId);
      if (!variant) return;
      const theme = catalogHelpers.getFormat(variant, activeFormat)?.themes?.[0] || null;
      publication = state.setFormatVariant(publication, activeFormat, variant.id);
      publication = state.setFormatTheme(publication, activeFormat, theme?.id || null);
      render();
      await resolvePreview();
    }

    function selectTheme(themeId) {
      const { format } = currentNodes();
      if (!(format?.themes || []).some(theme => theme.id === themeId)) return;
      publication = state.setFormatTheme(publication, activeFormat, themeId);
      render();
      if (previewContexts[activeFormat].previewState !== 'ready') return Promise.resolve(false);
      return syncPublicationContentToPreview().catch(error => {
        if (error?.code !== 'OPERATION_STALE') console.error('Erro ao sincronizar tema:', error);
        return false;
      });
    }

    async function selectBrand(brandId) {
      const selection = catalogHelpers.chooseForBrand(catalog, brandId, activeFormat);
      if (!selection) {
        render();
        setStatus(`${formatLabel(activeFormat)} não disponível para esta configuração`);
        return;
      }
      ['feed', 'story'].forEach(format => invalidatePreviewContext(format));
      applySelection(selection);
      const otherFormat = activeFormat === 'feed' ? 'story' : 'feed';
      const other = catalogHelpers.chooseForFamily(catalog, selection.brand.id, selection.family.id, otherFormat);
      if (other) {
        publication = state.setFormatVariant(publication, otherFormat, other.variant.id);
        publication = state.setFormatTheme(publication, otherFormat, other.theme?.id || null);
      }
      render();
      await (viewMode === 'compare' ? selectViewMode('compare') : resolvePreview());
    }

    async function selectFamily(familyId) {
      const selection = catalogHelpers.chooseForFamily(catalog, publication.brand, familyId, activeFormat);
      if (!selection) {
        render();
        setStatus(`${formatLabel(activeFormat)} não disponível para esta configuração`);
        return;
      }
      ['feed', 'story'].forEach(format => invalidatePreviewContext(format));
      applySelection(selection);
      const otherFormat = activeFormat === 'feed' ? 'story' : 'feed';
      const other = catalogHelpers.chooseForFamily(catalog, selection.brand.id, selection.family.id, otherFormat);
      if (other) {
        publication = state.setFormatVariant(publication, otherFormat, other.variant.id);
        publication = state.setFormatTheme(publication, otherFormat, other.theme?.id || null);
      }
      render();
      await (viewMode === 'compare' ? selectViewMode('compare') : resolvePreview());
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
          if (!['feed', 'story'].some(format => previewContexts[format].previewState === 'ready')) return;
          syncPublicationContentToPreview().catch(error => {
            if (error?.code !== 'OPERATION_STALE') console.error('Erro ao sincronizar conteÃºdo:', error);
          });
        });
      });
      document.querySelector('[data-field="url"]')?.addEventListener('keypress', event => {
        if (event.key === 'Enter') importNews();
      });
      controls.importNews?.addEventListener('click', importNews);
      controls.downloadCurrent?.addEventListener('click', downloadCurrent);
      controls.downloadAll?.addEventListener('click', downloadAll);
      document.querySelectorAll('[data-image-adjustment]')
        .forEach(input => input.addEventListener('input', () => updateImageAdjustment(input)));
      controls.resetImageAdjustments?.addEventListener('click', resetCurrentImageAdjustments);
      document.querySelector('[data-action="new-artwork"]')?.addEventListener('click', () => reset());
      document.querySelectorAll('[data-view-mode]')
        .forEach(button => button.addEventListener('click', () => selectViewMode(button.dataset.viewMode)));
      document.querySelectorAll('[data-select-preview-format]').forEach(button => {
        button.addEventListener('click', () => {
          if (viewMode !== 'compare') return;
          activeFormat = button.dataset.selectPreviewFormat;
          legacyBridge?.setActiveFormat?.(activeFormat);
          render();
          setPreviewState(activeFormat, previewContexts[activeFormat].previewState);
        });
      });
    }

    async function reset() {
      latestNewsImportId += 1;
      Object.entries(previewContexts).forEach(([format, context]) => {
        const hadAuthority = context.renderer || context.previewState !== 'idle';
        context.rendererRequestId += 1;
        context.contentSyncId += 1;
        context.renderer = null;
        context.previewState = 'idle';
        context.syncPending = false;
        context.dimensions = null;
        context.structuralSelection = null;
        if (hadAuthority) legacyBridge?.clearPreview?.(format);
      });
      legacyBridge?.setNewsImportPending?.(false);
      viewMode = INITIAL_FORMAT;
      activeFormat = INITIAL_FORMAT;
      publication = state.createPublication();
      document.querySelectorAll('[data-field]').forEach(field => { field.value = ''; });
      const selection = catalogHelpers.chooseDefault(catalog, activeFormat);
      if (!selection) {
        render();
        setStatus('Nenhuma variante Story disponível');
        return;
      }
      applySelection(selection);
      render();
      await resolvePreview(INITIAL_FORMAT);
    }

    async function initialize() {
      setPreviewState(INITIAL_FORMAT, 'idle');
      setStatus('Carregando editor');
      bindEvents();
      try {
        catalog = await api.getEditorCatalog();
      } catch (error) {
        setStatus('Catálogo indisponível');
        return;
      }
      if (!catalogHelpers.chooseDefault(catalog, activeFormat)) {
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
      selectFormat,
      selectViewMode,
      resetCurrentImageAdjustments,
      getPublication: () => publication,
      getRenderer: (format = activeFormat) => previewContexts[format].renderer,
      getPreviewState: (format = activeFormat) => previewContexts[format].previewState,
      getContentSyncId: (format = activeFormat) => previewContexts[format].contentSyncId,
      getActiveFormat: () => activeFormat,
      getViewMode: () => viewMode,
      getPreviewContexts: () => previewContexts,
      isFormatExportable,
      downloadCurrent,
      downloadAll,
      isExportPending: () => exportPending,
    };
  }

  return { INITIAL_FORMAT, createEditorController };
});
