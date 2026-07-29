const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

jest.mock('axios');
jest.mock('./services/newsScraper');

function loadApp() {
  jest.resetModules();
  return require('./server');
}

async function withHttpServer(app, callback) {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const { port } = server.address();
    return await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function getAvailablePort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const { port } = server.address();
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

function createChildCleanup(child) {
  let settled = false;
  let fallbackTimeout = null;
  let resolveCompletion;
  const completion = new Promise((resolve) => {
    resolveCompletion = resolve;
  });

  const settle = () => {
    if (settled) return;
    settled = true;
    if (fallbackTimeout) clearTimeout(fallbackTimeout);
    child.off('close', settle);
    child.off('exit', settle);
    child.off('error', settle);
    resolveCompletion();
  };

  child.once('close', settle);
  child.once('exit', settle);
  child.once('error', settle);

  return async () => {
    if (settled || child.exitCode !== null || child.signalCode !== null) {
      settle();
      return completion;
    }

    let killSent = false;
    try {
      killSent = child.kill();
    } catch (_) {
      settle();
    }

    if (!killSent) {
      settle();
    } else if (!settled) {
      fallbackTimeout = setTimeout(settle, 1000);
    }

    return completion;
  };
}

function waitForStartup(child, expectedMessage) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      reject(new Error(`Servidor não iniciou a tempo. stdout: ${stdout}; stderr: ${stderr}`));
    }, 5000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (stdout.includes(expectedMessage)) {
        clearTimeout(timeout);
        resolve(stdout);
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code) => {
      if (!stdout.includes(expectedMessage)) {
        clearTimeout(timeout);
        reject(new Error(`Servidor encerrou com código ${code}. stderr: ${stderr}`));
      }
    });
  });
}

describe('aplicação Express', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('importar a aplicação não abre a porta configurada', () => {
    jest.resetModules();
    const express = require('express');
    const listenSpy = jest.spyOn(express.application, 'listen');

    try {
      const app = require('./server');
      expect(typeof app).toBe('function');
      expect(listenSpy).not.toHaveBeenCalled();
    } finally {
      listenSpy.mockRestore();
    }
  });

  test('pode ser usada por um teste HTTP sem a porta configurada', async () => {
    const app = loadApp();

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/`);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(await response.text()).toContain('<title>Maker</title>');
    });
  });

  test('mantém as rotas de templates e notícias registradas', async () => {
    const app = loadApp();

    await withHttpServer(app, async (baseUrl) => {
      const templatesResponse = await fetch(`${baseUrl}/api/templates`);
      expect(templatesResponse.status).toBe(200);
      expect(Array.isArray(await templatesResponse.json())).toBe(true);

      const newsResponse = await fetch(`${baseUrl}/api/news/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(newsResponse.status).toBe(400);
      await expect(newsResponse.json()).resolves.toEqual({
        error: 'URL é obrigatória',
      });
    });
  });

  test('lista os templates atuais com os dados do manifest', async () => {
    const app = loadApp();

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/templates`);
      const templates = await response.json();
      const layoutBbc = templates.find((entry) => entry.template === 'layout-bbc');

      expect(response.status).toBe(200);
      expect(layoutBbc).toEqual({
        template: 'layout-bbc',
        pages: [
          {
            name: 'index',
            logoField: 'logo',
            defaultLogo: 'logo-a-gazeta.svg',
            dimensions: { width: 1080, height: 1920 },
          },
        ],
      });
      expect(require('axios').get).not.toHaveBeenCalled();
    });
  });

  test('carrega HTML, CSS, manifest e logo de uma página válida', async () => {
    const app = loadApp();

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/templates/layout-bbc/index`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.template).toBe('layout-bbc');
      expect(body.page).toBe('index');
      expect(body.manifest).toMatchObject({
        name: 'Layout BBC - index',
        dimensions: { width: 1080, height: 1920 },
      });
      expect(body.html).toContain('<title>Layout BBC</title>');
      expect(body.css.map((file) => file.name)).toEqual([path.join('css', 'base.css')]);
      expect(body.resolvedLogo).toMatchObject({ kind: 'inline-svg' });
      expect(body.resolvedLogo.markup).toContain('<svg');
      expect(require('axios').get).not.toHaveBeenCalled();
    });
  });

  test.each([
    ['/api/templates/template-inexistente/index', 'Template não encontrado'],
    ['/api/templates/layout-bbc/pagina-inexistente', 'Página do template não encontrada'],
  ])('responde 404 para recurso de template ausente em %s', async (route, detail) => {
    const app = loadApp();

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}${route}`);
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe('Template nǜo encontrado');
      expect(body.detail).toContain(detail);
      expect(require('axios').get).not.toHaveBeenCalled();
    });
  });

  test('exige URL em POST /api/news/extract sem chamar o scraper', async () => {
    const app = loadApp();

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/news/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: 'URL é obrigatória' });
      expect(require('./services/newsScraper').fetch).not.toHaveBeenCalled();
      expect(require('axios').get).not.toHaveBeenCalled();
    });
  });

  test.each([{}, { url: 'ftp://example.com/image.png' }])(
    'rejeita URL de imagem inválida em POST /api/news/embed-image',
    async (requestBody) => {
      const app = loadApp();

      await withHttpServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/news/embed-image`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({
          error: 'URL de imagem inválida',
        });
        expect(require('axios').get).not.toHaveBeenCalled();
      });
    }
  );

  test('converte erro do parser JSON pelo middleware global', async () => {
    const app = loadApp();
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/news/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      });
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body).toEqual({
        error: 'Erro interno do servidor',
        detail: expect.any(String),
      });
      expect(body.detail).not.toBe('');
      expect(consoleError).toHaveBeenCalled();
      expect(require('./services/newsScraper').fetch).not.toHaveBeenCalled();
      expect(require('axios').get).not.toHaveBeenCalled();
    });
  });

  test('o entrypoint inicia o servidor na porta configurada', async () => {
    const port = await getAvailablePort();
    const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, PORT: String(port) },
      windowsHide: true,
    });
    const cleanupChild = createChildCleanup(child);
    const startupMessage = `Servidor rodando em http://localhost:${port}`;

    try {
      await expect(waitForStartup(child, startupMessage)).resolves.toContain(startupMessage);
      const response = await fetch(`http://127.0.0.1:${port}/`);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('<title>Maker</title>');
    } finally {
      await cleanupChild();
    }
  });
});
