const http = require('http');
const https = require('https');

const PROXY_BASE = 'https://shopify-proxy-zvbr.onrender.com';

const STORE_TOKENS = {
  's1': { domain: 'n1vssu-ky.myshopify.com', token: process.env.TOKEN_S1 },
  's2': { domain: 'rut00h-1g.myshopify.com', token: process.env.TOKEN_S2 },
};

const tokenStore = {};

function shopifyRequest(domain, token, path, method, body, res) {
  const options = {
    hostname: domain,
    path: path,
    method: method || 'GET',
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
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Shopify-Domain, X-Shopify-Token, X-Shopify-Path');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const url = new URL(req.url, 'http://' + req.headers.host);

  if (url.pathname === '/tokens') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ stores: Object.keys(tokenStore), tokens: tokenStore }));
    return;
  }

  if (url.pathname === '/orders') {
    const domain = req.headers['x-shopify-domain'];
    let token = req.headers['x-shopify-token'];

    if (!domain) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing X-Shopify-Domain header' }));
      return;
    }

    if (tokenStore[domain]) token = tokenStore[domain];
    if (!token) {
      for (const s of Object.values(STORE_TOKENS)) {
        if (s.domain === domain && s.token) { token = s.token; break; }
      }
    }
    if (!token) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No token for ' + domain }));
      return;
    }

    const shopifyPath = '/admin/api/2024-01/orders.json?fulfillment_status=unfulfilled&status=any&limit=50&fields=order_number,fulfillment_status,line_items';
    shopifyRequest(domain, token, shopifyPath, 'GET', null, res);
    return;
  }

  const domain = req.headers['x-shopify-domain'];
  let token = req.headers['x-shopify-token'];
  const path = req.headers['x-shopify-path'] || url.searchParams.get('path') || '/admin/api/2024-01/products.json';

  if (!domain) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing X-Shopify-Domain header' }));
    return;
  }

  if (!token || token.length < 10) token = tokenStore[domain];
  if (tokenStore[domain]) token = tokenStore[domain];

  if (!token) {
    for (const s of Object.values(STORE_TOKENS)) {
      if (s.domain === domain && s.token) { token = s.token; break; }
    }
  }

  if (!token) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'No token for ' + domain }));
    return;
  }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    shopifyRequest(domain, token, path, req.method, body || null, res);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, function() { console.log('Proxy running on port ' + PORT); });
