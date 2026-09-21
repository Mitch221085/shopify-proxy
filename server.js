const http = require('http');
const https = require('https');

const STORES = {
  'n1vssu-ky.myshopify.com': {
    client_id: 'ba6a9d61b26c4a5c694a44ce57f63583',
    client_secret: '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'
  },
  'rut00h-1g.myshopify.com': {
    client_id: 'ba6a9d61b26c4a5c694a44ce57f63583',
    client_secret: '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'
  }
};

const tokenCache = {};

function getToken(domain) {
  return new Promise((resolve, reject) => {
    if (tokenCache[domain] && tokenCache[domain].expires > Date.now()) {
      return resolve(tokenCache[domain].token);
    }
    const store = STORES[domain];
    if (!store) return reject(new Error('Unknown store'));
    const body = JSON.stringify({ client_id: store.client_id, client_secret: store.client_secret, grant_type: 'client_credentials' });
    const options = { hostname: domain, path: '/admin/oauth/access_token', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.access_token) { tokenCache[domain] = { token: json.access_token, expires: Date.now() + 3600000 }; resolve(json.access_token); }
          else reject(new Error('No token: ' + data));
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Shopify-Domain, X-Shopify-Token');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const domain = req.headers['x-shopify-domain'];
  let token = req.headers['x-shopify-token'];
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.searchParams.get('path') || '/admin/api/2024-01/products.json';

  if (!domain) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Missing headers' })); return; }

  if (!token) {
    try { token = await getToken(domain); }
    catch(e) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Could not get token: ' + e.message })); return; }
  }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    const options = { hostname: domain, path: path, method: req.method, headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token } };
    const proxyReq = https.request(options, (proxyRes) => { res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' }); proxyRes.pipe(res); });
    proxyReq.on('error', (e) => { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); });
    if (body) proxyReq.write(body);
    proxyReq.end();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
