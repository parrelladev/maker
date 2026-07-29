class TemplatePageError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = this.constructor.name;
    this.code = code;
  }
}

class TemplateNotFoundError extends TemplatePageError {
  constructor(message, options) {
    super('TEMPLATE_NOT_FOUND', message, options);
  }
}

class TemplateManifestInvalidError extends TemplatePageError {
  constructor(message, options) {
    super('TEMPLATE_INVALID', message, options);
  }
}

class TemplateRequiredFileUnreadableError extends TemplatePageError {
  constructor(message, options) {
    super('TEMPLATE_FILE_UNREADABLE', message, options);
  }
}

class TemplateRemoteAssetError extends TemplatePageError {
  constructor(message, options) {
    super('TEMPLATE_REMOTE_ASSET_FAILED', message, options);
  }
}

module.exports = {
  TemplateManifestInvalidError,
  TemplateNotFoundError,
  TemplateRemoteAssetError,
  TemplateRequiredFileUnreadableError,
};
