/*
 * lib/auth.js — núcleo de autenticação do AVIÁRIO IoT (compartilhado)
 *
 * Usado por scripts/serve.js (servidor local, na rede do aviário) e por
 * api/index.js (função serverless no Vercel). Camada pura — sem HTTP e sem
 * banco — com apenas node:crypto, mantendo o servidor local sem dependências.
 *
 * Responsabilidades:
 *  - hash de senha com scrypt + salt (comparação em tempo constante);
 *  - tokens de sessão (32 bytes aleatórios) e validade (padrão 8 h);
 *  - validações de cadastro/login;
 *  - credencial administrativa pré-configurada (ADMIN_USER/ADMIN_PASS,
 *    padrão admin/admin, conforme especificado para o TCC);
 *  - utilitários de requisição (IP e navegador, para o log de acessos).
 */
'use strict';

const crypto = require('node:crypto');

/* ── Credencial administrativa pré-configurada ─────────────────────────
   Padrão de fábrica: admin / admin. Em produção, defina ADMIN_USER e
   ADMIN_PASS nas variáveis de ambiente. */
const ADMIN_USER = (process.env.ADMIN_USER || 'admin').trim().toLowerCase();
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin';

/* Validade da sessão (horas) — mesmo horizonte usado na Estufa (8 h). */
const SESSAO_HORAS = Number(process.env.SESSAO_HORAS || 8);
const SESSAO_MS = SESSAO_HORAS * 60 * 60 * 1000;

/* Nomes de usuário que ninguém pode cadastrar (evita sequestro de papel) */
const USUARIOS_RESERVADOS = new Set([ADMIN_USER, 'admin', 'administrador', 'root', 'sistema']);

/* ── Senhas (scrypt + salt) ─────────────────────────────────────────── */
function gerarSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function derivar(senha, salt) {
  return crypto.scryptSync(String(senha), String(salt), 64).toString('hex');
}

/** Cria salt+hash para uma senha em texto puro. */
function criarCredenciais(senha) {
  const salt = gerarSalt();
  return { salt, hash: derivar(senha, salt) };
}

/** Compara a senha informada com o hash guardado (tempo constante). */
function verificarSenha(senha, salt, hash) {
  const calculado = Buffer.from(derivar(senha, salt), 'hex');
  const alvo = Buffer.from(String(hash || ''), 'hex');
  return alvo.length > 0 && alvo.length === calculado.length && crypto.timingSafeEqual(alvo, calculado);
}

/* ── Sessões ────────────────────────────────────────────────────────── */
function novoToken() {
  return crypto.randomBytes(32).toString('hex');
}

function expiracaoSessao() {
  return new Date(Date.now() + SESSAO_MS).toISOString();
}

/* ── Normalização e validação ───────────────────────────────────────── */
function normalizarLogin(v) {
  return String(v == null ? '' : v).trim().toLowerCase();
}

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RE_USUARIO = /^[a-z0-9][a-z0-9._-]{2,23}$/;

/**
 * Valida os dados de cadastro.
 * @returns {string|null} mensagem de erro ou null quando válido.
 */
function validarCadastro({ nome, email, usuario, senha }) {
  const n = String(nome || '').trim();
  if (n.length < 3 || n.length > 80) return 'Informe o nome completo (3 a 80 caracteres).';
  if (!RE_EMAIL.test(normalizarLogin(email))) return 'Informe um e-mail válido.';
  const u = normalizarLogin(usuario);
  if (!RE_USUARIO.test(u)) return 'Usuário deve ter de 3 a 24 caracteres (letras, números, ponto, hífen ou _).';
  if (USUARIOS_RESERVADOS.has(u)) return 'Este nome de usuário é reservado (uso administrativo).';
  if (String(senha || '').length < 6) return 'A senha deve ter pelo menos 6 caracteres.';
  return null;
}

/** Confere a credencial administrativa pré-configurada (admin/admin). */
function credencialDeFabrica(usuario, senha) {
  const a = Buffer.from(normalizarLogin(usuario));
  const b = Buffer.from(ADMIN_USER);
  const c = Buffer.from(String(senha == null ? '' : senha));
  const d = Buffer.from(ADMIN_PASS);
  const usuarioOk = a.length === b.length && crypto.timingSafeEqual(a, b);
  const senhaOk = c.length === d.length && crypto.timingSafeEqual(c, d);
  return usuarioOk && senhaOk;
}

/* ── Dados de requisição (log de acessos) ───────────────────────────── */
function ipDe(req) {
  const encaminhado = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return encaminhado || (req.socket && req.socket.remoteAddress) || 'desconhecido';
}

function agenteDe(req) {
  return String(req.headers['user-agent'] || 'desconhecido').slice(0, 160);
}

module.exports = {
  ADMIN_USER,
  ADMIN_PASS,
  SESSAO_HORAS,
  SESSAO_MS,
  USUARIOS_RESERVADOS,
  RE_EMAIL,
  RE_USUARIO,
  criarCredenciais,
  verificarSenha,
  novoToken,
  expiracaoSessao,
  normalizarLogin,
  validarCadastro,
  credencialDeFabrica,
  ipDe,
  agenteDe
};
