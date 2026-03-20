exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  const FAL_KEY = process.env.FAL_KEY;
  if (!FAL_KEY) return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ erro: 'FAL_KEY nao configurada' }) };
  let parsed;
  try { parsed = JSON.parse(event.body || '{}'); } catch(e) { return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ erro: 'JSON invalido' }) }; }
  const model = parsed.model || 'fal-ai/flux/schnell';
  const payload = parsed.payload || {};
  try {
    const res = await fetch('https://fal.run/' + model, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Key ' + FAL_KEY }, body: JSON.stringify(payload) });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch(e) { data = { raw: text }; }
    return { statusCode: res.status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(data) };
  } catch(e) { return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ erro: e.message }) }; }
};
