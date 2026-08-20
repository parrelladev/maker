const axios = require('axios');
const {
  createSafeHttpClient,
} = require('../../src/lib/safeHttpClient');

let validationLookups = 0;
let pinnedLookups = 0;

const httpClient = {
  get(url, config) {
    const pinnedLookup = config.lookup;
    return axios.get(url, {
      ...config,
      lookup: async (hostname, options) => {
        pinnedLookups += 1;
        return pinnedLookup(hostname, options);
      },
    });
  },
};

const client = createSafeHttpClient({
  httpClient,
  resolveHostname: async () => {
    validationLookups += 1;
    return [{ address: '127.0.0.1', family: 4 }];
  },
  isAddressAllowed: (address) => address === '127.0.0.1',
});

client.get(process.env.SAFE_HTTP_TARGET_URL, {
  timeout: 1000,
  maxBytes: 1024,
  maxRedirects: 0,
  responseType: 'text',
}).then(
  (response) => process.send({
    ok: true,
    data: response.data,
    validationLookups,
    pinnedLookups,
  }, () => process.exit(0)),
  (error) => process.send({
    ok: false,
    code: error.code,
    causeCode: error.cause?.code,
    validationLookups,
    pinnedLookups,
  }, () => process.exit(0))
);
