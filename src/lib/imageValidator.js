const { SafeHttpError, assertContentType } = require('./safeHttpClient');

const IMAGE_SIGNATURES = {
  'image/png': (buffer) =>
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
  'image/jpeg': (buffer) =>
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff,
  'image/gif': (buffer) => {
    const signature = buffer.subarray(0, 6).toString('ascii');
    return signature === 'GIF87a' || signature === 'GIF89a';
  },
  'image/webp': (buffer) =>
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP',
};

function toBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  throw new SafeHttpError('INVALID_IMAGE_CONTENT');
}

function validateImageResponse(response, { maxBytes }) {
  const contentType = assertContentType(
    response.headers?.['content-type'],
    Object.keys(IMAGE_SIGNATURES)
  );
  const buffer = toBuffer(response.data);

  if (buffer.length === 0) {
    throw new SafeHttpError('EMPTY_RESPONSE');
  }
  if (buffer.length > maxBytes) {
    throw new SafeHttpError('RESPONSE_TOO_LARGE');
  }
  if (!IMAGE_SIGNATURES[contentType](buffer)) {
    throw new SafeHttpError('INVALID_IMAGE_CONTENT');
  }

  return { contentType, buffer };
}

module.exports = {
  validateImageResponse,
};
