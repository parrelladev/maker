const fs = require('fs');
const path = require('path');
const { sanitizeSvg } = require('./svgSanitizer');

describe('sanitizeSvg', () => {
  test('preserva a estrutura visual básica de um logo válido', () => {
    const result = sanitizeSvg(`<?xml version="1.0" encoding="UTF-8"?>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
        <defs><clipPath id="clip"><rect width="20" height="20"/></clipPath></defs>
        <g class="logo" clip-path="url(#clip)">
          <title>Logo segura</title>
          <path fill="#fff" d="M0 0h20v20H0z"/>
        </g>
      </svg>
    `);

    expect(result).toContain('<svg');
    expect(result).toContain('viewBox="0 0 20 20"');
    expect(result).toContain('clip-path="url(#clip)"');
    expect(result).toContain('<title>Logo segura</title>');
    expect(result).toContain('<path');
  });

  test.each([
    'logo-a-gazeta.svg',
    'logo-fonte-hub.svg',
    'logo-rede-gazeta-a-gazeta.svg',
    'logo-rede-gazeta.svg',
  ])('preserva o SVG local existente %s', (filename) => {
    const markup = fs.readFileSync(path.resolve('input', filename), 'utf8');
    const result = sanitizeSvg(markup, { maxBytes: 1024 * 1024 });

    expect(result).toMatch(/^<svg\b/);
    expect(result).toContain('<path');
    expect(result).not.toMatch(
      /<style|<script|<foreignObject|\son[a-z]+=|(?:fill|stroke|href|clip-path)="[^"]*(?:https?:|javascript:|data:)/i
    );
    if (filename === 'logo-rede-gazeta.svg') {
      expect(result).toContain('fill="#ffffff"');
    } else {
      const styledPaths = result.match(/<path[^>]*class="cls-1"[^>]*>/g) || [];
      expect(styledPaths.length).toBeGreaterThan(0);
      expect(styledPaths).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/\sfill="#fff"/),
        ])
      );
      expect(styledPaths.every((pathMarkup) => /\sfill="#fff"/.test(pathMarkup))).toBe(true);
    }
    expect(sanitizeSvg(result, { maxBytes: 1024 * 1024 })).toBe(result);
  });

  test('remove scripts, handlers e foreignObject com seus descendentes', () => {
    const result = sanitizeSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" onload="steal()">
        <script>alert(1)</script>
        <foreignObject><iframe src="https://evil.test"></iframe></foreignObject>
        <path onclick="steal()" d="M0 0h1v1z"/>
      </svg>
    `);

    expect(result).not.toMatch(/script|onload|onclick|foreignObject|iframe|evil\.test/i);
    expect(result).toContain('<path');
  });

  test('remove referências externas e URLs perigosas, preservando fragmentos locais', () => {
    const result = sanitizeSvg(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <defs><path id="shape" d="M0 0h1v1z"/></defs>
        <use href="#shape"/>
        <use href="https://evil.test/shape.svg#id"/>
        <path fill="url(javascript:alert(1))" stroke="url(https://evil.test/a)"/>
        <image href="data:image/svg+xml,&lt;svg onload='steal()'/>"/>
      </svg>
    `);

    expect(result).toContain('href="#shape"');
    expect(result).not.toMatch(/javascript:|https:\/\/evil|data:image|<image/i);
  });

  test.each([
    String.raw`u\72l(https://evil.test/x)`,
    String.raw`u\000072l(https://evil.test/x)`,
    'URL(https://evil.test/x)',
    'UrL(https://evil.test/x)',
    'url( https://evil.test/x )',
    'u/**/rl(https://evil.test/x)',
    'url(data:image/svg+xml,evil)',
    'url(javascript:alert(1))',
    'url(//evil.test/x)',
    'url(#)',
    'url(#fragmento invalido)',
  ])('remove valor de pintura ou referência ambíguo: %s', (value) => {
    const result = sanitizeSvg(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <path fill="${value}" stroke="${value}" d="M0 0h1v1z"/>
        <g clip-path="${value}" filter="${value}" mask="${value}"
          marker-start="${value}" marker-mid="${value}" marker-end="${value}">
          <path stop-color="${value}" d="M0 0h1v1z"/>
        </g>
      </svg>
    `);

    expect(result).not.toContain(value);
    expect(result).not.toMatch(/evil\.test|javascript:|data:image|\\72|\/\*\*\//i);
  });

  test('preserva somente referência local em sintaxe canônica', () => {
    const result = sanitizeSvg(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <defs><clipPath id="fragmento-valido"><rect width="10" height="10"/></clipPath></defs>
        <g clip-path="url(#fragmento-valido)"><path fill="currentColor" d="M0 0h1v1z"/></g>
      </svg>
    `);

    expect(result).toContain('clip-path="url(#fragmento-valido)"');
    expect(result).toContain('fill="currentColor"');
  });

  test('converte regra local simples em atributo e remove o elemento style', () => {
    const result = sanitizeSvg(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <defs><style>.cls-1 { fill: #fff; }</style></defs>
        <path class="cls-1" d="M0 0h1v1z"/>
      </svg>
    `);

    expect(result).toContain('<path class="cls-1" d="M0 0h1v1z" fill="#fff">');
    expect(result).not.toContain('<style');
  });

  test.each([
    '.wrapper .cls-1 { fill: #fff; }',
    '.cls-1:hover { fill: #fff; }',
    '@import url(https://evil.test/style.css); .cls-1 { fill: #fff; }',
    '.cls-1 { fill: var(--logo-color); }',
    '.cls-1 { fill: #fff !important; }',
  ])('descarta integralmente CSS local fora do subconjunto seguro: %s', (css) => {
    const result = sanitizeSvg(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <style>${css}</style>
        <path class="cls-1" d="M0 0h1v1z"/>
      </svg>
    `);

    expect(result).not.toContain('<style');
    expect(result).not.toContain('fill=');
    expect(result).not.toMatch(/evil\.test|var\(|important/i);
  });

  test('remove estilos capazes de introduzir URLs ou conteúdo ativo', () => {
    const result = sanitizeSvg(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <style>@import url(https://evil.test/style.css);</style>
        <path class="safe" style="fill:url(javascript:alert(1))" d="M0 0h1v1z"/>
      </svg>
    `);

    expect(result).not.toMatch(/<style|@import|style=|javascript:/i);
    expect(result).toContain('class="safe"');
  });

  test.each([
    '<svg><g></svg>',
    '<svg><path></svg junk>',
    '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg>&xxe;</svg>',
    '<html><svg/></html>',
  ])('rejeita XML inválido ou documento sem raiz SVG: %s', (markup) => {
    expect(() => sanitizeSvg(markup)).toThrow(
      expect.objectContaining({
        code: 'INVALID_SVG',
        message: 'Conteúdo SVG inválido ou não permitido',
      })
    );
  });

  test('rejeita conteúdo acima do limite configurado', () => {
    expect(() =>
      sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"></svg>', {
        maxBytes: 10,
      })
    ).toThrow(
      expect.objectContaining({
        code: 'SVG_TOO_LARGE',
        message: 'Conteúdo SVG excede o limite permitido',
      })
    );
  });

  test('é idempotente para SVG já sanitizado', () => {
    const result = sanitizeSvg(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <style>.cls-1 { fill: #fff; }</style>
        <path class="cls-1" d="M0 0h1v1z"/>
      </svg>
    `);

    expect(sanitizeSvg(result)).toBe(result);
  });
});
