/*
 * auth.test.js — teste de integração do acesso do AVIÁRIO IoT.
 *
 * Sobe um servidor HTTP efêmero com lib/auth-api.js + lib/store-json.js
 * (dados em diretório temporário) e exercita o fluxo real: cadastro,
 * login do administrador pré-configurado (admin/admin), login de usuário
 * cadastrado, sessão por cookie, logout, monitorização do painel e freio
 * de tentativas. Sem dependências externas: npm test (node --test).
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { criarRouter, responder } = require('../lib/auth-api');
const { criarStoreJson } = require('../lib/store-json');

const ADMIN = { usuario: 'admin', senha: 'admin' };
const MARIA = {
  nome: 'Maria Souza',
  email: 'maria@exemplo.com',
  funcao: 'Zootecnista',
  usuario: 'maria',
  senha: 'segredo1'
};

let servidor = null;
let base = '';
let dirDados = '';

before(async () => {
  dirDados = fs.mkdtempSync(path.join(os.tmpdir(), 'aerem-auth-'));
  const store = criarStoreJson(dirDados);
  const rotear = criarRouter({ store, modo: 'local' });
  servidor = http.createServer(async (req, res) => {
    const tratado = await rotear(req, res);
    if (!tratado) responder(res, 404, { ok: false, erro: 'rota_desconhecida' });
  });
  await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + servidor.address().port;
});

after(async () => {
  if (servidor) {
    if (typeof servidor.closeAllConnections === 'function') servidor.closeAllConnections();
    await new Promise((resolve) => servidor.close(resolve));
  }
  if (dirDados) fs.rmSync(dirDados, { recursive: true, force: true });
});

/** Requisição JSON, opcionalmente autenticada pelo cookie de sessão. */
async function pedir(caminho, { metodo = 'GET', corpo, cookie } = {}) {
  const headers = {};
  if (corpo) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const r = await fetch(base + caminho, {
    method: metodo,
    headers,
    body: corpo ? JSON.stringify(corpo) : undefined
  });
  const texto = await r.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { json = null; }
  const bruto = (r.headers.getSetCookie ? r.headers.getSetCookie()[0] : r.headers.get('set-cookie')) || '';
  return { status: r.status, corpo: json, cookie: bruto.split(';')[0] };
}

function entrarComo(usuario, senha) {
  return pedir('/api/auth/login', { metodo: 'POST', corpo: { usuario, senha } });
}

test('status público anuncia o servidor de acesso (modo local, com banco)', async () => {
  const r = await pedir('/api/auth/status');
  assert.equal(r.status, 200);
  assert.equal(r.corpo.ok, true);
  assert.equal(r.corpo.modo, 'local');
  assert.equal(r.corpo.banco, true);
  assert.equal(r.corpo.usuario_admin, 'admin');
  assert.equal(typeof r.corpo.resumo.usuarios, 'number');
  assert.equal(typeof r.corpo.resumo.acessos_hoje, 'number');
});

test('cadastro cria usuário comum, abre sessão e habilita /api/auth/sessao', async () => {
  const r = await pedir('/api/auth/cadastro', { metodo: 'POST', corpo: MARIA });
  assert.equal(r.status, 201);
  assert.equal(r.corpo.ok, true);
  assert.equal(r.corpo.usuario.usuario, 'maria');
  assert.equal(r.corpo.usuario.perfil, 'usuario');
  assert.equal(r.corpo.usuario.funcao, 'Zootecnista');
  assert.ok(r.cookie.startsWith('aerem_sessao='), 'cookie de sessão ausente: ' + r.cookie);

  const sessao = await pedir('/api/auth/sessao', { cookie: r.cookie });
  assert.equal(sessao.status, 200);
  assert.equal(sessao.corpo.usuario.nome, 'Maria Souza');

  const semCookie = await pedir('/api/auth/sessao');
  assert.equal(semCookie.status, 401);
  assert.equal(semCookie.corpo.erro, 'sem_sessao');
});

test('cadastro recusa dados inválidos, usuário reservado e duplicidades', async () => {
  const curta = await pedir('/api/auth/cadastro', {
    metodo: 'POST',
    corpo: Object.assign({}, MARIA, { usuario: 'joao', email: 'joao@exemplo.com', senha: '123' })
  });
  assert.equal(curta.status, 400);
  assert.equal(curta.corpo.erro, 'dados_invalidos');

  const reservado = await pedir('/api/auth/cadastro', {
    metodo: 'POST',
    corpo: Object.assign({}, MARIA, { usuario: 'admin' })
  });
  assert.equal(reservado.status, 400, 'usuário reservado (admin) não deveria ser aceito');

  const repetido = await pedir('/api/auth/cadastro', {
    metodo: 'POST',
    corpo: Object.assign({}, MARIA, { email: 'outro@exemplo.com' })
  });
  assert.equal(repetido.status, 409);
  assert.equal(repetido.corpo.erro, 'usuario_em_uso');

  const emailRepetido = await pedir('/api/auth/cadastro', {
    metodo: 'POST',
    corpo: Object.assign({}, MARIA, { usuario: 'ana' })
  });
  assert.equal(emailRepetido.status, 409);
  assert.equal(emailRepetido.corpo.erro, 'email_em_uso');
});

