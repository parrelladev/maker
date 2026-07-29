const nonPublicDestinations = [
  ['localhost', 'http://localhost/asset.svg', '127.0.0.1'],
  ['IPv4 de loopback', 'http://127.0.0.1/asset.svg', '127.0.0.1'],
  ['IPv6 de loopback', 'http://[::1]/asset.svg', '::1'],
  ['rede privada 10/8', 'http://10.0.0.10/asset.svg', '10.0.0.10'],
  ['rede privada 172.16/12', 'http://172.16.0.10/asset.svg', '172.16.0.10'],
  ['rede privada 192.168/16', 'http://192.168.0.10/asset.svg', '192.168.0.10'],
  ['link-local', 'http://169.254.169.254/asset.svg', '169.254.169.254'],
  [
    'hostname resolvido para IP privado',
    'http://private-dns.example.test/asset.svg',
    '10.0.0.30',
  ],
];

module.exports = {
  nonPublicDestinations,
  publicUrl: 'https://public.example.test/asset.svg',
  redirectedPublicUrl: 'https://cdn.example.test/asset.svg',
  redirectedPrivateUrl: 'http://10.0.0.20/asset.svg',
};
