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

const ARQUIVOS_DASHBOARD = [
  'index.html',
  'admin.html',
  'css/tokens.css',
  'css/base.css',
  'css/login.css',
  'css/dashboard.css',
  'css/control.css',
  'js/config.js',
  'js/auth.js',
  'js/zoom.js',
  'js/mock.js',
  'js/api.js',
  'js/ui.js',
  'js/acessos.js',
  'js/dashboard.js',
  'js/admin.js',
  'assets/logo-aerem.png',
  'assets/logo-baap.png'
];

test('dashboard: arquivos essenciais existem', () => {
  for (const f of ARQUIVOS_DASHBOARD) {
    assert.ok(fs.existsSync(path.join(PUB, f)), 'faltando: public/' + f);
  }
});

test('páginas não contêm mais base64 inline (logos extraídos para assets/)', () => {
  for (const pagina of ['index.html', 'admin.html']) {
    const html = fs.readFileSync(path.join(PUB, pagina), 'utf8');
    assert.ok(!html.includes('data:image/png;base64'), 'base64 inline encontrado em ' + pagina);
  }
});

test('páginas referenciam css/js/assets que existem', () => {
  for (const pagina of ['index.html', 'admin.html']) {
    const html = fs.readFileSync(path.join(PUB, pagina), 'utf8');
    const refs = [...html.matchAll(/(?:href|src)="((?:css|js|assets)\/[^"]+)"/g)].map((m) => m[1]);
    assert.ok(refs.length >= 9, pagina + ': referências locais insuficientes: ' + refs.length);
    for (const r of refs) {
      assert.ok(fs.existsSync(path.join(PUB, r)), pagina + ': referência quebrada: ' + r);
    }
  }
});

test('scripts JS do dashboard passam no node --check', () => {
  const arquivos = ['config.js', 'auth.js', 'zoom.js', 'mock.js', 'api.js', 'ui.js', 'acessos.js', 'dashboard.js', 'admin.js'];
  for (const f of arquivos) {
    const r = spawnSync(process.execPath, ['--check', path.join(PUB, 'js', f)]);
    assert.equal(r.status, 0, f + ' falhou: ' + String(r.stderr));
  }
});

test('CSS: chaves balanceadas (guarda contra arquivos corrompidos)', () => {
  for (const f of ['tokens.css', 'base.css', 'login.css', 'dashboard.css', 'control.css']) {
    const css = fs.readFileSync(path.join(PUB, 'css', f), 'utf8');
    const abre = (css.match(/\{/g) || []).length;
    const fecha = (css.match(/\}/g) || []).length;
    assert.equal(abre, fecha, `${f}: chaves desbalanceadas ({=${abre}, }=${fecha})`);
  }
});

