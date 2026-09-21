exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, X-Shopify-Domain, X-Shopify-Token',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
      },
      body: ''
    };
  }

  const domain = event.headers['x-shopify-domain'];
  const token  = event.headers['x-shopify-token'];
  const path   = event.queryStringParameters?.path || '/admin/api/2024-01/products.json';
  const method = event.httpMethod;

  if (!domain || !token) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Missing x-shopify-domain or x-shopify-token header' })
    };
  }

  const url = `https://${domain}${path}`;

  const fetchOptions = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token
    }
  };

  if (method !== 'GET' && event.body) {
    fetchOptions.body = event.body;
  }

  try {
    const resp = await fetch(url, fetchOptions);
    const data = await resp.text();
    return {
      statusCode: resp.status,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: data
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
