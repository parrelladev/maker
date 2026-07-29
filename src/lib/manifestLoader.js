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

async function listTemplates() {
  if (!(await exists(TEMPLATE_ROOT))) {
    return [];
  }

  const templateEntries = await fs.readdir(TEMPLATE_ROOT, { withFileTypes: true });
  const templates = [];

  for (const templateName of templateEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)) {
    const templateDir = path.join(TEMPLATE_ROOT, templateName);
    const pageEntries = await fs.readdir(templateDir, { withFileTypes: true });
    const pages = [];

    for (const pageName of pageEntries
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name)) {
      const manifestPath = getManifestPath(templateName, pageName);
      if (!(await exists(manifestPath))) {
        continue;
      }
      try {
        const manifest = await readJson(manifestPath);
        pages.push({
          name: pageName,
          manifest,
          manifestPath,
          htmlPath: path.join(templateDir, pageName, 'index.html'),
        });
      } catch (error) {
        pages.push({
          name: pageName,
          manifestError: error.message,
          manifestPath,
          htmlPath: path.join(templateDir, pageName, 'index.html'),
        });
      }
    }

    templates.push({ template: templateName, pages });
  }

  return templates;
}

module.exports = {
  loadManifest,
  listTemplates,
};