test('CSS: variáveis usadas estão definidas em tokens.css', () => {
  const tokens = fs.readFileSync(path.join(PUB, 'css', 'tokens.css'), 'utf8');
  const definidas = new Set([...tokens.matchAll(/--([\w-]+)\s*:/g)].map((m) => m[1]));
  // definidas em outros arquivos do próprio pacote (--act-* e --act-bg)
  ['act-accent', 'act-soft', 'act-glow', 'act-bg'].forEach((v) => definidas.add(v));
  const usadas = new Set();
  for (const f of ['base.css', 'login.css', 'dashboard.css', 'control.css']) {
    const css = fs.readFileSync(path.join(PUB, 'css', f), 'utf8');
    for (const m of css.matchAll(/var\(--([\w-]+)/g)) usadas.add(m[1]);
  }
  for (const v of usadas) {
    assert.ok(definidas.has(v), 'variável CSS sem definição: --' + v);
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

test('index.html: consola de supervisão do Aviário (somente leitura)', () => {
  const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  assert.ok(html.includes('AVIÁRIO IoT'), 'título AVIÁRIO IoT ausente');
  assert.ok(html.includes('valTemp') && html.includes('valUmid') && html.includes('valPres') && html.includes('valNh3'), 'sensores essenciais ausentes no html');
  assert.ok(html.includes('ringTemp') && html.includes('barTemp'), 'anel/barra do card de temperatura ausentes');
  for (const tipo of ['v1', 'v2', 'asp', 'neb']) {
    assert.ok(html.includes(`id="chip-${tipo}"`), `chip do atuador ${tipo} ausente`);
  }
  assert.ok(html.includes('href="admin.html"'), 'link para o painel administrativo ausente');
  assert.ok(!html.includes('ctrl-btn'), 'index.html não deve ter comandos manuais (controle fica no admin.html)');
  assert.ok(!html.toLowerCase().includes('thingspeak'), 'ThingSpeak não deve estar no HTML do Aviário');
});

test('admin.html: painel de controle com os 4 atuadores e a chave mestra', () => {
  const html = fs.readFileSync(path.join(PUB, 'admin.html'), 'utf8');
  assert.ok(html.includes('Painel de Controle'), 'título do painel ausente');
  for (const tipo of ['v1', 'v2', 'asp', 'neb']) {
    assert.ok(html.includes(`data-tipo="${tipo}"`), `card de controle do atuador ${tipo} ausente`);
  }
  assert.ok(html.includes('data-acao="on"') && html.includes('data-acao="off"'), 'botões on/off ausentes');
  assert.ok(html.includes('ctrl-btn ctrl-on') && html.includes('ctrl-btn ctrl-off'), 'botões de comando ausentes');
  assert.ok(html.includes('switchAuto'), 'chave mestra do modo automático ausente');
  assert.ok(html.includes('cmdLog'), 'log de comandos ausente');
  assert.ok(html.includes('href="index.html"'), 'link de volta à supervisão ausente');
  assert.ok(!html.toLowerCase().includes('thingspeak'), 'ThingSpeak não deve estar no HTML do Aviário');
});

test('api.js: contrato HTTP do gateway preservado (status/dados/atuador/modo-auto)', () => {
  const js = fs.readFileSync(path.join(PUB, 'js', 'api.js'), 'utf8');
  assert.ok(js.includes('/api/status'), '/api/status ausente');
  assert.ok(js.includes('/api/dados?periodo='), '/api/dados ausente');
  assert.ok(js.includes('/api/atuador?tipo='), '/api/atuador ausente');
  assert.ok(js.includes('/api/modo-auto?ativo='), '/api/modo-auto ausente');
});

test('vercel.json: função /api/* publicada junto com o dashboard estático', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const builds = (cfg.builds || []).map((b) => b.src);
  assert.ok(builds.includes('api/index.js'), 'build da função api/index.js ausente');
  const rotas = (cfg.routes || []).map((r) => r.src);
  assert.ok(rotas.includes('/api/(.*)'), 'rota /api/* ausente');
});

test('acesso: tela única de login/cadastro nas duas páginas', () => {
  const ids = ['loginBox', 'loginUser', 'loginPass', 'cadNome', 'cadEmail', 'cadFuncao',
    'cadUser', 'cadPass', 'cadPass2', 'loginError', 'loginToggle', 'loginModeBadge'];
  for (const pagina of ['index.html', 'admin.html']) {
    const html = fs.readFileSync(path.join(PUB, pagina), 'utf8');
    for (const id of ids) {
      assert.ok(html.includes(`id="${id}"`), pagina + ': campo do acesso ausente: #' + id);
    }
    assert.ok(html.includes('onclick="entrar()"'), pagina + ': botão Entrar sem ligação com entrar()');
  }
  /* A consola esconde o acesso ao painel para quem não é administrador */
  const indexHtml = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  assert.ok(indexHtml.includes('data-admin-only'), 'index.html: links do administrador sem marcação data-admin-only');
  const adminHtml = fs.readFileSync(path.join(PUB, 'admin.html'), 'utf8');
  const accIds = ['accChip', 'accMsg', 'accFiltro', 'accLogBody', 'usrBody',
    'accKpiUsuarios', 'accKpiEntradas', 'accKpiFalhas', 'accKpiSessoes'];
  for (const id of accIds) {
    assert.ok(adminHtml.includes(`id="${id}"`), 'painel de auditoria: elemento ausente: #' + id);
  }
  assert.ok(adminHtml.includes('src="js/acessos.js"'), 'admin.html não carrega js/acessos.js');
});

test('acesso: front conversa com /api/auth/* e /api/admin/* (login local antigo removido)', () => {
  const auth = fs.readFileSync(path.join(PUB, 'js', 'auth.js'), 'utf8');
  for (const rota of ['/api/auth/status', '/api/auth/login', '/api/auth/cadastro', '/api/auth/sessao', '/api/auth/logout']) {
    assert.ok(auth.includes(rota), 'auth.js não usa ' + rota);
  }
  assert.ok(!auth.includes('handleLoginSubmit'), 'auth.js ainda expõe o login local antigo');
  assert.ok(!auth.includes('aerem_auth_pass'), 'auth.js ainda guarda senha no navegador');

  const acessos = fs.readFileSync(path.join(PUB, 'js', 'acessos.js'), 'utf8');
  assert.ok(acessos.includes('/api/admin/acessos'), 'acessos.js não consulta o log de acessos');
  assert.ok(acessos.includes('/api/admin/usuarios'), 'acessos.js não consulta os usuários');
  assert.ok(!acessos.includes('CONTINUA'), 'acessos.js ficou incompleto (marcador de rascunho)');
});

