import express from 'express';
import cors from 'cors';
import https from 'https';
import pg from 'pg';

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Squish@2026';

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ limit: '20mb', extended: true }));

// ── PostgreSQL ────────────────────────────────────────────────────────────────
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDB() {
  if (!process.env.DATABASE_URL) { console.log('Sem DATABASE_URL, banco desativado.'); return; }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pedidos (
        id SERIAL PRIMARY KEY,
        numero TEXT UNIQUE NOT NULL,
        nome_crianca TEXT NOT NULL,
        comprador TEXT,
        email TEXT,
        whatsapp TEXT,
        formato TEXT DEFAULT 'Digital R$79',
        status TEXT DEFAULT 'Aguardando pagamento',
        roteiro TEXT,
        valor NUMERIC(10,2) DEFAULT 79.00,
        link_pdf TEXT,
        observacoes TEXT,
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS clientes (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        nome TEXT,
        whatsapp TEXT,
        total_pedidos INTEGER DEFAULT 0,
        total_gasto NUMERIC(10,2) DEFAULT 0,
        primeiro_pedido TIMESTAMPTZ DEFAULT NOW(),
        ultimo_pedido TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('Banco inicializado.');
  } catch(e) { console.error('Erro banco:', e.message); }
}
initDB();

function gerarNumero() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2,5).toUpperCase();
  return `SQ-${ts}-${rand}`;
}

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ status: 'ok', service: 'Squishbook Backend v5' }));

// ── Auth middleware ───────────────────────────────────────────────────────────
function adminAuth(req, res, next) {
  const auth = req.headers['x-admin-key'];
  if (auth !== ADMIN_PASSWORD) return res.status(401).json({ erro: 'Não autorizado' });
  next();
}

