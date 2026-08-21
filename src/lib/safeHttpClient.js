const dns = require('dns');
const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');
const { performance } = require('perf_hooks');
const axios = require('axios');

const ERROR_MESSAGES = {
  INVALID_URL: 'URL externa inválida',
  UNSUPPORTED_PROTOCOL: 'Protocolo de URL não permitido',
  URL_CREDENTIALS: 'Credenciais na URL não são permitidas',
  DNS_ERROR: 'Não foi possível resolver o destino',
  BLOCKED_ADDRESS: 'Destino de rede não permitido',
  TOO_MANY_REDIRECTS: 'Quantidade máxima de redirecionamentos excedida',
  TIMEOUT: 'Tempo limite da requisição externa excedido',
  RESPONSE_TOO_LARGE: 'Resposta externa excede o limite permitido',
  HTTP_STATUS: 'Servidor remoto retornou uma resposta inválida',
  UNEXPECTED_CONTENT_TYPE: 'Servidor remoto retornou um tipo de conteúdo inválido',
  EMPTY_RESPONSE: 'Servidor remoto retornou uma imagem vazia',
  INVALID_IMAGE_CONTENT: 'O conteúdo remoto não corresponde a uma imagem válida',
  REQUEST_FAILED: 'Falha na requisição externa',
};

class SafeHttpError extends Error {
  constructor(code, options = {}) {
    super(ERROR_MESSAGES[code] || ERROR_MESSAGES.REQUEST_FAILED);
    this.name = 'SafeHttpError';
    this.code = code;
    if (options.status !== undefined) this.status = options.status;
    if (options.cause) this.cause = options.cause;
  }
}

function ipv4ToNumber(address) {
  const parts = address.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return null;
  }
  return parts.reduce((value, part) => value * 256 + part, 0);
}

function ipv4InCidr(value, base, prefix) {
  const baseValue = ipv4ToNumber(base);
  const divisor = 2 ** (32 - prefix);
  return Math.floor(value / divisor) === Math.floor(baseValue / divisor);
}

function isPublicIpv4(address) {
  const value = ipv4ToNumber(address);
  if (value === null) return false;

  const blockedRanges = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.88.99.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ];

  return !blockedRanges.some(([base, prefix]) => ipv4InCidr(value, base, prefix));
}

function parseIpv6(address) {
  const normalized = address.toLowerCase().split('%')[0];
  const halves = normalized.split('::');
  if (halves.length > 2) return null;

  const parseHalf = (half) => {
    if (!half) return [];
    const groups = half.split(':');
    const last = groups[groups.length - 1];
    if (last.includes('.')) {
      const ipv4 = ipv4ToNumber(last);
      if (ipv4 === null) return null;
      groups.splice(groups.length - 1, 1, (ipv4 >>> 16).toString(16), (ipv4 & 0xffff).toString(16));
    }
    if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
    return groups.map((group) => Number.parseInt(group, 16));
  };

  const left = parseHalf(halves[0]);
  const right = parseHalf(halves[1] || '');
  if (!left || !right) return null;

  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) {
    return null;
  }

  const groups = [...left, ...Array(missing).fill(0), ...right];
  if (groups.length !== 8) return null;
  return groups.reduce((value, group) => (value << 16n) | BigInt(group), 0n);
}

function ipv6InCidr(value, base, prefix) {
  const baseValue = parseIpv6(base);
  const shift = BigInt(128 - prefix);
  return value >> shift === baseValue >> shift;
}

function isPublicIpv6(address) {
  const value = parseIpv6(address);
  if (value === null) return false;

  if (value >> 32n === 0xffffn) {
    const ipv4 = Number(value & 0xffffffffn);
    const addressV4 = [
      (ipv4 >>> 24) & 255,
      (ipv4 >>> 16) & 255,
      (ipv4 >>> 8) & 255,
      ipv4 & 255,
    ].join('.');
    return isPublicIpv4(addressV4);
  }

  if (value >> 125n !== 1n) return false;

  // Exceções "Globally Reachable" do registro especial da IANA:
  // https://www.iana.org/assignments/iana-ipv6-special-registry/
  const publicExceptions = [
    ['2001:1::1', 128],
    ['2001:1::2', 128],
    ['2001:1::3', 128],
    ['2001:3::', 32],
    ['2001:4:112::', 48],
    ['2001:20::', 28],
    ['2001:30::', 28],
  ];
  if (publicExceptions.some(([base, prefix]) => ipv6InCidr(value, base, prefix))) {
    return true;
  }

  const blockedRanges = [
    ['2001::', 23],
    ['2001:db8::', 32],
    ['2002::', 16],
    ['3fff::', 20],
  ];
  return !blockedRanges.some(([base, prefix]) => ipv6InCidr(value, base, prefix));
}

