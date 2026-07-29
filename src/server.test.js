const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

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
