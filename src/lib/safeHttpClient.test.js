const http = require('http');
const { callbackify } = require('util');
const axios = require('axios');
const {
  SafeHttpError,
  createSafeHttpClient,
  isPublicIp,
  parseAndValidateUrl,
} = require('./safeHttpClient');

function response(data = 'ok', status = 200, headers = {}) {
  return { data, headers, status };
}

function createHarness(addresses = [{ address: '93.184.216.34', family: 4 }]) {
  const httpClient = { get: jest.fn().mockResolvedValue(response()) };
  const resolveHostname = jest.fn().mockResolvedValue(addresses);
  return {
    httpClient,
    resolveHostname,
    client: createSafeHttpClient({ httpClient, resolveHostname }),
  };
}

const requestOptions = {
  timeout: 1000,
  maxBytes: 1024,
  maxRedirects: 2,
  responseType: 'text',
};
const publicAddresses = [{ address: '93.184.216.34', family: 4 }];

describe('safeHttpClient', () => {
  test.each([
    ['URL malformada', 'não é uma URL'],
    ['valor não string', ['https://example.com/file']],
  ])('rejeita %s antes da resolução', async (_, value) => {
    const { client, httpClient, resolveHostname } = createHarness();

    await expect(client.get(value, requestOptions)).rejects.toMatchObject({
      code: 'INVALID_URL',
    });
    expect(resolveHostname).not.toHaveBeenCalled();
    expect(httpClient.get).not.toHaveBeenCalled();
  });

  test.each(['ftp://example.com/file', 'file:///tmp/file', 'data:text/plain,ok'])(
    'rejeita protocolo não permitido: %s',
    async (url) => {
      const { client, httpClient } = createHarness();

      await expect(client.get(url, requestOptions)).rejects.toMatchObject({
        code: 'UNSUPPORTED_PROTOCOL',
      });
      expect(httpClient.get).not.toHaveBeenCalled();
    }
  );

  test('rejeita credenciais embutidas', async () => {
    const { client, httpClient } = createHarness();

    await expect(
      client.get('https://user:password@example.com/file', requestOptions)
    ).rejects.toMatchObject({ code: 'URL_CREDENTIALS' });
    expect(httpClient.get).not.toHaveBeenCalled();
  });

  test('lookup Promise-based preserva endereço e family pelo contrato callbackify do Axios', async () => {
    const { client, httpClient, resolveHostname } = createHarness();
    await client.get('https://example.com/file', requestOptions);

    expect(resolveHostname).toHaveBeenCalledWith('example.com');
    const config = httpClient.get.mock.calls[0][1];
    expect(config.lookup).toHaveLength(1);

    const lookupResult = await new Promise((resolve, reject) => {
      callbackify(config.lookup)('example.com', {}, (error, result) =>
        error ? reject(error) : resolve(result)
      );
    });
    expect(lookupResult).toEqual({ address: '93.184.216.34', family: 4 });
    await expect(config.lookup('example.com', { family: 4 })).resolves.toEqual({
      address: '93.184.216.34',
      family: 4,
    });
    await expect(config.lookup('example.com', { all: true })).resolves.toEqual([
      { address: '93.184.216.34', family: 4 },
    ]);
    expect(resolveHostname).toHaveBeenCalledTimes(1);
    expect(config.proxy).toBe(false);
  });

  test.each([
    ['0.0.0.0', false],
    ['10.0.0.1', false],
    ['100.64.0.1', false],
    ['127.0.0.1', false],
    ['169.254.1.1', false],
    ['172.16.0.1', false],
    ['192.168.0.1', false],
    ['192.0.2.1', false],
    ['198.18.0.1', false],
    ['198.51.100.1', false],
    ['203.0.113.1', false],
    ['224.0.0.1', false],
    ['240.0.0.1', false],
    ['8.8.8.8', true],
    ['::', false],
    ['::1', false],
    ['fe80::1', false],
    ['fc00::1', false],
    ['ff02::1', false],
    ['2001::1', false],
    ['2001:1::1', true],
    ['2001:1::2', true],
    ['2001:1::3', true],
    ['2001:1::4', false],
    ['2001:2::1', false],
    ['2001:3::1', true],
    ['2001:4:112::1', true],
    ['2001:10::1', false],
    ['2001:20::1', true],
    ['2001:30::1', true],
    ['2002:0808:0808::1', false],
    ['2001:db8::1', false],
    ['2001:4860:4860::8888', true],
    ['::ffff:127.0.0.1', false],
    ['::ffff:8.8.8.8', true],
  ])('classifica endereço %s como público=%s', (address, expected) => {
    expect(isPublicIp(address)).toBe(expected);
  });

  test('rejeita quando qualquer resposta DNS é privada', async () => {
    const { client, httpClient } = createHarness([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.10', family: 4 },
    ]);

    await expect(client.get('https://example.com/file', requestOptions)).rejects.toMatchObject({
      code: 'BLOCKED_ADDRESS',
    });
    expect(httpClient.get).not.toHaveBeenCalled();
  });

  test.each([
    'http://127.0.0.1/file',
    'http://169.254.169.254/file',
    'http://10.0.0.1/file',
    'http://[::1]/file',
  ])('rejeita destino literal não público antes da requisição: %s', async (url) => {
    const { client, httpClient, resolveHostname } = createHarness();

    await expect(client.get(url, requestOptions)).rejects.toMatchObject({
      code: 'BLOCKED_ADDRESS',
    });
    expect(resolveHostname).not.toHaveBeenCalled();
    expect(httpClient.get).not.toHaveBeenCalled();
  });

  test('rejeita erro de resolução DNS com classificação estável', async () => {
    const { client, httpClient, resolveHostname } = createHarness();
    resolveHostname.mockRejectedValue(new Error('getaddrinfo ENOTFOUND internal'));

    await expect(client.get('https://example.com/file', requestOptions)).rejects.toMatchObject({
      code: 'DNS_ERROR',
      message: 'Não foi possível resolver o destino',
    });
    expect(httpClient.get).not.toHaveBeenCalled();
  });

  test('valida novamente hostname resolvido após redirect', async () => {
    const httpClient = { get: jest.fn().mockResolvedValueOnce(
      response('', 302, { location: 'https://redirect.example/file' })
    ) };
    const resolveHostname = jest.fn(async (hostname) =>
      hostname === 'redirect.example'
        ? [{ address: '10.0.0.20', family: 4 }]
        : [{ address: '93.184.216.34', family: 4 }]
    );
    const client = createSafeHttpClient({ httpClient, resolveHostname });

    await expect(client.get('https://example.com/file', requestOptions)).rejects.toMatchObject({
      code: 'BLOCKED_ADDRESS',
    });
    expect(httpClient.get).toHaveBeenCalledTimes(1);
  });

  test('segue redirect público relativo após validar o novo salto', async () => {
    const { client, httpClient, resolveHostname } = createHarness();
    httpClient.get
      .mockResolvedValueOnce(response('', 302, { location: '/next' }))
      .mockResolvedValueOnce(response('redirect-ok'));

    await expect(
      client.get('https://example.com/start', requestOptions)
    ).resolves.toMatchObject({ data: 'redirect-ok' });

    expect(httpClient.get.mock.calls.map(([url]) => url)).toEqual([
      'https://example.com/start',
      'https://example.com/next',
    ]);
    expect(resolveHostname).toHaveBeenCalledTimes(2);
  });

  test('rejeita IP privado e credenciais introduzidos por redirect', async () => {
    const { client, httpClient } = createHarness();
    httpClient.get
      .mockResolvedValueOnce(response('', 302, { location: 'http://127.0.0.1/file' }));

    await expect(client.get('https://example.com/file', requestOptions)).rejects.toMatchObject({
      code: 'BLOCKED_ADDRESS',
    });

    httpClient.get.mockReset();
    httpClient.get.mockResolvedValueOnce(
      response('', 302, { location: 'https://user:password@example.com/file' })
    );

    await expect(client.get('https://example.com/file', requestOptions)).rejects.toMatchObject({
      code: 'URL_CREDENTIALS',
    });
  });

  test('rejeita protocolo introduzido por redirect', async () => {
    const { client, httpClient } = createHarness();
    httpClient.get.mockResolvedValueOnce(
      response('', 302, { location: 'file:///tmp/file' })
    );

    await expect(client.get('https://example.com/file', requestOptions)).rejects.toMatchObject({
      code: 'UNSUPPORTED_PROTOCOL',
    });
  });

  test('configura timeout, limite de bytes e redirects no cliente HTTP', async () => {
    const { client, httpClient } = createHarness();

    await client.get('https://example.com/file', requestOptions);

    expect(httpClient.get.mock.calls[0][1]).toMatchObject({
      maxContentLength: 1024,
      maxBodyLength: 1024,
      maxRedirects: 0,
      proxy: false,
    });
    expect(httpClient.get.mock.calls[0][1].timeout).toBeGreaterThan(0);
    expect(httpClient.get.mock.calls[0][1].timeout).toBeLessThanOrEqual(1000);
  });

  test('limita redirects gerenciados e valida cada salto antes da conexão', async () => {
    const { client, httpClient, resolveHostname } = createHarness();
    httpClient.get
      .mockResolvedValueOnce(response('', 302, { location: 'https://one.example/file' }))
      .mockResolvedValueOnce(response('', 302, { location: 'https://two.example/file' }))
      .mockResolvedValueOnce(response('', 302, { location: 'https://three.example/file' }));

    await expect(client.get('https://example.com/file', requestOptions)).rejects.toMatchObject({
      code: 'TOO_MANY_REDIRECTS',
    });
    expect(httpClient.get).toHaveBeenCalledTimes(3);
    expect(resolveHostname.mock.calls.map(([hostname]) => hostname)).toEqual([
      'example.com',
      'one.example',
      'two.example',
    ]);
  });

  test.each([
    [{ code: 'ECONNABORTED' }, 'TIMEOUT'],
    [{ code: 'ERR_FR_TOO_MANY_REDIRECTS' }, 'TOO_MANY_REDIRECTS'],
    [
      { code: 'ERR_BAD_RESPONSE', message: 'maxContentLength size exceeded' },
      'RESPONSE_TOO_LARGE',
    ],
    [{ response: { status: 503 } }, 'HTTP_STATUS'],
    [{ code: 'ECONNRESET' }, 'REQUEST_FAILED'],
  ])('classifica falha do cliente como %s', async (errorFields, expectedCode) => {
    const { client, httpClient } = createHarness();
    httpClient.get.mockRejectedValue(Object.assign(new Error('falha simulada'), errorFields));

    await expect(client.get('https://example.com/file', requestOptions)).rejects.toMatchObject({
      code: expectedCode,
    });
  });

  test('mantém mensagens classificadas sem detalhes internos da causa', () => {
    expect(
      new SafeHttpError('DNS_ERROR', { cause: new Error('internal.host.local') }).message
    ).toBe('Não foi possível resolver o destino');
  });
});

