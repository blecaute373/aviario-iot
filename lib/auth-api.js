/*
 * lib/auth-api.js — roteador HTTP do acesso e da monitorização
 *
 * Compartilhado entre o servidor local (scripts/serve.js) e a função
 * serverless do Vercel (api/index.js) — mesma lógica, mesmo contrato,
 * como na arquitetura da Estufa (lib partilhada entre dev e nuvem).
 * Sem framework: recebe (req, res) do Node e responde em JSON.
 *
 * Rotas:
 *   GET  /api/auth/status    → modo do servidor de acesso (público)
 *   POST /api/auth/cadastro  → cria usuário comum e já abre sessão
 *   POST /api/auth/login     → admin pré-configurado (admin/admin) ou cadastro
 *   POST /api/auth/logout    → encerra a sessão (registra a saída)
 *   GET  /api/auth/sessao    → sessão atual (usada ao recarregar a página)
 *   GET  /api/admin/usuarios → lista de cadastros           (só administrador)
 *   GET  /api/admin/acessos  → log de acessos + resumo      (só administrador)
 *
 * Segurança: cookie de sessão httpOnly (SameSite=Lax, Secure em HTTPS),
 * hash scrypt (lib/auth.js), comparação em tempo constante, limite de
 * tentativas por IP+usuário e nenhum segredo nas respostas.
 */
'use strict';

const auth = require('./auth');

const COOKIE_NOME = 'aerem_sessao';
const LIMITE_CORPO = 16 * 1024; /* 16 KB — cadastro é pequeno */

/* Freio de tentativas: 8 falhas por IP+usuário a cada 10 min */
const JANELA_MS = 10 * 60 * 1000;
const MAX_FALHAS = 8;
const tentativas = new Map();

function chaveTentativa(req, usuario) {
  return auth.ipDe(req) + '|' + auth.normalizarLogin(usuario);
}

function tentativasExcedidas(req, usuario) {
  const chave = chaveTentativa(req, usuario);
  const t = tentativas.get(chave);
  if (!t) return false;
  if (Date.now() - t.inicio > JANELA_MS) {
    tentativas.delete(chave);
    return false;
  }
  return t.falhas >= MAX_FALHAS;
}

function registrarFalha(req, usuario) {
  const chave = chaveTentativa(req, usuario);
  const t = tentativas.get(chave);
  if (!t || Date.now() - t.inicio > JANELA_MS) tentativas.set(chave, { falhas: 1, inicio: Date.now() });
  else t.falhas += 1;
}

function limparFalhas(req, usuario) {
  tentativas.delete(chaveTentativa(req, usuario));
}

/* ── Respostas e corpo ──────────────────────────────────────────────── */
function responder(res, status, corpo) {
  const dados = JSON.stringify(corpo);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(dados)
  });
  res.end(dados);
}

async function lerCorpo(req) {
  /* O runtime do Vercel já entrega o JSON em req.body; o servidor local lê o stream. */
  if (req.body && typeof req.body === 'object') return req.body;
  return new Promise((resolve) => {
    let dados = '';
    let excedeu = false;
    req.on('data', (parte) => {
      dados += parte;
      if (dados.length > LIMITE_CORPO) {
        excedeu = true;
        req.destroy();
      }
    });
    req.on('error', () => resolve({}));
    req.on('end', () => {
      if (excedeu || !dados) return resolve({});
      try {
        const json = JSON.parse(dados);
        resolve(json && typeof json === 'object' ? json : {});
      } catch {
        resolve({});
      }
    });
  });
}

/* ── Cookies ────────────────────────────────────────────────────────── */
function lerCookies(req) {
  const bruto = String(req.headers.cookie || '');
  const saida = {};
  bruto.split(';').forEach((parte) => {
    const i = parte.indexOf('=');
    if (i > 0) saida[parte.slice(0, i).trim()] = decodeURIComponent(parte.slice(i + 1).trim());
  });
  return saida;
}

function definirCookieSessao(req, res, token, expiraEm) {
  const seguro = /https/i.test(String(req.headers['x-forwarded-proto'] || '')) || !!(req.socket && req.socket.encrypted);
  const maxAge = Math.max(0, Math.floor((new Date(expiraEm).getTime() - Date.now()) / 1000));
  res.setHeader('Set-Cookie',
    `${COOKIE_NOME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${seguro ? '; Secure' : ''}`);
}

