/*
 * api/index.js — função serverless do Vercel: todas as rotas /api/*
 *
 * O dashboard é estático (public/); esta função atende o sistema de acesso
 * (cadastro, login, sessão e logout) e a monitorização do painel
 * administrativo (usuários e log de acessos), usando o MongoDB Atlas
 * quando MONGODB_URI está definida nas variáveis do projeto.
 *
 * Sem MONGODB_URI: /api/auth/status responde { banco: false } — o front
 * reconhece o estado e opera em modo demonstração local (cadastros e
 * acessos no próprio navegador), sem quebrar o deploy estático.
 */
'use strict';

const { criarRouter, responder } = require('../lib/auth-api');

let roteadorPromessa = null;

/** Roteador da nuvem (MongoDB) — conexão reaproveitada entre invocações. */
function roteadorDaNuvem() {
  if (!roteadorPromessa) {
    const { criarStoreMongo } = require('../lib/store-mongo');
    roteadorPromessa = criarStoreMongo(process.env.MONGODB_URI, process.env.MONGODB_DB || 'aviario')
      .then((store) => criarRouter({ store, modo: 'nuvem' }));
  }
  return roteadorPromessa;
}

module.exports = async function handler(req, res) {
  const caminho = String(req.url || '').split('?')[0];

  if (!process.env.MONGODB_URI) {
    if (caminho === '/api/auth/status') {
      responder(res, 200, {
        ok: true,
        modo: 'nuvem',
        banco: false,
        mensagem: 'Cadastro/login na nuvem desativados: defina MONGODB_URI no projeto Vercel (Settings → Environment Variables) para habilitar o monitoramento de acessos.'
      });
      return;
    }
    responder(res, 503, {
      ok: false,
      erro: 'sem_banco',
      mensagem: 'Armazenamento da nuvem não configurado (MONGODB_URI). O dashboard segue em modo demonstração local.'
    });
    return;
  }

  try {
    const rotear = await roteadorDaNuvem();
    const tratado = await rotear(req, res);
    if (tratado) return;
    responder(res, 404, { ok: false, erro: 'rota_desconhecida', mensagem: 'Rota de API não encontrada.' });
  } catch (erro) {
    responder(res, 500, {
      ok: false,
      erro: 'interno',
      mensagem: 'Falha interna no servidor de acesso.',
      detalhe: String((erro && erro.message) || erro).slice(0, 160)
    });
  }
};