describe('deadline global do safeHttpClient', () => {
  test('DNS pendente termina com TIMEOUT', async () => {
    const client = createSafeHttpClient({
      httpClient: { get: jest.fn() },
      resolveHostname: () => new Promise(() => {}),
    });

    await expect(
      client.get('https://example.com/file', {
        ...requestOptions,
        timeout: 10,
      })
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  test('DNS que conclui depois da deadline produz TIMEOUT sem rejeição tardia', async () => {
    jest.useFakeTimers();
    try {
      const resolveHostname = jest.fn(
        () => new Promise((resolve) => setTimeout(() => resolve(publicAddresses), 20))
      );
      const client = createSafeHttpClient({
        httpClient: { get: jest.fn() },
        resolveHostname,
        now: () => Date.now(),
      });

      const result = client.get('https://example.com/file', {
        ...requestOptions,
        timeout: 10,
      });
      const timedOut = expect(result).rejects.toMatchObject({ code: 'TIMEOUT' });
      await jest.advanceTimersByTimeAsync(10);
      await timedOut;
      await jest.advanceTimersByTimeAsync(10);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  test('DNS que conclui antes da deadline permite continuar', async () => {
    jest.useFakeTimers();
    try {
      const httpClient = { get: jest.fn().mockResolvedValue(response('ok')) };
      const resolveHostname = jest.fn(
        () => new Promise((resolve) => setTimeout(() => resolve(publicAddresses), 5))
      );
      const client = createSafeHttpClient({
        httpClient,
        resolveHostname,
        now: () => Date.now(),
      });

      const result = client.get('https://example.com/file', {
        ...requestOptions,
        timeout: 20,
      });
      await jest.advanceTimersByTimeAsync(5);

      await expect(result).resolves.toMatchObject({ data: 'ok' });
      expect(httpClient.get.mock.calls[0][1].timeout).toBe(15);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  test('deadline expirada rejeita antes de resolver DNS', async () => {
    const now = jest.fn().mockReturnValueOnce(0).mockReturnValue(1001);
    const resolveHostname = jest.fn();
    const client = createSafeHttpClient({
      httpClient: { get: jest.fn() },
      resolveHostname,
      now,
    });

    await expect(
      client.get('https://example.com/file', requestOptions)
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(resolveHostname).not.toHaveBeenCalled();
  });

  test('redirects consomem o mesmo orçamento e repassam apenas o saldo', async () => {
    let elapsedMs = 0;
    const now = () => elapsedMs;
    const resolveHostname = jest.fn(async () => {
      elapsedMs += 100;
      return publicAddresses;
    });
    const httpClient = {
      get: jest
        .fn()
        .mockImplementationOnce(async () => {
          elapsedMs += 300;
          return response('', 302, { location: 'https://next.example/file' });
        })
        .mockImplementationOnce(async () => {
          elapsedMs += 600;
          return response('late');
        }),
    };
    const client = createSafeHttpClient({ httpClient, resolveHostname, now });

    await expect(
      client.get('https://example.com/file', requestOptions)
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(httpClient.get.mock.calls.map(([, config]) => config.timeout)).toEqual([
      900,
      500,
    ]);
  });

  test('DNS, redirect e resposta dentro da deadline continuam funcionando', async () => {
    let elapsedMs = 0;
    const now = () => elapsedMs;
    const resolveHostname = jest.fn(async () => {
      elapsedMs += 100;
      return publicAddresses;
    });
    const httpClient = {
      get: jest
        .fn()
        .mockImplementationOnce(async () => {
          elapsedMs += 100;
          return response('', 302, { location: 'https://next.example/file' });
        })
        .mockImplementationOnce(async () => {
          elapsedMs += 100;
          return response('within-deadline');
        }),
    };
    const client = createSafeHttpClient({ httpClient, resolveHostname, now });

    await expect(
      client.get('https://example.com/file', requestOptions)
    ).resolves.toMatchObject({ data: 'within-deadline' });
    expect(httpClient.get.mock.calls.map(([, config]) => config.timeout)).toEqual([
      900,
      700,
    ]);
  });

  test('remove timers após sucesso, erros, redirect e timeout', async () => {
    jest.useFakeTimers();
    try {
      const successClient = createSafeHttpClient({
        httpClient: { get: jest.fn().mockResolvedValue(response()) },
        resolveHostname: jest.fn().mockResolvedValue(publicAddresses),
        now: () => Date.now(),
      });
      await successClient.get('https://example.com/file', requestOptions);
      expect(jest.getTimerCount()).toBe(0);

      const dnsErrorClient = createSafeHttpClient({
        httpClient: { get: jest.fn() },
        resolveHostname: jest.fn().mockRejectedValue(new Error('dns error')),
        now: () => Date.now(),
      });
      await expect(
        dnsErrorClient.get('https://example.com/file', requestOptions)
      ).rejects.toMatchObject({ code: 'DNS_ERROR' });
      expect(jest.getTimerCount()).toBe(0);

      const axiosErrorClient = createSafeHttpClient({
        httpClient: { get: jest.fn().mockRejectedValue(new Error('request error')) },
        resolveHostname: jest.fn().mockResolvedValue(publicAddresses),
        now: () => Date.now(),
      });
      await expect(
        axiosErrorClient.get('https://example.com/file', requestOptions)
      ).rejects.toMatchObject({ code: 'REQUEST_FAILED' });
      expect(jest.getTimerCount()).toBe(0);

      const redirectHttpClient = {
        get: jest
          .fn()
          .mockResolvedValueOnce(response('', 302, { location: '/next' }))
          .mockResolvedValueOnce(response()),
      };
      const redirectClient = createSafeHttpClient({
        httpClient: redirectHttpClient,
        resolveHostname: jest.fn().mockResolvedValue(publicAddresses),
        now: () => Date.now(),
      });
      await redirectClient.get('https://example.com/file', requestOptions);
      expect(jest.getTimerCount()).toBe(0);

      const timeoutClient = createSafeHttpClient({
        httpClient: { get: jest.fn() },
        resolveHostname: () => new Promise(() => {}),
        now: () => Date.now(),
      });
      const timedOut = timeoutClient.get('https://example.com/file', {
        ...requestOptions,
        timeout: 10,
      });
      const timeoutExpectation = expect(timedOut).rejects.toMatchObject({
        code: 'TIMEOUT',
      });
      await jest.advanceTimersByTimeAsync(10);
      await timeoutExpectation;
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('safeHttpClient com adaptador Axios real', () => {
  test('usa o endereço validado no socket e preserva Host', async () => {
    const sockets = new Set();
    let observedRequest;
    const server = http.createServer((req, res) => {
      observedRequest = {
        host: req.headers.host,
        localAddress: req.socket.localAddress,
      };
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });

    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const { port } = server.address();
      const resolveHostname = jest.fn().mockResolvedValue([
        { address: '127.0.0.1', family: 4 },
      ]);
      const isAddressAllowed = jest.fn((address) => address === '127.0.0.1');
      const client = createSafeHttpClient({
        httpClient: axios,
        resolveHostname,
        isAddressAllowed,
      });

      await expect(
        client.get(`http://public.example.test:${port}/fixture`, requestOptions)
      ).resolves.toMatchObject({ data: 'ok', status: 200 });

      expect(resolveHostname).toHaveBeenCalledWith('public.example.test');
      expect(isAddressAllowed).toHaveBeenCalledWith('127.0.0.1');
      expect(observedRequest).toEqual({
        host: `public.example.test:${port}`,
        localAddress: '127.0.0.1',
      });
    } finally {
      for (const socket of sockets) socket.destroy();
      if (server.listening) {
        await new Promise((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      }
    }
  });
});

describe('parseAndValidateUrl', () => {
  test('preserva URL HTTP pública válida', () => {
    expect(parseAndValidateUrl('http://example.com/path').href).toBe(
      'http://example.com/path'
    );
  });
});
