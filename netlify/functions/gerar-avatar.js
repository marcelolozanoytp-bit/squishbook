const https = require('https');
exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  const FAL_KEY = process.env.FAL_KEY;
  if (!FAL_KEY) return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ erro: 'FAL_KEY nao configurada' }) };
  let parsed;
  try { parsed = JSON.parse(event.body || '{}'); } catch(e) { return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ erro: 'JSON invalido' }) }; }
  const model = parsed.model || 'fal-ai/flux/schnell';
  const payload = parsed.payload || {};
  return new Promise((resolve) => {
    const bodyStr = JSON.stringify(payload);
    const options = { hostname: 'fal.run', path: '/' + model, method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Key ' + FAL_KEY, 'Content-Length': Buffer.byteLength(bodyStr) } };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let p; try { p = JSON.parse(data); } catch(e) { p = { raw: data }; }
        resolve({ statusCode: res.statusCode, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(p) });
      });
    });
    req.on('error', (e) => { resolve({ statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ erro: e.message }) }); });
    req.write(bodyStr);
    req.end();
  });
};
