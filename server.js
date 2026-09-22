const http = require('http');
const https = require('https');

const PROXY_BASE = 'https://shopify-proxy-zvbr.onrender.com';

// Each store has its own app credentials
const STORE_CREDENTIALS = {
  'n1vssu-ky.myshopify.com': {
    client_id: 'ba6a9d61b26c4a5c694a44ce57f63583',
    client_secret: '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'
  },
  'rut00h-1g.myshopify.com': {
    client_id: '0f38698046a401532dc3ccea247de041',
    client_secret: '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'
  }
};

// In-memory token store (persists as long as Render keeps the process alive)
const tokenStore = {};

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Shopify-Domain, X-Shopify-Token');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/auth') {
    const shop = url.searchParams.get('shop');
    if (!shop) { res.writeHead(400); res.end('Missing shop param'); return; }
    const creds = STORE_CREDENTIALS[shop];
    if (!creds) { res.writeHead(400); res.end('Unknown shop: ' + shop); return; }
    const redirectUri = encodeURIComponent(`${PROXY_BASE}/callback`);
    const scopes = 'write_products,read_products';
    const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${creds.client_id}&scope=${scopes}&redirect_uri=${redirectUri}`;
    res.writeHead(302, { Location: installUrl });
    res.end();
    return;
  }

  if (url.pathname === '/callback') {
    const shop = url.searchParams.get('shop');
    const code = url.searchParams.get('code');
    if (!shop || !code) { res.writeHead(400); res.end('Missing shop or code'); return; }
    const creds = STORE_CREDENTIALS[shop] || {};

    const body = JSON.stringify({ client_id: creds.client_id, client_secret: creds.client_secret, code });
    const options = {
      hostname: shop,
      path: '/admin/oauth/access_token',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };

    const tokenReq = https.request(options, (tokenRes) => {
      let data = '';
      tokenRes.on('data', chunk => data += chunk);
      tokenRes.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.access_token) {
            tokenStore[shop] = json.access_token;
            console.log(`✓ Token saved for ${shop}: ${json.access_token}`);
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0a0a0a;color:#fff">
                <h1 style="color:#4ade80">✓ Connected!</h1>
                <p>Token saved for <strong>${shop}</strong></p>
                <p style="font-size:0.85rem;color:#aaa">Token: ${json.access_token}</p>
                <p style="margin-top:30px">You can close this tab. The uploader will now work for this store.</p>
              </body></html>
            `);
          } else {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Token exchange failed: ' + data);
          }
        } catch(e) {
          res.writeHead(500); res.end('Parse error: ' + e.message);
        }
      });
    });
    tokenReq.on('error', (e) => { res.writeHead(500); res.end('Request error: ' + e.message); });
    tokenReq.write(body);
    tokenReq.end();
    return;
  }

  if (url.pathname === '/tokens') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ stores: Object.keys(tokenStore), tokens: tokenStore }));
    return;
  }

  const domain = req.headers['x-shopify-domain'];
  let token = req.headers['x-shopify-token'];
  const path = url.searchParams.get('path') || '/admin/api/2024-01/products.json';

  if (!domain) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing X-Shopify-Domain header' }));
    return;
  }

  if (!token || token.length < 10) {
    token = tokenStore[domain];
  }
  if (tokenStore[domain]) {
    token = tokenStore[domain];
  }

  if (!token) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `No token for ${domain}. Visit ${PROXY_BASE}/auth?shop=${domain} to connect.` }));
    return;
  }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    const options = {
      hostname: domain,
      path: path,
      method: req.method,
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token }
    };
    const proxyReq = https.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
      proxyRes.pipe(res);
    });
    proxyReq.on('error', (e) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    });
    if (body) proxyReq.write(body);
    proxyReq.end();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