test('login: administrador pré-configurado (admin/admin) e usuário cadastrado', async () => {
  const admin = await entrarComo(ADMIN.usuario, ADMIN.senha);
  assert.equal(admin.status, 200);
  assert.equal(admin.corpo.usuario.perfil, 'admin');
  assert.ok(admin.cookie.startsWith('aerem_sessao='));

  const comum = await entrarComo('maria', MARIA.senha);
  assert.equal(comum.status, 200);
  assert.equal(comum.corpo.usuario.perfil, 'usuario');
  assert.equal(comum.corpo.usuario.nome, 'Maria Souza');

  const errada = await entrarComo('maria', 'senha-errada');
  assert.equal(errada.status, 401);
  assert.equal(errada.corpo.erro, 'credenciais');
  assert.equal(errada.cookie, '', 'sessão não deve ser aberta com senha incorreta');

  const semDados = await pedir('/api/auth/login', { metodo: 'POST', corpo: { usuario: '', senha: '' } });
  assert.equal(semDados.status, 400);
});

test('monitorização (usuários e acessos) é exclusiva do administrador', async () => {
  const semSessao = await pedir('/api/admin/acessos');
  assert.equal(semSessao.status, 401);
  assert.equal(semSessao.corpo.erro, 'sem_sessao');

  const maria = await entrarComo('maria', MARIA.senha);
  const negado = await pedir('/api/admin/usuarios', { cookie: maria.cookie });
  assert.equal(negado.status, 403);
  assert.equal(negado.corpo.erro, 'apenas_admin');

  const admin = await entrarComo(ADMIN.usuario, ADMIN.senha);
  const usuarios = await pedir('/api/admin/usuarios', { cookie: admin.cookie });
  assert.equal(usuarios.status, 200);
  const nomes = usuarios.corpo.dados.map((u) => u.usuario);
  assert.ok(nomes.includes('maria'), 'usuário cadastrado ausente: ' + nomes.join(', '));
  assert.ok(!JSON.stringify(usuarios.corpo).includes('hash'), 'hash de senha exposto no painel');

  const acessos = await pedir('/api/admin/acessos?limite=20', { cookie: admin.cookie });
  assert.equal(acessos.status, 200);
  assert.ok(acessos.corpo.resumo.usuarios >= 1);
  assert.ok(acessos.corpo.dados.length >= 1, 'log de acessos vazio');
  const eventos = acessos.corpo.dados.map((a) => a.evento);
  assert.ok(eventos.includes('cadastro'), 'cadastro não registrado: ' + eventos.join(', '));
  assert.ok(eventos.includes('entrada'), 'entrada não registrada: ' + eventos.join(', '));

  const detalhe = acessos.corpo.dados[0];
  assert.ok(detalhe.ip, 'endereço IP não registrado');
  assert.ok(detalhe.agente, 'navegador não registrado');
  assert.ok(detalhe.quando, 'horário não registrado');

  const soFalhas = await pedir('/api/admin/acessos?evento=falha_senha', { cookie: admin.cookie });
  assert.equal(soFalhas.status, 200);
  assert.ok(soFalhas.corpo.dados.length >= 1, 'falha de senha não registrada no log');
  assert.ok(soFalhas.corpo.dados.every((a) => a.evento === 'falha_senha'), 'filtro de evento não aplicado');
});

test('logout encerra a sessão e registra a saída', async () => {
  const maria = await entrarComo('maria', MARIA.senha);
  const saiu = await pedir('/api/auth/logout', { metodo: 'POST', cookie: maria.cookie });
  assert.equal(saiu.status, 200);
  assert.equal(saiu.corpo.ok, true);
  assert.equal(saiu.cookie, 'aerem_sessao=', 'cookie de sessão não foi limpo');

  const depois = await pedir('/api/auth/sessao', { cookie: maria.cookie });
  assert.equal(depois.status, 401);

  const admin = await entrarComo(ADMIN.usuario, ADMIN.senha);
  const log = await pedir('/api/admin/acessos?evento=saida', { cookie: admin.cookie });
  assert.equal(log.status, 200);
  assert.ok(log.corpo.dados.length >= 1, 'saída não registrada no log');
  assert.equal(log.corpo.dados[0].usuario, 'maria');
});

test('freio de tentativas bloqueia o par IP+usuário após 8 falhas', async () => {
  for (let i = 0; i < 8; i++) {
    const r = await entrarComo('intruso', 'chute' + i);
    assert.equal(r.status, 401, 'falha ' + (i + 1) + ' deveria ser recusada');
  }
  const bloqueado = await entrarComo('intruso', 'chute-final');
  assert.equal(bloqueado.status, 429);
  assert.equal(bloqueado.corpo.erro, 'muitas_tentativas');

  const admin = await entrarComo(ADMIN.usuario, ADMIN.senha);
  const log = await pedir('/api/admin/acessos?evento=falha_usuario&limite=50', { cookie: admin.cookie });
  assert.equal(log.status, 200);
  assert.ok(log.corpo.dados.length >= 8, 'falhas de usuário não registradas: ' + log.corpo.dados.length);
});
