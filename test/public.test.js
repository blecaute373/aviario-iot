/*
 * public.test.js — valida a estrutura do dashboard (public/) e arquivos-chave do repositório.
 * Executa sem dependências externas: npm test  (node --test)
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');

const DASHBOARD_FILES = [
  'index.html',
  'css/tokens.css',
  'css/base.css',
  'css/login.css',
  'css/dashboard.css',
  'js/config.js',
  'js/auth.js',
  'js/zoom.js',
  'js/mock.js',
  'js/dashboard.js',
  'assets/logo-aerem.png',
  'assets/logo-baap.png'
];

test('dashboard: arquivos essenciais existem', () => {
  for (const f of DASHBOARD_FILES) {
    assert.ok(fs.existsSync(path.join(PUB, f)), 'faltando: public/' + f);
  }
});

test('index.html não contém mais base64 inline (logos extraídos para assets/)', () => {
  const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  assert.ok(!html.includes('data:image/png;base64'), 'base64 inline encontrado no index.html');
});

test('index.html referencia css/js/assets que existem', () => {
  const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:href|src)="((?:css|js|assets)\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 11, 'referências locais insuficientes: ' + refs.length);
  for (const r of refs) {
    assert.ok(fs.existsSync(path.join(PUB, r)), 'referência quebrada: ' + r);
  }
});

test('scripts JS do dashboard passam no node --check', () => {
  for (const f of ['config.js', 'auth.js', 'zoom.js', 'mock.js', 'dashboard.js']) {
    const r = spawnSync(process.execPath, ['--check', path.join(PUB, 'js', f)]);
    assert.equal(r.status, 0, f + ' falhou: ' + String(r.stderr));
  }
});

test('firmware: config.h.example presente nos dois nós ESP32', () => {
  for (const f of ['firmware/gateway-esp32/src/config.h.example', 'firmware/no-atuador-esp32/src/config.h.example']) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), 'faltando: ' + f);
  }
});

test('flows/flows.json é um array válido com 45 entradas', () => {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'flows', 'flows.json'), 'utf8'));
  assert.ok(Array.isArray(j));
  assert.equal(j.length, 45);
});

test('vercel.json é JSON válido', () => {
  JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
});

test('public: elementos do novo dashboard do Aviário IoT estão presentes', () => {
  const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  assert.ok(html.includes('AVIÁRIO IoT'), 'título AVIÁRIO IoT ausente');
  assert.ok(html.includes('valTemp') && html.includes('valUmid') && html.includes('valPres') && html.includes('valNh3'), 'sensores essenciais ausentes no html');
  assert.ok(html.includes('btn-on-v1') && html.includes('btn-on-v2') && html.includes('btn-on-asp') && html.includes('btn-on-neb'), 'atuadores reais ausentes');
  assert.ok(html.includes('btnModoAuto'), 'controle mestre de modo automático ausente');
  assert.ok(!html.toLowerCase().includes('thingspeak'), 'ThingSpeak não deve estar no HTML do Aviário');
});

