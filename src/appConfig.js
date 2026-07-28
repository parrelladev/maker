const fs = require('fs');
const path = require('path');

const ENV_DEFAULTS = {
  port: 3000,
};

function loadFileConfig() {
  const configPath = path.resolve('config.js');
  if (!fs.existsSync(configPath)) {
    return {};
  }
  try {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    return require(configPath);
  } catch (error) {
    console.warn('[config] Falha ao carregar config.js, usando variáveis de ambiente', error.message);
    return {};
  }
}

const fileConfig = loadFileConfig();

const port = Number(process.env.PORT || fileConfig.port || ENV_DEFAULTS.port);

module.exports = {
  port,
};
