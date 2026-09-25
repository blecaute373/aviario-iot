/*
 * serve.js — servidor local do dashboard (public/) + API de acesso
 * Uso: npm run serve  →  http://localhost:3000  (troque a porta com PORT)
 *
 * Atende:
 *  - arquivos estáticos de public/ (consola, painel e recursos);
 *  - acesso e monitorização em /api/auth/* e /api/admin/* (lib/auth-api.js)
 *    com armazenamento em data/*.json — cadastro, login (administrador
 *    pré-configurado admin/admin), sessão, logout, usuários e log de acessos;
 *  - proteção de /admin.html: apenas sessão de administrador;
 *  - proxy de consulta ao InfluxDB 1.x para o histórico (/api/dados?periodo=...).
 *
 * Sem dependências externas: roda apenas com Node.js.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');

const { criarStoreJson } = require('../lib/store-json');
const { criarRouter, responder, sessaoDeRequisicao } = require('../lib/auth-api');

const ROOT = path.join(__dirname, '..', 'public');
const DATA_DIR = process.env.AEREM_DATA_DIR || path.join(__dirname, '..', 'data');
const PORT = Number(process.env.PORT) || 3000;
const INFLUX_HOST = process.env.INFLUX_HOST || 'localhost';
const INFLUX_PORT = Number(process.env.INFLUX_PORT) || 8086;
const INFLUX_DB = process.env.INFLUX_DB || 'aviario';
const INFLUX_USER = process.env.INFLUX_USER || 'admin';
const INFLUX_PASS = process.env.INFLUX_PASS || 'SuaSenhaForte123';

/* Armazenamento local do acesso + roteador compartilhado com a nuvem */
const store = criarStoreJson(DATA_DIR);
const rotearAcesso = criarRouter({ store, modo: 'local' });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

function queryInflux(q) {
  return new Promise((resolve, reject) => {
    const postData = 'q=' + encodeURIComponent(q);
    const auth = Buffer.from(`${INFLUX_USER}:${INFLUX_PASS}`).toString('base64');
    const req = http.request({
      hostname: INFLUX_HOST,
      port: INFLUX_PORT,
      path: `/query?db=${encodeURIComponent(INFLUX_DB)}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'Authorization': `Basic ${auth}`
      },
      timeout: 3000
    }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve(parsed);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('InfluxDB timeout')); });
    req.write(postData);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  let pathname = decodeURIComponent(parsedUrl.pathname || '/');

  /* ── Acesso e monitorização: cadastro/login/sessão/usuários/acessos ── */
  if (pathname.startsWith('/api/auth/') || pathname.startsWith('/api/admin/')) {
    const tratado = await rotearAcesso(req, res);
    if (tratado) return;
    responder(res, 404, { ok: false, erro: 'rota_desconhecida', mensagem: 'Rota de API não encontrada.' });
    return;
  }

  // Rota de histórico via InfluxDB 1.x
  if (pathname === '/api/dados') {
    const periodo = parsedUrl.query.periodo || '6h';
    let timeRange = '6h';
    let groupInterval = '1m';
    if (periodo === '1h') { timeRange = '1h'; groupInterval = '20s'; }
    else if (periodo === '6h') { timeRange = '6h'; groupInterval = '2m'; }
    else if (periodo === '24h') { timeRange = '24h'; groupInterval = '5m'; }
    else if (periodo === '7d') { timeRange = '7d'; groupInterval = '30m'; }

    const q = `SELECT mean("temperatura") AS "temp", mean("umidade") AS "umid", mean("pressao_pa") AS "pres_pa", mean("nh3_ppm") AS "nh3" FROM "sensores" WHERE time > now() - ${timeRange} GROUP BY time(${groupInterval}) fill(previous)`;
    try {
      const dbRes = await queryInflux(q);
      const series = dbRes?.results?.[0]?.series?.[0];
      const points = [];
      if (series && series.values) {
        const cols = series.columns;
        const timeIdx = cols.indexOf('time');
        const tempIdx = cols.indexOf('temp');
        const umidIdx = cols.indexOf('umid');
        const presIdx = cols.indexOf('pres_pa');
        const nh3Idx = cols.indexOf('nh3');

        for (const row of series.values) {
          const t = new Date(row[timeIdx]).getTime();
          const temp = row[tempIdx] !== null ? Number(row[tempIdx].toFixed(1)) : null;
          const umid = row[umidIdx] !== null ? Number(row[umidIdx].toFixed(1)) : null;
          const pres_hpa = row[presIdx] !== null ? Math.round(row[presIdx] / 100) : null;
          const nh3 = row[nh3Idx] !== null ? Number(row[nh3Idx].toFixed(1)) : null;
          points.push({ t, temp, umid, pres_hpa, nh3 });
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ ok: true, dados: points }));
    } catch (err) {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ ok: false, error: 'InfluxDB 1.x indisponível', details: err.message }));
    }
  }

  /* ── Painel administrativo: exige sessão de administrador ─────────── */
  if (pathname === '/admin' || pathname === '/admin.html') {
    const sessao = await sessaoDeRequisicao(req, store);
    if (!sessao) {
      res.writeHead(302, { Location: '/?login=admin' });
      return res.end();
    }
    if (sessao.perfil !== 'admin') {
      res.writeHead(302, { Location: '/?restrito=1' });
      return res.end();
    }
    pathname = '/admin.html';
  }

  if (pathname === '/') pathname = '/index.html';
  const file = path.join(ROOT, path.normalize(pathname));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('403');
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 ' + pathname);
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log('AEREM PLS — dashboard disponível em http://localhost:' + PORT);
    console.log('  Consola  → http://localhost:' + PORT + '/');
    console.log('  Painel   → http://localhost:' + PORT + '/admin.html  (administrador: ' + require('../lib/auth').ADMIN_USER + ')');
    console.log('  Dados de acesso em ' + DATA_DIR);
  });
}

module.exports = { server, queryInflux, store, rotearAcesso };
