const https = require('https');
exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
  if (!ANTHROPIC_KEY) return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ erro: 'ANTHROPIC_KEY nao configurada' }) };
  let body; try { body = JSON.parse(event.body); } catch(e) { return { statusCode: 400, body: JSON.stringify({ erro: 'Body invalido' }) }; }
  const requestBody = JSON.stringify({ model: body.model || 'claude-sonnet-4-20250514', max_tokens: body.max_tokens || 4000, messages: body.messages || [] });
  return new Promise((resolve) => {
    const options = { hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(requestBody) } };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let p; try { p = JSON.parse(data); } catch(e) { p = { raw: data }; }
        resolve({ statusCode: res.statusCode, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(p) });
      });
    });
    req.on('error', (e) => { resolve({ statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ erro: e.message }) }); });
    req.write(requestBody);
    req.end();
  });
};