function isPublicIp(address) {
  const family = net.isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

function parseAndValidateUrl(value) {
  if (typeof value !== 'string') {
    throw new SafeHttpError('INVALID_URL');
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new SafeHttpError('INVALID_URL', { cause: error });
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SafeHttpError('UNSUPPORTED_PROTOCOL');
  }
  if (parsed.username || parsed.password) {
    throw new SafeHttpError('URL_CREDENTIALS');
  }
  return parsed;
}

function normalizeHostname(hostname) {
  const unwrapped = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  return unwrapped.toLowerCase().replace(/\.$/, '');
}

function assertContentType(value, allowedTypes) {
  const contentType = String(value || '').split(';', 1)[0].trim().toLowerCase();
  if (!allowedTypes.includes(contentType)) {
    throw new SafeHttpError('UNEXPECTED_CONTENT_TYPE');
  }
  return contentType;
}

function findSafeHttpError(error) {
  let current = error;
  while (current) {
    if (current instanceof SafeHttpError) return current;
    current = current.cause;
  }
  return null;
}

function classifyRequestError(error) {
  const safeError = findSafeHttpError(error);
  if (safeError) return safeError;

  if (error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT') {
    return new SafeHttpError('TIMEOUT', { cause: error });
  }
  if (error?.code === 'ERR_FR_TOO_MANY_REDIRECTS') {
    return new SafeHttpError('TOO_MANY_REDIRECTS', { cause: error });
  }
  if (
    error?.code === 'ERR_BAD_RESPONSE' &&
    /maxContentLength|larger than|max body length/i.test(error.message || '')
  ) {
    return new SafeHttpError('RESPONSE_TOO_LARGE', { cause: error });
  }
  if (error?.response?.status) {
    return new SafeHttpError('HTTP_STATUS', {
      cause: error,
      status: error.response.status,
    });
  }
  return new SafeHttpError('REQUEST_FAILED', { cause: error });
}

const FALLBACK_TRANSPORT_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'ETIMEDOUT',
  'ECONNABORTED',
]);
const DEFAULT_CONNECT_TIMEOUT_MS = 1000;

function findFallbackTransportCode(error) {
  let current = error;
  while (current) {
    if (FALLBACK_TRANSPORT_ERROR_CODES.has(current.code)) return current.code;
    current = current.cause;
  }
  return null;
}

function canFallbackToNextAddress(error) {
  const safeError = findSafeHttpError(error);
  if ((safeError && safeError.code !== 'TIMEOUT') || error?.response) return false;
  if (safeError?.code === 'TIMEOUT') return true;
  return Boolean(findFallbackTransportCode(error));
}

function interleaveAddressFamilies(addresses) {
  if (addresses.length < 2) return addresses;

  const firstFamily = addresses[0].family;
  const preferred = addresses.filter((entry) => entry.family === firstFamily);
  const alternate = addresses.filter((entry) => entry.family !== firstFamily);
  const ordered = [];

  while (preferred.length || alternate.length) {
    if (preferred.length) ordered.push(preferred.shift());
    if (alternate.length) ordered.push(alternate.shift());
  }
  return ordered;
}

function connectWithTimeout(connect, connectOptions, readyEvent, timeoutMs) {
  const socket = connect(connectOptions);
  const clearConnectTimer = () => clearTimeout(timer);
  const timer = setTimeout(() => {
    const error = new Error('Tempo limite de conexÃ£o excedido');
    error.code = 'ETIMEDOUT';
    socket.destroy(error);
  }, timeoutMs);
  timer.unref?.();
  socket.once(readyEvent, clearConnectTimer);
  socket.once('error', clearConnectTimer);
  socket.once('close', clearConnectTimer);
  return socket;
}

function createConnectionLimitedAgent(AgentClass, connect, readyEvent, connectTimeoutMs) {
  const agent = new AgentClass({ keepAlive: false });
  agent.createConnection = (connectOptions) => connectWithTimeout(
    connect,
    connectOptions,
    readyEvent,
    connectTimeoutMs
  );
  return agent;
}

