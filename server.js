const http = require('http');
const https = require('https');

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Shopify-Domain, X-Shopify-Token');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const domain = req.headers['x-shopify-domain'];
  const token = req.headers['x-shopify-token'];
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.searchParams.get('path') || '/admin/api/2024-01/products.json';

  if (!domain || !token) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing headers' }));
    return;
  }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    const options = {
      hostname: domain,
      path: path,
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token
      }
    };

    const proxyReq = https.request(options, proxyRes => {
      let data = '';
      proxyRes.on('data', chunk => data += chunk);
      proxyRes.on('end', () => {
        res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
        res.end(data);
      });
    });

    proxyReq.on('error', err => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });

    if (body) proxyReq.write(body);
    proxyReq.end();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
