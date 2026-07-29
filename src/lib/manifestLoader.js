const fs = require('fs').promises;
const path = require('path');

const TEMPLATE_ROOT = path.resolve('templates');

function getManifestPath(template, page) {
  return path.join(TEMPLATE_ROOT, template, page, 'manifest.json');
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

async function ensureTemplateExists(templateDir, pageDir) {
  if (!(await exists(templateDir))) {
    throw new Error(`Template não encontrado: ${templateDir}`);
  }
  if (!(await exists(pageDir))) {
    throw new Error(`Página do template não encontrada: ${pageDir}`);
  }
}

async function loadManifest(template, page) {
  const manifestPath = getManifestPath(template, page);
  const templateDir = path.join(TEMPLATE_ROOT, template);
  const pageDir = path.dirname(manifestPath);
  const htmlPath = path.join(pageDir, 'index.html');

  await ensureTemplateExists(templateDir, pageDir);

  if (!(await exists(manifestPath))) {
    throw new Error(`Manifesto não encontrado em ${manifestPath}`);
  }
  if (!(await exists(htmlPath))) {
    throw new Error(`index.html não encontrado para ${template}/${page}`);
  }

  const manifest = await readJson(manifestPath);
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
        const manifest = await readJson(manifestPath);
        pages.push({
          name: pageName,
          manifest,
          manifestPath,
          htmlPath,
        });
      } catch (error) {
        if (!(error instanceof SyntaxError)) {
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