function createSafeHttpClient({
  httpClient = axios,
  resolveHostname = (hostname) => dns.promises.lookup(hostname, { all: true, verbatim: true }),
  isAddressAllowed = isPublicIp,
  now = () => performance.now(),
  connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
  createTcpConnection = (options) => net.createConnection(options),
  createTlsConnection = (options) => tls.connect(options),
  createHttpAgent = ({ timeoutMs }) => createConnectionLimitedAgent(
    http.Agent,
    createTcpConnection,
    'connect',
    timeoutMs
  ),
  createHttpsAgent = ({ timeoutMs }) => createConnectionLimitedAgent(
    https.Agent,
    createTlsConnection,
    'secureConnect',
    timeoutMs
  ),
} = {}) {
  function getRemainingTime(deadline) {
    const remainingMs = deadline - now();
    if (remainingMs <= 0) {
      throw new SafeHttpError('TIMEOUT');
    }
    return remainingMs;
  }

  function withDeadline(operation, remainingMs) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new SafeHttpError('TIMEOUT'));
      }, remainingMs);

      Promise.resolve(operation).then(
        (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  }

  async function resolvePublicAddresses(hostname, deadline) {
    const normalized = normalizeHostname(hostname);
    const literalFamily = net.isIP(normalized);
    let addresses;

    if (literalFamily) {
      addresses = [{ address: normalized, family: literalFamily }];
    } else {
      try {
        const remainingMs = getRemainingTime(deadline);
        addresses = await withDeadline(
          Promise.resolve().then(() => resolveHostname(normalized)),
          remainingMs
        );
      } catch (error) {
        if (error instanceof SafeHttpError) throw error;
        throw new SafeHttpError('DNS_ERROR', { cause: error });
      }
    }

    const normalizedAddresses = (Array.isArray(addresses) ? addresses : [addresses])
      .map((entry) =>
        typeof entry === 'string'
          ? { address: entry, family: net.isIP(entry) }
          : { address: entry.address, family: entry.family || net.isIP(entry.address) }
      )
      .filter((entry) => entry.address && entry.family);

    if (!normalizedAddresses.length) {
      throw new SafeHttpError('DNS_ERROR');
    }
    if (normalizedAddresses.some((entry) => !isAddressAllowed(entry.address))) {
      throw new SafeHttpError('BLOCKED_ADDRESS');
    }
    return interleaveAddressFamilies(normalizedAddresses);
  }

  function createPinnedLookup(expectedHostname, validatedAddress) {
    return async (hostname, lookupOptions = {}) => {
      const normalized = normalizeHostname(hostname);
      if (normalized !== expectedHostname) {
        throw new SafeHttpError('BLOCKED_ADDRESS');
      }

      const requestedFamily = Number(lookupOptions.family) || 0;
      if (requestedFamily && validatedAddress.family !== requestedFamily) {
        throw new SafeHttpError('DNS_ERROR');
      }

      const result = {
        address: validatedAddress.address,
        family: validatedAddress.family,
      };
      return lookupOptions.all ? [result] : result;
    };
  }

  async function requestValidatedHop(currentUrl, hostname, validatedAddresses, options, deadline) {
    let lastError;

    for (let index = 0; index < validatedAddresses.length; index += 1) {
      const remainingMs = getRemainingTime(deadline);
      const attemptMs = remainingMs;
      const connectionWindowMs = Math.min(connectTimeoutMs, remainingMs);
      const httpAgent = createHttpAgent({ timeoutMs: connectionWindowMs });
      const httpsAgent = createHttpsAgent({ timeoutMs: connectionWindowMs });

      try {
        return await withDeadline(
          Promise.resolve().then(() =>
            httpClient.get(currentUrl.href, {
              headers: options.headers,
              responseType: options.responseType || 'text',
              timeout: Math.max(1, Math.ceil(attemptMs)),
              maxContentLength: options.maxBytes,
              maxBodyLength: options.maxBytes,
              maxRedirects: 0,
              validateStatus: (status) => status >= 200 && status < 400,
              lookup: createPinnedLookup(hostname, validatedAddresses[index]),
              httpAgent,
              httpsAgent,
              proxy: false,
            })
          ),
          attemptMs
        );
      } catch (error) {
        lastError = error;
        if (index === validatedAddresses.length - 1 || !canFallbackToNextAddress(error)) {
          throw error;
        }
      }
    }

    throw lastError;
  }

  async function get(value, options = {}) {
    const timeoutMs = options.timeout;
    const maxBytes = options.maxBytes;
    const maxRedirects = options.maxRedirects;

    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new TypeError('timeout deve ser um número positivo');
    }
    if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
      throw new TypeError('maxBytes deve ser um número positivo');
    }
    if (!Number.isInteger(maxRedirects) || maxRedirects < 0) {
      throw new TypeError('maxRedirects deve ser um inteiro não negativo');
    }

    const deadline = now() + timeoutMs;

    try {
      let currentUrl = parseAndValidateUrl(value);
      let redirectCount = 0;

      while (true) {
        getRemainingTime(deadline);
        const hostname = normalizeHostname(currentUrl.hostname);
        const validatedAddresses = await resolvePublicAddresses(hostname, deadline);
        const response = await requestValidatedHop(
          currentUrl,
          hostname,
          validatedAddresses,
          { ...options, maxBytes },
          deadline
        );
        getRemainingTime(deadline);

        if (response.status >= 200 && response.status < 300) {
          return response;
        }
        if (![301, 302, 303, 307, 308].includes(response.status)) {
          throw new SafeHttpError('HTTP_STATUS', { status: response.status });
        }
        if (!response.headers?.location) {
          throw new SafeHttpError('HTTP_STATUS', { status: response.status });
        }
        if (redirectCount >= maxRedirects) {
          throw new SafeHttpError('TOO_MANY_REDIRECTS');
        }

        currentUrl = parseAndValidateUrl(
          new URL(response.headers.location, currentUrl).href
        );
        redirectCount += 1;
      }
    } catch (error) {
      throw classifyRequestError(error);
    }
  }

  return { get };
}

const safeHttpClient = createSafeHttpClient();

module.exports = {
  SafeHttpError,
  assertContentType,
  createSafeHttpClient,
  isPublicIp,
  parseAndValidateUrl,
  classifyRequestError,
  get: safeHttpClient.get,
};
