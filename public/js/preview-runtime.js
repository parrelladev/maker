(function (global) {
  let manifest = {};
  let initialized = false;

  function toClassList(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    if (typeof value === 'string') return value.split(/\s+/).filter(Boolean);
    if (value === undefined || value === null) return [];
    return [String(value)];
  }

  function getValue(data, field, fallback) {
    if (!field) return fallback;
    const parts = field.split('.');
    let value = data;
    for (let index = 0; index < parts.length; index += 1) {
      if (
        value
        && typeof value === 'object'
        && Object.prototype.hasOwnProperty.call(value, parts[index])
      ) {
        value = value[parts[index]];
      } else {
        return fallback;
      }
    }
    return value;
  }

  function applyBindings(data) {
    const artworkData = data || {};
    const bindings = Array.isArray(manifest.bindings) ? manifest.bindings : [];
    const cssVars = Array.isArray(manifest.cssVars) ? manifest.cssVars : [];
    const classes = Array.isArray(manifest.classes) ? manifest.classes : [];
    const attributes = Array.isArray(manifest.attributes) ? manifest.attributes : [];

    bindings.forEach(binding => {
      if (!binding || !binding.selector) return;
      const value = Object.prototype.hasOwnProperty.call(binding, 'value')
        ? binding.value
        : getValue(artworkData, binding.field);
      if (value === undefined || value === null) return;

      const targets = Array.from(document.querySelectorAll(binding.selector));
      if (!targets.length) return;

      targets.forEach(element => {
        const type = binding.type || 'text';
        if (type === 'html') {
          element.innerHTML = String(value);
        } else if (type === 'image') {
          element.src = String(value);
        } else if (type === 'logo') {
          if (value && value.kind === 'inline-svg' && value.markup) {
            element.innerHTML = value.markup;
          } else if (value && value.src) {
            if (element.tagName && element.tagName.toLowerCase() === 'img') {
              element.src = value.src;
            } else {
              element.style.backgroundImage = `url(${value.src})`;
            }
          }
        } else {
          element.textContent = String(value);
        }
      });
    });

    cssVars.forEach(entry => {
      if (!entry || !entry.name) return;
      const selector = entry.selector || ':root';
      const value = Object.prototype.hasOwnProperty.call(entry, 'value')
        ? entry.value
        : getValue(artworkData, entry.field);
      if (value === undefined || value === null) return;
      const targets = selector === ':root'
        ? [document.documentElement]
        : Array.from(document.querySelectorAll(selector));
      targets.forEach(element => {
        element.style.setProperty(entry.name, String(value));
      });
    });

    classes.forEach(entry => {
      if (!entry || !entry.selector) return;
      const value = Object.prototype.hasOwnProperty.call(entry, 'value')
        ? entry.value
        : getValue(artworkData, entry.field);
      if (value === undefined || value === null) return;
      const targets = Array.from(document.querySelectorAll(entry.selector));
      const classList = toClassList(value);
      targets.forEach(element => {
        classList.forEach(className => {
          element.classList.add(className);
        });
      });
    });

    attributes.forEach(entry => {
      if (!entry || !entry.selector || !entry.name) return;
      const value = Object.prototype.hasOwnProperty.call(entry, 'value')
        ? entry.value
        : getValue(artworkData, entry.field);
      if (value === undefined || value === null) return;
      const targets = Array.from(document.querySelectorAll(entry.selector));
      targets.forEach(element => {
        element.setAttribute(entry.name, String(value));
      });
    });
  }

  function applyImageAdjustments(data) {
    const formats = manifest?.formats && typeof manifest.formats === 'object'
      ? manifest.formats
      : {};
    const formatIds = Object.keys(formats);
    const activeFormat = typeof data?.activeFormat === 'string' && data.activeFormat
      ? data.activeFormat
      : (formatIds.length === 1 ? formatIds[0] : null);
    const formatCapabilities = activeFormat ? formats[activeFormat]?.capabilities : null;
    const supported = formatCapabilities?.imageAdjustments || {};
    const adjustments = data?.imageAdjustments || {};
    const numericAdjustment = (key, fallback) => (
      typeof adjustments[key] === 'number' && Number.isFinite(adjustments[key])
        ? adjustments[key]
        : fallback
    );
    const imageBindings = Array.isArray(manifest.bindings)
      ? manifest.bindings.filter(binding => binding?.type === 'image' && binding.selector)
      : [];
    imageBindings.forEach(binding => {
      Array.from(document.querySelectorAll(binding.selector)).forEach(element => {
        const x = supported.position === true ? numericAdjustment('x', 50) : 50;
        const y = supported.position === true ? numericAdjustment('y', 50) : 50;
        const zoom = supported.zoom === true ? numericAdjustment('zoom', 1) : 1;
        element.style.objectPosition = `${x}% ${y}%`;
        element.style.transformOrigin = `${x}% ${y}%`;
        element.style.transform = `scale(${zoom})`;
      });
    });
  }

  function applyScale() {
    try {
      const designWidth = manifest?.dimensions?.width || 1080;
      const designHeight = manifest?.dimensions?.height || 1920;
      const viewportWidth = global.innerWidth || document.documentElement.clientWidth;
      const viewportHeight = global.innerHeight || document.documentElement.clientHeight;
      if (!viewportWidth || !viewportHeight) return true;

      const scaleX = viewportWidth / designWidth;
      const scaleY = viewportHeight / designHeight;
      const scale = Math.min(scaleX, scaleY);
      const root = document.documentElement;
      const body = document.body;

      root.style.transformOrigin = 'top left';
      root.style.transform = `scale(${scale})`;
      root.style.width = `${designWidth}px`;
      root.style.height = `${designHeight}px`;

      if (body) {
        body.style.margin = '0';
        body.style.padding = '0';
        body.style.overflow = 'hidden';
        body.style.display = 'flex';
        body.style.alignItems = 'stretch';
        body.style.justifyContent = 'center';
        body.style.backgroundColor = '#000';
      }
      return true;
    } catch (error) {
      console.error('Erro ao aplicar escala de preview:', error);
      return false;
    }
  }

  function handleResize() {
    applyScale();
  }

  function update(data) {
    try {
      applyBindings(data || {});
      applyImageAdjustments(data || {});
      if (!applyScale()) {
        throw new Error('Falha ao aplicar escala de preview');
      }
    } catch (error) {
      console.error('Erro ao aplicar bindings no preview:', error);
      throw error;
    }
  }

  function initialize(nextManifest) {
    manifest = nextManifest || {};
    global.__updatePreview = update;
    if (!initialized) {
      global.addEventListener('resize', handleResize);
      global.addEventListener('load', applyScale);
      global.setTimeout(applyScale, 0);
      initialized = true;
    }
  }

  global.PreviewRuntime = {
    initialize,
    update,
    applyScale,
    handleResize
  };
})(window);