function limparCookieSessao(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NOME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/* ── Sessão ─────────────────────────────────────────────────────────── */
async function sessaoDeRequisicao(req, store) {
  const token = lerCookies(req)[COOKIE_NOME];
  if (!token) return null;
  const sessao = await store.buscarSessao(token);
  return sessao || null;
}

function usuarioPublico(sessao) {
  return {
    usuario: sessao.usuario,
    nome: sessao.nome || sessao.usuario,
    perfil: sessao.perfil || 'usuario',
    funcao: sessao.funcao || null
  };
}

async function abrirSessao(req, res, store, dados) {
  const sessao = {
    token: auth.novoToken(),
    usuario: dados.usuario,
    nome: dados.nome,
    perfil: dados.perfil,
    funcao: dados.funcao || null,
    criado_em: new Date().toISOString(),
    expira_em: auth.expiracaoSessao()
  };
  await store.criarSessao(sessao);
  definirCookieSessao(req, res, sessao.token, sessao.expira_em);
  return sessao;
}

/* Grava um evento no log de acessos — nunca derruba o login */
async function registrar(store, req, dados) {
  try {
    await store.registrarAcesso(Object.assign({
      ip: auth.ipDe(req),
      agente: auth.agenteDe(req)
    }, dados));
  } catch {
    /* log é acessório */
  }
}

/* ── Roteador ───────────────────────────────────────────────────────── */
/**
 * @param {{store: object, modo?: string}} opcoes store no formato de
 *   lib/store-json.js / lib/store-mongo.js e rótulo do modo ('local'/'nuvem').
 * @returns {(req: object, res: object) => Promise<boolean>} `true` quando a
 *   rota foi tratada (caso contrário o chamador decide, ex.: 404/serviço).
 */
function criarRouter({ store, modo = 'local' }) {
  const EVENTOS_VALIDOS = ['entrada', 'saida', 'cadastro', 'falha_usuario', 'falha_senha'];

  return async function rotear(req, res) {
    const bruto = String(req.url || '');
    const caminho = bruto.split('?')[0];
    const query = new URLSearchParams(bruto.split('?')[1] || '');
    const metodo = String(req.method || 'GET').toUpperCase();

    /* ── Status do servidor de acesso (público) ─────────────────── */
    if (caminho === '/api/auth/status' && metodo === 'GET') {
      let resumo;
      try {
        resumo = await store.resumo();
      } catch {
        resumo = { usuarios: 0, acessos_hoje: 0, falhas_hoje: 0, sessoes_ativas: 0 };
      }
      responder(res, 200, {
        ok: true,
        modo,                       /* 'local' (serve.js) ou 'nuvem' (Vercel) */
        banco: true,
        usuario_admin: auth.ADMIN_USER,
        sessao_horas: auth.SESSAO_HORAS,
        resumo
      });
      return true;
    }

    /* ── Cadastro de usuário comum ─────────────────────────────── */
    if (caminho === '/api/auth/cadastro' && metodo === 'POST') {
      const corpo = await lerCorpo(req);
      const erro = auth.validarCadastro(corpo);
      if (erro) {
        responder(res, 400, { ok: false, erro: 'dados_invalidos', mensagem: erro });
        return true;
      }

      const usuario = auth.normalizarLogin(corpo.usuario);
      const email = auth.normalizarLogin(corpo.email);

      if (await store.buscarUsuario(usuario)) {
        responder(res, 409, { ok: false, erro: 'usuario_em_uso', mensagem: 'Este nome de usuário já está em uso.' });
        return true;
      }
      if (await store.buscarEmail(email)) {
        responder(res, 409, { ok: false, erro: 'email_em_uso', mensagem: 'Este e-mail já está cadastrado.' });
        return true;
      }

      const { salt, hash } = auth.criarCredenciais(corpo.senha);
      const criado = await store.criarUsuario({
        usuario,
        nome: String(corpo.nome).trim(),
        email,
        funcao: String(corpo.funcao || 'Visitante').trim().slice(0, 40),
        perfil: 'usuario',
        salt,
        hash
      });
      await registrar(store, req, { usuario, nome: criado.nome, evento: 'cadastro', detalhe: criado.funcao, perfil: 'usuario' });
      const sessao = await abrirSessao(req, res, store, criado);
      responder(res, 201, { ok: true, modo, usuario: usuarioPublico(sessao) });
      return true;
    }

    /* ── Login (administrador pré-configurado ou usuário cadastrado) */
    if (caminho === '/api/auth/login' && metodo === 'POST') {
      const corpo = await lerCorpo(req);
      const usuario = auth.normalizarLogin(corpo.usuario);
      const senha = String(corpo.senha == null ? '' : corpo.senha);

      if (!usuario || !senha) {
        responder(res, 400, { ok: false, erro: 'dados_invalidos', mensagem: 'Preencha usuário e senha.' });
        return true;
      }
      if (tentativasExcedidas(req, usuario)) {
        responder(res, 429, { ok: false, erro: 'muitas_tentativas', mensagem: 'Muitas tentativas. Aguarde alguns minutos.' });
        return true;
      }

      /* 1) Credencial administrativa pré-configurada (admin/admin) */
      if (auth.credencialDeFabrica(usuario, senha)) {
        limparFalhas(req, usuario);
        const administrativo = {
          usuario: auth.ADMIN_USER,
          nome: 'Administrador',
          perfil: 'admin',
          funcao: 'Administração'
        };
        await registrar(store, req, {
          usuario: administrativo.usuario, nome: administrativo.nome,
          evento: 'entrada', detalhe: 'administrador pré-configurado', perfil: 'admin'
        });
        const sessao = await abrirSessao(req, res, store, administrativo);
        responder(res, 200, { ok: true, modo, usuario: usuarioPublico(sessao) });
        return true;
      }

      /* 2) Usuário cadastrado */
      const cadastrado = await store.buscarUsuario(usuario);
      if (!cadastrado || cadastrado.ativo === false) {
        registrarFalha(req, usuario);
        await registrar(store, req, {
          usuario, nome: null, evento: 'falha_usuario',
          detalhe: 'usuário não encontrado', perfil: null
        });
        responder(res, 401, { ok: false, erro: 'credenciais', mensagem: 'Usuário ou senha incorretos.' });
        return true;
      }
      if (!auth.verificarSenha(senha, cadastrado.salt, cadastrado.hash)) {
        registrarFalha(req, usuario);
        await registrar(store, req, {
          usuario, nome: cadastrado.nome, evento: 'falha_senha',
          detalhe: 'senha incorreta', perfil: cadastrado.perfil
        });
        responder(res, 401, { ok: false, erro: 'credenciais', mensagem: 'Usuário ou senha incorretos.' });
        return true;
      }

      limparFalhas(req, usuario);
      await store.atualizarUsuario(usuario, { ultimo_acesso: new Date().toISOString() });
      await registrar(store, req, {
        usuario, nome: cadastrado.nome, evento: 'entrada',
        detalhe: cadastrado.funcao || null, perfil: cadastrado.perfil
      });
      const sessao = await abrirSessao(req, res, store, cadastrado);
      responder(res, 200, { ok: true, modo, usuario: usuarioPublico(sessao) });
      return true;
    }

    /* ── Sessão atual ──────────────────────────────────────────── */
    if (caminho === '/api/auth/sessao' && metodo === 'GET') {
      const sessao = await sessaoDeRequisicao(req, store);
      if (!sessao) {
        responder(res, 401, { ok: false, erro: 'sem_sessao', mensagem: 'Nenhuma sessão ativa.' });
        return true;
      }
      responder(res, 200, { ok: true, modo, usuario: usuarioPublico(sessao) });
      return true;
    }

    /* ── Logout ────────────────────────────────────────────────── */
    if (caminho === '/api/auth/logout' && metodo === 'POST') {
      const sessao = await sessaoDeRequisicao(req, store);
      if (sessao) {
        await store.removerSessao(sessao.token);
        await registrar(store, req, {
          usuario: sessao.usuario, nome: sessao.nome,
          evento: 'saida', detalhe: null, perfil: sessao.perfil
        });
      }
      limparCookieSessao(res);
      responder(res, 200, { ok: true });
      return true;
    }

    /* ── Monitorização: usuários cadastrados (só administrador) ── */
    if (caminho === '/api/admin/usuarios' && metodo === 'GET') {
      const sessao = await sessaoDeRequisicao(req, store);
      if (!sessao) {
        responder(res, 401, { ok: false, erro: 'sem_sessao', mensagem: 'Faça login para continuar.' });
        return true;
      }
      if (sessao.perfil !== 'admin') {
        responder(res, 403, { ok: false, erro: 'apenas_admin', mensagem: 'Acesso restrito a administradores.' });
        return true;
      }
      const lista = await store.listarUsuarios();
      const dados = lista.map((u) => ({
        usuario: u.usuario,
        nome: u.nome,
        email: u.email,
        funcao: u.funcao || null,
        perfil: u.perfil || 'usuario',
        criado_em: u.criado_em || null,
        ultimo_acesso: u.ultimo_acesso || null
      }));
      responder(res, 200, { ok: true, modo, total: dados.length, dados });
      return true;
    }

    /* ── Monitorização: log de acessos (só administrador) ──────── */
    if (caminho === '/api/admin/acessos' && metodo === 'GET') {
      const sessao = await sessaoDeRequisicao(req, store);
      if (!sessao) {
        responder(res, 401, { ok: false, erro: 'sem_sessao', mensagem: 'Faça login para continuar.' });
        return true;
      }
      if (sessao.perfil !== 'admin') {
        responder(res, 403, { ok: false, erro: 'apenas_admin', mensagem: 'Acesso restrito a administradores.' });
        return true;
      }
      const limite = Math.min(Math.max(Number(query.get('limite')) || 40, 1), 200);
      const offset = Math.max(Number(query.get('offset')) || 0, 0);
      const filtro = query.get('evento');
      const evento = EVENTOS_VALIDOS.includes(filtro) ? filtro : null;
      const { total, dados } = await store.listarAcessos({ limite, offset, evento });
      const resumo = await store.resumo();
      responder(res, 200, { ok: true, modo, total, limite, offset, evento, resumo, dados });
      return true;
    }

    return false; /* rota não pertence ao acesso/monitorização */
  };
}

module.exports = {
  COOKIE_NOME,
  criarRouter,
  responder,
  lerCorpo,
  lerCookies,
  sessaoDeRequisicao,
  usuarioPublico
};




