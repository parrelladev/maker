const { SaxesParser } = require('saxes');

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';

const ALLOWED_ELEMENTS = new Set([
  'svg',
  'g',
  'defs',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'clipPath',
  'mask',
  'linearGradient',
  'radialGradient',
  'stop',
  'symbol',
  'use',
  'title',
  'desc',
]);

const ALLOWED_ATTRIBUTES = new Set([
  'id',
  'class',
  'data-name',
  'viewBox',
  'width',
  'height',
  'preserveAspectRatio',
  'version',
  'x',
  'y',
  'x1',
  'x2',
  'y1',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'd',
  'points',
  'transform',
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'opacity',
  'clip-path',
  'clip-rule',
  'filter',
  'mask',
  'marker-start',
  'marker-mid',
  'marker-end',
  'gradientUnits',
  'gradientTransform',
  'spreadMethod',
  'offset',
  'stop-color',
  'stop-opacity',
  'pathLength',
  'vector-effect',
  'role',
  'aria-label',
  'aria-hidden',
  'focusable',
  'href',
  'xlink:href',
]);

const PAINT_ATTRIBUTES = new Set(['fill', 'stroke', 'stop-color']);
const REFERENCE_ATTRIBUTES = new Set([
  'clip-path',
  'filter',
  'mask',
  'marker-start',
  'marker-mid',
  'marker-end',
]);
const OPACITY_ATTRIBUTES = new Set([
  'fill-opacity',
  'stroke-opacity',
  'opacity',
  'stop-opacity',
]);
const NUMBER_ATTRIBUTES = new Set([
  'x',
  'y',
  'x1',
  'x2',
  'y1',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'width',
  'height',
  'stroke-width',
  'stroke-miterlimit',
  'stroke-dashoffset',
  'pathLength',
  'offset',
]);
const SAFE_STYLE_PROPERTIES = new Set([
  'fill',
  'stroke',
  'fill-opacity',
  'stroke-opacity',
  'opacity',
]);
const LOCAL_FRAGMENT = /^#[A-Za-z_][A-Za-z0-9_.:-]*$/;
const LOCAL_URL = /^url\(#[A-Za-z_][A-Za-z0-9_.:-]*\)$/;
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const NUMBER_OR_PERCENT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?%?$/;
const FORBIDDEN_CSS_SYNTAX =
  /[\\\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]|\/\*|\*\//;

class SvgValidationError extends Error {
  constructor(code) {
    const messages = {
      INVALID_SVG: 'Conteúdo SVG inválido ou não permitido',
      SVG_TOO_LARGE: 'Conteúdo SVG excede o limite permitido',
    };
    super(messages[code] || messages.INVALID_SVG);
    this.name = 'SvgValidationError';
    this.code = code;
  }
}

function escapeText(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value) {
  return escapeText(value).replace(/"/g, '&quot;');
}

function isLocalUrl(value) {
  return LOCAL_URL.test(value);
}

function isPaint(value) {
  return (
    /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{1}|[0-9a-fA-F]{3}(?:[0-9a-fA-F]{2})?)?$/.test(value) ||
    value === 'none' ||
    value === 'currentColor' ||
    isLocalUrl(value)
  );
}

function isOpacity(value) {
  if (value.endsWith('%')) {
    const number = Number(value.slice(0, -1));
    return NUMBER_OR_PERCENT.test(value) && number >= 0 && number <= 100;
  }
  const number = Number(value);
  return NUMBER.test(value) && number >= 0 && number <= 1;
}

function isTransform(value) {
  const transform =
    /(?:matrix|translate|scale|rotate|skewX|skewY)\(\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(?:[\s,]+[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)*\s*\)/y;
  let position = 0;

  while (position < value.length) {
    while (/\s/.test(value[position])) position += 1;
    transform.lastIndex = position;
    const match = transform.exec(value);
    if (!match) return false;
    position = transform.lastIndex;
  }
  return position > 0;
}

function isAllowedAttributeValue(name, rawValue) {
  const value = rawValue.trim();
  if (!value || FORBIDDEN_CSS_SYNTAX.test(value)) return false;

  if (PAINT_ATTRIBUTES.has(name)) return isPaint(value);
  if (REFERENCE_ATTRIBUTES.has(name)) return value === 'none' || isLocalUrl(value);
  if (OPACITY_ATTRIBUTES.has(name)) return isOpacity(value);
  if (NUMBER_ATTRIBUTES.has(name)) return NUMBER_OR_PERCENT.test(value);
  if (name === 'stroke-dasharray') {
    return value === 'none' || value.split(/[\s,]+/).every((part) => part && NUMBER_OR_PERCENT.test(part));
  }
  if (name === 'href' || name === 'xlink:href') return LOCAL_FRAGMENT.test(value);
  if (name === 'id') return /^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(value);
  if (name === 'class') {
    return value.split(/\s+/).every((part) => /^[A-Za-z_][A-Za-z0-9_-]*$/.test(part));
  }
  if (name === 'viewBox') {
    return value.split(/[\s,]+/).length === 4 &&
      value.split(/[\s,]+/).every((part) => NUMBER.test(part));
  }
  if (name === 'transform' || name === 'gradientTransform') return isTransform(value);
  if (name === 'd') return /^[MmZzLlHhVvCcSsQqTtAaEe0-9+\-.,\s]+$/.test(value);
  if (name === 'points') {
    return value.split(/[\s,]+/).every((part) => part && NUMBER.test(part));
  }
  if (name === 'fill-rule' || name === 'clip-rule') {
    return value === 'nonzero' || value === 'evenodd';
  }
  if (name === 'stroke-linecap') return ['butt', 'round', 'square'].includes(value);
  if (name === 'stroke-linejoin') return ['miter', 'round', 'bevel'].includes(value);
  if (name === 'gradientUnits') return ['userSpaceOnUse', 'objectBoundingBox'].includes(value);
  if (name === 'spreadMethod') return ['pad', 'reflect', 'repeat'].includes(value);
  if (name === 'preserveAspectRatio') {
    return /^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max)(?: (?:meet|slice))?)$/.test(value);
  }
  if (name === 'vector-effect') return value === 'none' || value === 'non-scaling-stroke';
  if (name === 'aria-hidden' || name === 'focusable') return value === 'true' || value === 'false';
  if (name === 'version') return /^\d+(?:\.\d+)?$/.test(value);

  return !/[<>{};]/.test(value);
}

