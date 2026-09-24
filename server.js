const http = require('http');
const https = require('https');

const PROXY_BASE = 'https://shopify-proxy-zvbr.onrender.com';

const STORE_CREDENTIALS = {
  'n1vssu-ky.myshopify.com': { client_id: process.env.CLIENT_ID_S1, client_secret: process.env.CLIENT_SECRET_S1 },
  'rut00h-1g.myshopify.com': { client_id: process.env.CLIENT_ID_S2, client_secret: process.env.CLIENT_SECRET_S2 },
};

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
  const proxyReq = https.request(options, function(proxyRes) {
    res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
    proxyRes.pipe(res);
  });
  proxyReq.on('error', function(e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  });
  if (body) proxyReq.write(body);
  proxyReq.end();
}

const server = http.createServer(function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Shopify-Domain, X-Shopify-Token, X-Shopify-Path');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const url = new URL(req.url, 'http://' + req.headers.host);

  // OAuth Step 1: /auth?shop=xxx.myshopify.com
  if (url.pathname === '/auth') {
    const shop = url.searchParams.get('shop');
    if (!shop) { res.writeHead(400); res.end('Missing shop param'); return; }
    const creds = STORE_CREDENTIALS[shop];
    if (!creds) { res.writeHead(400); res.end('Unknown shop: ' + shop); return; }
    const redirectUri = encodeURIComponent(PROXY_BASE + '/callback');
    const scopes = 'write_products,read_products,read_orders,write_inventory,read_inventory,read_locations';
    const installUrl = 'https://' + shop + '/admin/oauth/authorize?client_id=' + creds.client_id + '&scope=' + scopes + '&redirect_uri=' + redirectUri;
    res.writeHead(302, { Location: installUrl });
    res.end();
    return;
  }

  // OAuth Step 2: /callback?code=xxx&shop=xxx
  if (url.pathname === '/callback') {
    const shop = url.searchParams.get('shop');
    const code = url.searchParams.get('code');
    if (!shop || !code) { res.writeHead(400); res.end('Missing shop or code'); return; }
    const creds = STORE_CREDENTIALS[shop] || {};

    const body = JSON.stringify({ client_id: creds.client_id, client_secret: creds.client_secret, code: code });
    const options = {
      hostname: shop,
      path: '/admin/oauth/access_token',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };

    const tokenReq = https.request(options, function(tokenRes) {
      let data = '';
      tokenRes.on('data', function(chunk) { data += chunk; });
      tokenRes.on('end', function() {
        try {
          const json = JSON.parse(data);
          if (json.access_token) {
            tokenStore[shop] = json.access_token;
            console.log('Token saved for ' + shop + ': ' + json.access_token);
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0a0a0a;color:#fff"><h1 style="color:#4ade80">Connected!</h1><p>Token saved for <strong>' + shop + '</strong></p><p style="font-size:0.85rem;color:#aaa">Token: ' + json.access_token + '</p><p style="margin-top:30px">You can close this tab.</p></body></html>');
          } else {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Token exchange failed: ' + data);
          }
        } catch(e) {
          res.writeHead(500); res.end('Parse error: ' + e.message);
        }
      });
    });
    tokenReq.on('error', function(e) { res.writeHead(500); res.end('Request error: ' + e.message); });
    tokenReq.write(body);
    tokenReq.end();
    return;
  }

  // Token status: /tokens
  if (url.pathname === '/tokens') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ stores: Object.keys(tokenStore), tokens: tokenStore }));
    return;
  }

  // Dedicated orders endpoint: /orders
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

  // Generic proxy
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
    res.end(JSON.stringify({ error: 'No token for ' + domain + '. Visit ' + PROXY_BASE + '/auth?shop=' + domain + ' to connect.' }));
    return;
  }

  let body = '';
  req.on('data', function(chunk) { body += chunk; });
  req.on('end', function() {
    shopifyRequest(domain, token, path, req.method, body || null, res);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, function() { console.log('Proxy running on port ' + PORT); });
