/*
 * lib/store-mongo.js — armazenamento na nuvem do acesso (MongoDB Atlas)
 *
 * Usado por api/index.js (Vercel) quando MONGODB_URI está definida nas
 * variáveis de ambiente do projeto. O driver `mongodb` é exigido apenas
 * aqui (require tardio), de modo que o servidor local (scripts/serve.js)
 * e o restante do repositório continuam sem dependências.
 *
 * Interface idêntica à de lib/store-json.js (mesmos nomes de campos),
 * com coleções `usuarios`, `sessoes` e `acessos` no banco informado.
 */
'use strict';

/* Conexão reaproveitada entre invocações da função serverless */
const cacheGlobal = global.__aeremMongo || (global.__aeremMongo = { promessa: null });

async function conectar(uri) {
  if (!cacheGlobal.promessa) {
    const { MongoClient } = require('mongodb'); /* dependência apenas da nuvem */
    const cliente = new MongoClient(uri, {
      maxPoolSize: 2,
      serverSelectionTimeoutMS: 5000
    });
    cacheGlobal.promessa = cliente.connect().then(() => cliente);
  }
  return cacheGlobal.promessa;
}

async function criarStoreMongo(uri, nomeBanco) {
  const cliente = await conectar(uri);
  const db = cliente.db(nomeBanco || 'aviario');
  const usuarios = db.collection('usuarios');
  const sessoes = db.collection('sessoes');
  const acessos = db.collection('acessos');

  /* Índices idempotentes — nunca impedem o login se já existirem */
  try {
    await usuarios.createIndex({ usuario: 1 }, { unique: true });
    await usuarios.createIndex({ email: 1 }, { unique: true });
    await sessoes.createIndex({ expira_em: 1 }, { expireAfterSeconds: 0 }); /* TTL */
    await acessos.createIndex({ quando: -1 });
    await acessos.createIndex({ evento: 1 });
  } catch {
    /* índices já criados */
  }

  const semSegredos = { projection: { salt: 0, hash: 0 } };

  return {
    modo: 'nuvem',

    async listarUsuarios() {
      return usuarios.find({}, semSegredos).sort({ criado_em: -1 }).limit(500).toArray();
    },

    async buscarUsuario(usuario) {
      return usuarios.findOne({ usuario: String(usuario || '').toLowerCase() });
    },

    async buscarEmail(email) {
      return usuarios.findOne({ email: String(email || '').toLowerCase() });
    },

    async criarUsuario(dados) {
      const novo = Object.assign({
        perfil: 'usuario',
        ativo: true,
        criado_em: new Date().toISOString(),
        ultimo_acesso: null
      }, dados);
      await usuarios.insertOne(novo);
      return novo;
    },

    async atualizarUsuario(usuario, campos) {
      const r = await usuarios.findOneAndUpdate(
        { usuario: String(usuario || '').toLowerCase() },
        { $set: campos },
        { returnDocument: 'after', ...semSegredos }
      );
      return r || null;
    },

    async registrarAcesso(evento) {
      const novo = Object.assign({ quando: new Date().toISOString() }, evento);
      await acessos.insertOne(novo);
      return novo;
    },

    async listarAcessos({ limite = 50, offset = 0, evento = null } = {}) {
      const filtro = evento ? { evento } : {};
      const total = await acessos.countDocuments(filtro);
      const dados = await acessos.find(filtro).sort({ quando: -1 }).skip(offset).limit(limite).toArray();
      return { total, dados };
    },

    async criarSessao(sessao) {
      await sessoes.insertOne(Object.assign({}, sessao, {
        expira_em: new Date(sessao.expira_em) /* TTL exige tipo Date */
      }));
      return sessao;
    },

    async buscarSessao(token) {
      const s = await sessoes.findOne({ token, expira_em: { $gt: new Date() } });
      return s || null;
    },

    async removerSessao(token) {
      await sessoes.deleteOne({ token });
    },

    async resumo() {
      const hoje = new Date().toISOString().slice(0, 10);
      const doDia = { quando: { $gte: hoje } }; /* ISO ordena cronologicamente */
      const [totalUsuarios, entradas, falhas, ativas] = await Promise.all([
        usuarios.countDocuments({}),
        acessos.countDocuments({ ...doDia, evento: 'entrada' }),
        acessos.countDocuments({ ...doDia, evento: { $regex: '^falha' } }),
        sessoes.countDocuments({ expira_em: { $gt: new Date() } })
      ]);
      return { usuarios: totalUsuarios, acessos_hoje: entradas, falhas_hoje: falhas, sessoes_ativas: ativas };
    }
  };
}

module.exports = { criarStoreMongo };
