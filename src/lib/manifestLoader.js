const fs = require('fs').promises;
const path = require('path');
const {
  TemplateManifestInvalidError,
  TemplateNotFoundError,
  TemplateRequiredFileUnreadableError,
} = require('./templatePageErrors');
const {
  normalizeManifest,
  TemplateManifestSchemaError,
} = require('./templateManifest');

const TEMPLATE_ROOT = path.resolve('templates');

function isInvalidPathSegment(value) {
  return typeof value !== 'string'
    || value.length === 0
    || value === '.'
    || value === '..'
    || value.includes('/')
    || value.includes('\\')
    || value.includes('\0')
    || path.isAbsolute(value)
    || path.win32.isAbsolute(value);
}

function resolveTemplatePagePaths(template, page) {
  if (isInvalidPathSegment(template) || isInvalidPathSegment(page)) {
    throw new TemplateNotFoundError('Referência de template inválida');
  }

  const pageDir = path.resolve(TEMPLATE_ROOT, template, page);
  const relative = path.relative(TEMPLATE_ROOT, pageDir);
  if (
    relative === '..'
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) {
    throw new TemplateNotFoundError('Referência de template inválida');
  }

  return {
    templateDir: path.resolve(TEMPLATE_ROOT, template),
    pageDir,
    manifestPath: path.join(pageDir, 'manifest.json'),
    htmlPath: path.join(pageDir, 'index.html'),
  };
}

function getManifestPath(template, page) {
  return resolveTemplatePagePaths(template, page).manifestPath;
}

async function readJson(manifestPath) {
  const raw = await fs.readFile(manifestPath, 'utf-8');
  return JSON.parse(raw);
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch (_) {
    return false;
  }
}

async function ensureRequiredPath(target, notFoundMessage) {
  try {
    await fs.access(target);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      throw new TemplateNotFoundError(notFoundMessage, { cause: error });
    }
    throw new TemplateRequiredFileUnreadableError('Caminho obrigatório ilegível', {
      cause: error,
    });
  }
}

async function ensureTemplateExists(templateDir, pageDir) {
  await ensureRequiredPath(templateDir, `Template não encontrado: ${templateDir}`);
  await ensureRequiredPath(pageDir, `Página do template não encontrada: ${pageDir}`);
}

async function loadManifest(template, page) {
  const {
    templateDir,
    pageDir,
    manifestPath,
    htmlPath,
  } = resolveTemplatePagePaths(template, page);

  await ensureTemplateExists(templateDir, pageDir);

  await ensureRequiredPath(
    manifestPath,
    `Manifesto não encontrado em ${manifestPath}`
  );
  await ensureRequiredPath(
    htmlPath,
    `index.html não encontrado para ${template}/${page}`
  );

  let manifest;
  try {
    manifest = normalizeManifest(await readJson(manifestPath));
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TemplateManifestSchemaError) {
      throw new TemplateManifestInvalidError('Manifesto inválido', { cause: error });
    }
    throw new TemplateRequiredFileUnreadableError('Manifesto ilegível', { cause: error });
  }
  return {
    manifest,
    manifestPath,
    template,
    page,
    templateDir,
    pageDir,
    htmlPath,
  };
}

async function inspectTemplateCatalog() {
  if (!(await exists(TEMPLATE_ROOT))) {
    return { templates: [], diagnostics: [] };
  }

  const templateEntries = await fs.readdir(TEMPLATE_ROOT, { withFileTypes: true });
  const templates = [];
  const diagnostics = [];

  for (const templateName of templateEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)) {
    const templateDir = path.join(TEMPLATE_ROOT, templateName);
    const pageEntries = await fs.readdir(templateDir, { withFileTypes: true });
    const pages = [];

    for (const pageName of pageEntries
      .filter((dirent) => dirent.isDirectory())
      .filter((dirent) => !['css', 'fonts'].includes(dirent.name))
      .map((dirent) => dirent.name)) {
      const manifestPath = getManifestPath(templateName, pageName);
      const htmlPath = path.join(templateDir, pageName, 'index.html');

      if (!(await exists(manifestPath))) {
        diagnostics.push({
          template: templateName,
          page: pageName,
          code: 'TEMPLATE_MANIFEST_MISSING',
        });
        continue;
      }

      if (!(await exists(htmlPath))) {
        diagnostics.push({
          template: templateName,
          page: pageName,
          code: 'TEMPLATE_HTML_MISSING',
        });
        continue;
      }

      try {
        const manifest = normalizeManifest(await readJson(manifestPath));
        pages.push({
          name: pageName,
          manifest,
          manifestPath,
          htmlPath,
        });
      } catch (error) {
        if (!(error instanceof SyntaxError || error instanceof TemplateManifestSchemaError)) {
          throw error;
        }
        diagnostics.push({
          template: templateName,
          page: pageName,
          code: 'TEMPLATE_MANIFEST_INVALID',
        });
      }
    }

    if (pages.length > 0) {
      templates.push({ template: templateName, pages });
    }
  }

  return { templates, diagnostics };
}

async function listTemplates({ logger = console } = {}) {
  const { templates, diagnostics } = await inspectTemplateCatalog();
  for (const diagnostic of diagnostics) {
    logger.warn('[templates] página ignorada na listagem', diagnostic);
  }
  return templates;
}

module.exports = {
  inspectTemplateCatalog,
  loadManifest,
  listTemplates,
};