// ── ADMIN: Dashboard ──────────────────────────────────────────────────────────
app.get('/api/admin/dashboard', adminAuth, async (req, res) => {
  if (!process.env.DATABASE_URL) return res.json({ erro: 'Banco não configurado' });
  try {
    const [totais, porStatus, porFormato, ultimos7, recente] = await Promise.all([
      pool.query(`SELECT COUNT(*) as total, COALESCE(SUM(valor),0) as receita FROM pedidos WHERE status != 'Cancelado'`),
      pool.query(`SELECT status, COUNT(*) as qtd FROM pedidos GROUP BY status ORDER BY qtd DESC`),
      pool.query(`SELECT formato, COUNT(*) as qtd, COALESCE(SUM(valor),0) as receita FROM pedidos WHERE status != 'Cancelado' GROUP BY formato`),
      pool.query(`SELECT DATE(criado_em) as dia, COUNT(*) as pedidos, COALESCE(SUM(valor),0) as receita FROM pedidos WHERE criado_em > NOW() - INTERVAL '7 days' GROUP BY dia ORDER BY dia`),
      pool.query(`SELECT * FROM pedidos ORDER BY criado_em DESC LIMIT 5`)
    ]);
    res.json({
      totais: totais.rows[0],
      porStatus: porStatus.rows,
      porFormato: porFormato.rows,
      ultimos7: ultimos7.rows,
      recente: recente.rows
    });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// ── ADMIN: Pedidos ────────────────────────────────────────────────────────────
app.get('/api/admin/pedidos', adminAuth, async (req, res) => {
  if (!process.env.DATABASE_URL) return res.json([]);
  try {
    const { status, busca, page = 1, limit = 20 } = req.query;
    let where = 'WHERE 1=1';
    const params = [];
    if (status) { params.push(status); where += ` AND status = $${params.length}`; }
    if (busca) { params.push(`%${busca}%`); where += ` AND (nome_crianca ILIKE $${params.length} OR comprador ILIKE $${params.length} OR email ILIKE $${params.length} OR numero ILIKE $${params.length})`; }
    const offset = (page - 1) * limit;
    params.push(limit, offset);
    const [rows, count] = await Promise.all([
      pool.query(`SELECT * FROM pedidos ${where} ORDER BY criado_em DESC LIMIT $${params.length-1} OFFSET $${params.length}`, params),
      pool.query(`SELECT COUNT(*) FROM pedidos ${where}`, params.slice(0, -2))
    ]);
    res.json({ pedidos: rows.rows, total: parseInt(count.rows[0].count), page: parseInt(page), limit: parseInt(limit) });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

app.post('/api/admin/pedidos', adminAuth, async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(500).json({ erro: 'Banco não configurado' });
  try {
    const { nome_crianca, comprador, email, whatsapp, formato, status, roteiro, valor, link_pdf, observacoes } = req.body;
    if (!nome_crianca) return res.status(400).json({ erro: 'nome_crianca obrigatório' });
    const numero = gerarNumero();
    const r = await pool.query(
      `INSERT INTO pedidos (numero,nome_crianca,comprador,email,whatsapp,formato,status,roteiro,valor,link_pdf,observacoes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [numero, nome_crianca, comprador||'', email||'', whatsapp||'', formato||'Digital R$79', status||'Aguardando pagamento', roteiro||'', valor||79, link_pdf||'', observacoes||'']
    );
    // Atualiza CRM
    if (email) {
      await pool.query(`
        INSERT INTO clientes (email,nome,whatsapp,total_pedidos,total_gasto,ultimo_pedido)
        VALUES ($1,$2,$3,1,$4,NOW())
        ON CONFLICT (email) DO UPDATE SET
          total_pedidos = clientes.total_pedidos + 1,
          total_gasto = clientes.total_gasto + $4,
          ultimo_pedido = NOW(),
          nome = COALESCE(NULLIF($2,''), clientes.nome),
          whatsapp = COALESCE(NULLIF($3,''), clientes.whatsapp)
      `, [email, comprador||'', whatsapp||'', valor||79]);
    }
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

app.put('/api/admin/pedidos/:id', adminAuth, async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(500).json({ erro: 'Banco não configurado' });
  try {
    const { id } = req.params;
    const campos = ['nome_crianca','comprador','email','whatsapp','formato','status','roteiro','valor','link_pdf','observacoes'];
    const updates = [];
    const params = [];
    campos.forEach(c => {
      if (req.body[c] !== undefined) { params.push(req.body[c]); updates.push(`${c} = $${params.length}`); }
    });
    if (!updates.length) return res.status(400).json({ erro: 'Nenhum campo para atualizar' });
    params.push(id);
    updates.push(`atualizado_em = NOW()`);
    const r = await pool.query(`UPDATE pedidos SET ${updates.join(',')} WHERE id = $${params.length} RETURNING *`, params);
    if (!r.rows.length) return res.status(404).json({ erro: 'Pedido não encontrado' });
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

app.delete('/api/admin/pedidos/:id', adminAuth, async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(500).json({ erro: 'Banco não configurado' });
  try {
    await pool.query(`UPDATE pedidos SET status = 'Cancelado' WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// ── ADMIN: CRM Clientes ───────────────────────────────────────────────────────
app.get('/api/admin/clientes', adminAuth, async (req, res) => {
  if (!process.env.DATABASE_URL) return res.json([]);
  try {
    const { busca } = req.query;
    let where = busca ? `WHERE email ILIKE $1 OR nome ILIKE $1` : '';
    const params = busca ? [`%${busca}%`] : [];
    const r = await pool.query(`SELECT * FROM clientes ${where} ORDER BY ultimo_pedido DESC LIMIT 100`, params);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

app.get('/api/admin/clientes/:email/pedidos', adminAuth, async (req, res) => {
  if (!process.env.DATABASE_URL) return res.json([]);
  try {
    const r = await pool.query(`SELECT * FROM pedidos WHERE email = $1 ORDER BY criado_em DESC`, [req.params.email]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ erro: e.message }); }
});

// ── ORIGINAL: Historia ────────────────────────────────────────────────────────
app.post('/api/historia', async (req, res) => {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ erro: 'ANTHROPIC_KEY nao configurada' });
  const { model, max_tokens, messages } = req.body;
  if (!messages || !messages.length) return res.status(400).json({ erro: 'messages obrigatorio' });
  try {
    const result = await httpsRequest(
      'api.anthropic.com', '/v1/messages', 'POST',
      { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      { model: model || 'claude-sonnet-4-20250514', max_tokens: max_tokens || 4000, messages }
    );
    res.status(result.status).json(result.body);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ── ORIGINAL: Avatar ──────────────────────────────────────────────────────────
app.post('/api/avatar', async (req, res) => {
  const FAL_KEY = process.env.FAL_KEY;
  if (!FAL_KEY) return res.status(500).json({ erro: 'FAL_KEY nao configurada' });
  const { model, payload } = req.body;
  if (!payload) return res.status(400).json({ erro: 'payload obrigatorio' });
  try {
    let finalPayload = { ...payload };
    if (payload.reference_images && payload.reference_images.length > 0) {
      const firstRef = payload.reference_images[0];
      if (firstRef.image_url) { finalPayload.reference_image_url = firstRef.image_url; delete finalPayload.reference_images; }
    }
    const falModel = model || 'fal-ai/flux/schnell';
    const result = await httpsRequest('fal.run', '/' + falModel, 'POST', { 'Authorization': 'Key ' + FAL_KEY }, finalPayload);
    res.status(result.status).json(result.body);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ── ORIGINAL: Pagamento ───────────────────────────────────────────────────────
app.post('/api/pagamento', async (req, res) => {
  const MP_TOKEN = process.env.MP_ACCESS_TOKEN;
  if (!MP_TOKEN) return res.status(500).json({ erro: 'MP_ACCESS_TOKEN nao configurado' });
  const { items, payer, back_urls, external_reference } = req.body;
  if (!items) return res.status(400).json({ erro: 'items obrigatorio' });
  try {
    const result = await httpsRequest(
      'api.mercadopago.com', '/checkout/preferences', 'POST',
      { 'Authorization': 'Bearer ' + MP_TOKEN },
      { items, payer, back_urls, auto_return: 'approved', statement_descriptor: 'SQUISHBOOK', external_reference }
    );
    res.status(result.status).json(result.body);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ── httpsRequest helper ───────────────────────────────────────────────────────
function httpsRequest(hostname, path, method, headers, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const options = { hostname, path, method: method || 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr), ...headers } };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: { raw: data } }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

app.listen(PORT, () => console.log('Squishbook Backend v5 na porta ' + PORT));