function isAllowedAttribute(attribute) {
  const name = attribute.name;
  const lowerName = name.toLowerCase();
  const value = attribute.value.trim();

  if (lowerName.startsWith('on') || lowerName === 'style') return false;
  if (name === 'xmlns') return value === SVG_NAMESPACE;
  if (name === 'xmlns:xlink') return value === XLINK_NAMESPACE;
  if (!ALLOWED_ATTRIBUTES.has(name)) return false;

  return isAllowedAttributeValue(name, value);
}

function parseStyleRules(css) {
  if (!css.trim()) return [];
  if (FORBIDDEN_CSS_SYNTAX.test(css) || /[@!"']/u.test(css)) return [];

  const rules = [];
  let position = 0;
  const skipWhitespace = () => {
    while (position < css.length && /\s/.test(css[position])) position += 1;
  };

  while (position < css.length) {
    skipWhitespace();
    if (position === css.length) break;
    if (css[position] !== '.') return [];
    position += 1;

    const classStart = position;
    while (position < css.length && /[A-Za-z0-9_-]/.test(css[position])) position += 1;
    const className = css.slice(classStart, position);
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(className)) return [];

    skipWhitespace();
    if (css[position] !== '{') return [];
    position += 1;
    const bodyEnd = css.indexOf('}', position);
    if (bodyEnd === -1 || css.slice(position, bodyEnd).includes('{')) return [];
    const body = css.slice(position, bodyEnd);
    position = bodyEnd + 1;

    const declarations = new Map();
    for (const declaration of body.split(';')) {
      if (!declaration.trim()) continue;
      const colon = declaration.indexOf(':');
      if (colon <= 0 || declaration.indexOf(':', colon + 1) !== -1) return [];
      const property = declaration.slice(0, colon).trim().toLowerCase();
      const value = declaration.slice(colon + 1).trim();
      if (
        !SAFE_STYLE_PROPERTIES.has(property) ||
        !isAllowedAttributeValue(property, value)
      ) {
        return [];
      }
      declarations.set(property, value);
    }
    if (!declarations.size) return [];
    rules.push({ className, declarations });
  }

  return rules;
}

function collectStyleRules(markup) {
  const rules = [];
  const stack = [];
  let styleText = null;
  const parser = new SaxesParser({ xmlns: true });

  parser.on('doctype', () => {
    throw new SvgValidationError('INVALID_SVG');
  });
  parser.on('opentag', (tag) => {
    const parentAllowed = stack.length === 0 || stack[stack.length - 1].allowed;
    const isStyle =
      parentAllowed &&
      tag.local === 'style' &&
      (!tag.uri || tag.uri === SVG_NAMESPACE);
    const allowed =
      parentAllowed &&
      (isStyle ||
        (ALLOWED_ELEMENTS.has(tag.local) &&
          (!tag.uri || tag.uri === SVG_NAMESPACE)));
    stack.push({ allowed, isStyle });
    if (isStyle) styleText = '';
  });
  parser.on('text', (text) => {
    if (stack[stack.length - 1]?.isStyle) styleText += text;
  });
  parser.on('closetag', () => {
    const current = stack.pop();
    if (current?.isStyle) {
      rules.push(...parseStyleRules(styleText));
      styleText = null;
    }
  });
  parser.on('error', () => {
    throw new SvgValidationError('INVALID_SVG');
  });
  parser.write(markup).close();

  return rules;
}

function sanitizeSvg(markup, { maxBytes = Infinity } = {}) {
  if (typeof markup !== 'string' || Buffer.byteLength(markup, 'utf8') > maxBytes) {
    if (typeof markup === 'string') {
      throw new SvgValidationError('SVG_TOO_LARGE');
    }
    throw new SvgValidationError('INVALID_SVG');
  }

  const output = [];
  const stack = [];
  let rootSeen = false;
  let rootClosed = false;

  try {
    const styleRules = collectStyleRules(markup);
    const parser = new SaxesParser({ xmlns: true });

    parser.on('doctype', () => {
      throw new SvgValidationError('INVALID_SVG');
    });

    parser.on('opentag', (tag) => {
      if (!rootSeen) {
        rootSeen = true;
        if (tag.local !== 'svg' || (tag.uri && tag.uri !== SVG_NAMESPACE)) {
          throw new SvgValidationError('INVALID_SVG');
        }
      } else if (rootClosed) {
        throw new SvgValidationError('INVALID_SVG');
      }

      const parentAllowed = stack.length === 0 || stack[stack.length - 1].allowed;
      const allowed =
        parentAllowed &&
        ALLOWED_ELEMENTS.has(tag.local) &&
        (!tag.uri || tag.uri === SVG_NAMESPACE);
      stack.push({ allowed, name: tag.local });
      if (!allowed) return;

      const attributes = new Map(
        Object.values(tag.attributes)
          .filter(isAllowedAttribute)
          .map((attribute) => [attribute.name, attribute.value.trim()])
      );
      const classes = (attributes.get('class') || '').split(/\s+/).filter(Boolean);
      for (const rule of styleRules) {
        if (!classes.includes(rule.className)) continue;
        for (const [property, value] of rule.declarations) {
          attributes.set(property, value);
        }
      }
      const serializedAttributes = Array.from(attributes)
        .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
        .join('');
      output.push(`<${tag.local}${serializedAttributes}>`);
    });

    parser.on('text', (text) => {
      const current = stack[stack.length - 1];
      if (current?.allowed && (current.name === 'title' || current.name === 'desc')) {
        output.push(escapeText(text));
      }
    });

    parser.on('closetag', () => {
      const current = stack.pop();
      if (current?.allowed) output.push(`</${current.name}>`);
      if (stack.length === 0) rootClosed = true;
    });

    parser.on('error', () => {
      throw new SvgValidationError('INVALID_SVG');
    });

    parser.write(markup).close();
  } catch (error) {
    if (error instanceof SvgValidationError) throw error;
    throw new SvgValidationError('INVALID_SVG');
  }

  if (!rootSeen || !rootClosed || stack.length !== 0 || !output.length) {
    throw new SvgValidationError('INVALID_SVG');
  }

  return output.join('');
}

module.exports = {
  SvgValidationError,
  sanitizeSvg,
};
