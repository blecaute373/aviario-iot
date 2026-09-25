/*
 * lib/store-json.js — armazenamento local do acesso (servidor da rede)
 *
 * Usado por scripts/serve.js quando o login roda no servidor local (sem
 * dependências externas). Mantém três arquivos no diretório de dados
 * (padrão: <repo>/data, ignorado pelo git e pelo .vercelignore):
 *   usuarios.json — cadastros (com hash de senha, nunca senha em claro)
 *   sessoes.json  — sessões ativas (token + validade)
 *   acessos.json  — histórico rolante do log de acessos
 *
 * A interface espelha lib/store-mongo.js para que o restante do código
 * (lib/auth-api.js) seja idêntico no servidor local e na nuvem.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const LIMITE_ACESSOS = 5000; /* histórico rolante — evita arquivo infinito */

function criarStoreJson(dir) {
  const base = dir || path.join(__dirname, '..', 'data');
  const arquivos = {
    usuarios: path.join(base, 'usuarios.json'),
    sessoes: path.join(base, 'sessoes.json'),
    acessos: path.join(base, 'acessos.json')
  };
  const cache = {};

  function ler(nome) {
    if (cache[nome]) return cache[nome];
    let dados = [];
    try {
      dados = JSON.parse(fs.readFileSync(arquivos[nome], 'utf8'));
    } catch {
      dados = []; /* arquivo ainda não existe (primeiro acesso) */
    }
    cache[nome] = Array.isArray(dados) ? dados : [];
    return cache[nome];
  }

  function gravar(nome, dados) {
    cache[nome] = dados;
    fs.mkdirSync(base, { recursive: true });
    const tmp = arquivos[nome] + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(dados, null, 2));
    fs.renameSync(tmp, arquivos[nome]); /* troca atômica */
  }

  return {
    modo: 'local',

    /* ── Usuários ──────────────────────────────────────────────────── */
    listarUsuarios() {
      return ler('usuarios')
        .slice()
        .sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em)));
    },

    buscarUsuario(usuario) {
      const u = String(usuario || '').toLowerCase();
      return ler('usuarios').find(x => x.usuario === u) || null;
    },

    buscarEmail(email) {
      const e = String(email || '').toLowerCase();
      return ler('usuarios').find(x => x.email === e) || null;
    },

    criarUsuario(dados) {
      const lista = ler('usuarios');
      const novo = Object.assign({
        perfil: 'usuario',
        ativo: true,
        criado_em: new Date().toISOString(),
        ultimo_acesso: null
      }, dados);
      lista.push(novo);
      gravar('usuarios', lista);
      return novo;
    },

    atualizarUsuario(usuario, campos) {
      const lista = ler('usuarios');
      const alvo = lista.find(x => x.usuario === String(usuario).toLowerCase());
      if (!alvo) return null;
      Object.assign(alvo, campos);
      gravar('usuarios', lista);
      return alvo;
    },

    /* ── Log de acessos ───────────────────────────────────────────── */
    registrarAcesso(evento) {
      const lista = ler('acessos');
      const novo = Object.assign({ quando: new Date().toISOString() }, evento);
      lista.unshift(novo); /* mais recentes primeiro */
      if (lista.length > LIMITE_ACESSOS) lista.length = LIMITE_ACESSOS;
      gravar('acessos', lista);
      return novo;
    },

    listarAcessos({ limite = 50, offset = 0, evento = null } = {}) {
      let lista = ler('acessos');
      if (evento) lista = lista.filter(a => a.evento === evento);
      return { total: lista.length, dados: lista.slice(offset, offset + limite) };
    },

    /* ── Sessões ──────────────────────────────────────────────────── */
    criarSessao(sessao) {
      const lista = ler('sessoes');
      lista.push(sessao);
      gravar('sessoes', lista);
      return sessao;
    },

    buscarSessao(token) {
      const agora = Date.now();
      const lista = ler('sessoes');
      const vivas = lista.filter(s => new Date(s.expira_em).getTime() > agora);
      if (vivas.length !== lista.length) gravar('sessoes', vivas); /* limpa expiradas */
      return vivas.find(s => s.token === token) || null;
    },

    removerSessao(token) {
      const lista = ler('sessoes');
      const restantes = lista.filter(s => s.token !== token);
      if (restantes.length !== lista.length) gravar('sessoes', restantes);
    },

    /* ── Resumo para o painel administrativo ─────────────────────── */
    resumo() {
      const acessos = ler('acessos');
      const hoje = new Date().toISOString().slice(0, 10);
      const doDia = acessos.filter(a => String(a.quando || '').slice(0, 10) === hoje);
      return {
        usuarios: ler('usuarios').length,
        acessos_hoje: doDia.filter(a => a.evento === 'entrada').length,
        falhas_hoje: doDia.filter(a => String(a.evento || '').startsWith('falha')).length,
        sessoes_ativas: ler('sessoes').filter(s => new Date(s.expira_em).getTime() > Date.now()).length
      };
    }
  };
}

module.exports = { criarStoreJson, LIMITE_ACESSOS };
