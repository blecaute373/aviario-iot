/* ═══════════════════════════════════════════════════════════════════
   AVIÁRIO IoT · auth.js — acesso único (cadastro + login) e sessão
   Uma única tela atende os dois perfis, sem URLs separadas:
     · administrador pré-configurado (padrão admin/admin) → painel de controle
     · usuários cadastrados (nome, e-mail, função e senha)  → consola
   Com servidor de acesso ativo (scripts/serve.js na rede local ou função
   do Vercel com MONGODB_URI), cadastros, sessões e o log de acessos ficam
   no servidor. Sem banco configurado, o dashboard opera em modo
   demonstração local (dados no próprio navegador) — nunca quebra.
   ═══════════════════════════════════════════════════════════════════ */

/* ── Estado ──────────────────────────────────────────────────────── */
let AEREM_MODO = 'estatico';       /* 'servidor' | 'demo-nuvem' | 'estatico' */
let AEREM_SERVIDOR = null;         /* resposta de /api/auth/status */
let AEREM_USUARIO = null;          /* { usuario, nome, perfil, funcao } */
let modoAcesso = 'login';          /* 'login' | 'cadastro' */
let timerAviso = null;

const CHAVE_SESSAO = 'aerem_sessao';
const CHAVE_USUARIOS_LOCAIS = 'aerem_usuarios_local';
const CHAVE_ACESSOS_LOCAIS = 'aerem_acessos_local';
const LIMITE_ACESSOS_LOCAIS = 200;

/* Espelham a credencial pré-configurada do servidor (lib/auth.js) */
const ADMIN_LOCAL = 'admin';
const ADMIN_LOCAL_SENHA = 'admin';

/* ── Utilidades ──────────────────────────────────────────────────── */
function paginaAtual() {
  return (document.body && document.body.dataset.pagina) || 'consola';
}

function ehAdmin() {
  return !!AEREM_USUARIO && AEREM_USUARIO.perfil === 'admin';
}

function rotuloUsuario() {
  if (!AEREM_USUARIO) return '';
  return AEREM_USUARIO.nome + ' · ' + (ehAdmin() ? 'administrador' : 'usuário');
}

function valor(id) {
  const el = document.getElementById(id);
  return el ? String(el.value || '').trim() : '';
}

/* fetch + JSON + tempo limite (AbortController) */
async function pedirJson(url, opcoes = {}, tempoLimite = 6000) {
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), tempoLimite);
  try {
    const resposta = await fetch(url, {
      method: opcoes.metodo || 'GET',
      credentials: 'same-origin',
      headers: opcoes.corpo ? { 'Content-Type': 'application/json' } : undefined,
      body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined,
      signal: controle.signal,
      cache: 'no-store'
    });
    let dados = null;
    try { dados = await resposta.json(); } catch { dados = null; }
    if (!dados || typeof dados !== 'object') dados = { ok: false, mensagem: 'Resposta inválida do servidor.' };
    dados.status = resposta.status;
    return dados;
  } finally {
    clearTimeout(relogio);
  }
}

function lerJsonLocal(chave, padrao) {
  try {
    const bruto = localStorage.getItem(chave);
    const dados = bruto ? JSON.parse(bruto) : null;
    return dados === null ? padrao : dados;
  } catch {
    return padrao;
  }
}

function gravarJsonLocal(chave, valorGravado) {
  try { localStorage.setItem(chave, JSON.stringify(valorGravado)); } catch { /* modo privado */ }
}

function novoId() {
  return Math.random().toString(36).slice(2, 12);
}

/* Hash local (modo demonstração): SHA-256 com salt, como na Estufa local */
async function hashLocal(senha, salt) {
  const dados = new TextEncoder().encode(salt + '|' + senha);
  const resumo = await crypto.subtle.digest('SHA-256', dados);
  return Array.from(new Uint8Array(resumo)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ── Sessão (cópia no navegador; a verdade, no modo servidor, é o cookie) ── */
function lerSessaoGuardada() {
  try {
    const bruto = sessionStorage.getItem(CHAVE_SESSAO);
    return bruto ? JSON.parse(bruto) : null;
  } catch {
    return null;
  }
}

function guardarSessao(usuario) {
  AEREM_USUARIO = usuario;
  try {
    sessionStorage.setItem('aerem_logged_in', '1');
    sessionStorage.setItem(CHAVE_SESSAO, JSON.stringify(usuario));
    localStorage.setItem('aerem_auth_user', usuario.usuario); /* compatibilidade */
  } catch { /* modo privado */ }
}

function limparSessao() {
  AEREM_USUARIO = null;
  try {
    sessionStorage.removeItem('aerem_logged_in');
    sessionStorage.removeItem(CHAVE_SESSAO);
  } catch { /* modo privado */ }
}


/* ── Tela de acesso (Entrar ⇄ Registrar na mesma caixa) ──────────────
   Título e subtítulo são fixos no HTML; aqui só mudam os campos visíveis,
   o texto do botão principal e o estado das abas (aria-pressed). */
function renderModoAcesso() {
  const caixa = document.getElementById('loginBox');
  const botao = document.getElementById('loginBtn');
  const abaEntrar = document.getElementById('loginTabEntrar');
  const abaRegistrar = document.getElementById('loginToggle');
  const erro = document.getElementById('loginError');
  if (erro) erro.textContent = '';
  const cadastro = modoAcesso === 'cadastro';
  if (caixa) caixa.classList.toggle('modo-cadastro', cadastro);
  if (botao) botao.textContent = cadastro ? 'Cadastrar e entrar' : 'Entrar';
  if (abaEntrar) abaEntrar.setAttribute('aria-pressed', cadastro ? 'false' : 'true');
  if (abaRegistrar) abaRegistrar.setAttribute('aria-pressed', cadastro ? 'true' : 'false');
}

/* Cada aba define o modo explicitamente (clicar na aba ativa não muda nada);
   sem argumento apenas alterna — usado por chamadas antigas. */
function alternarModoAcesso(modo) {
  modoAcesso = modo === 'cadastro' || modo === 'login'
    ? modo
    : (modoAcesso === 'cadastro' ? 'login' : 'cadastro');
  renderModoAcesso();
}

function mostrarErro(mensagem) {
  const el = document.getElementById('loginError');
  if (el) el.textContent = mensagem;
}

function aplicarSeloModo() {
  const el = document.getElementById('loginModeBadge');
  if (!el) return;
  const textos = {
    servidor: '🔒 Servidor de acesso ativo — cadastros e acessos ficam registrados no servidor',
    'demo-nuvem': '🧪 Demonstração na nuvem — cadastros e acessos ficam neste navegador',
    estatico: '🧪 Modo local (sem servidor) — cadastros e acessos ficam neste navegador'
  };
  el.textContent = textos[AEREM_MODO] || textos.estatico;
  el.className = 'login-mode-badge modo-' + AEREM_MODO;
}

function mostrarTelaAcesso() {
  document.documentElement.classList.remove('aerem-logged');
  const tela = document.getElementById('loginScreen');
  if (tela) tela.classList.remove('hidden');
  renderModoAcesso();
  aplicarSeloModo();
}

function esconderTelaAcesso() {
  document.documentElement.classList.add('aerem-logged');
  const tela = document.getElementById('loginScreen');
  if (tela) tela.classList.add('hidden');
}

/* Aviso flutuante (funciona nas duas páginas, sem markup extra) */
function aviso(texto, tipo) {
  let el = document.getElementById('authNotice');
  if (!el) {
    el = document.createElement('div');
    el.id = 'authNotice';
    document.body.appendChild(el);
  }
  el.textContent = texto;
  el.className = 'auth-notice show ' + (tipo || 'ok');
  clearTimeout(timerAviso);
  timerAviso = setTimeout(() => { el.classList.remove('show'); }, 5000);
}

/* ── Modo do servidor de acesso ──────────────────────────────────── */
async function detectarModo() {
  try {
    const r = await pedirJson('/api/auth/status', {}, 2500);
    AEREM_SERVIDOR = r;
    if (r && r.ok && r.banco) AEREM_MODO = 'servidor';
    else if (r && r.ok && r.banco === false) AEREM_MODO = 'demo-nuvem';
    else AEREM_MODO = 'estatico';
  } catch {
    AEREM_MODO = 'estatico'; /* abriu o arquivo direto, host estático ou rede fora */
  }
}


/* ── Entrar / cadastrar (um único botão conforme o modo da tela) ──── */
async function entrar() {
  if (modoAcesso === 'cadastro') return cadastrar();
  const usuario = valor('loginUser').toLowerCase();
  const senha = document.getElementById('loginPass') ? document.getElementById('loginPass').value : '';
  mostrarErro('');
  if (!usuario || !senha) return mostrarErro('Preencha usuário e senha.');

  const botao = document.getElementById('loginBtn');
  if (botao) botao.disabled = true;
  try {
    if (AEREM_MODO === 'servidor') {
      const r = await pedirJson('/api/auth/login', { metodo: 'POST', corpo: { usuario, senha } });
      if (!r || !r.ok) return mostrarErro((r && r.mensagem) || 'Usuário ou senha incorretos.');
      return concluirEntrada(r.usuario);
    }
    return entrarLocal(usuario, senha);
  } catch {
    mostrarErro('Servidor de acesso indisponível. Verifique a conexão e tente novamente.');
  } finally {
    if (botao) botao.disabled = false;
  }
}

function validarDadosCadastro(d) {
  if (d.nome.length < 3 || d.nome.length > 80) return 'Informe o nome completo (3 a 80 caracteres).';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email)) return 'Informe um e-mail válido.';
  if (!/^[a-z0-9][a-z0-9._-]{2,23}$/.test(d.usuario)) {
    return 'Usuário deve ter de 3 a 24 caracteres (letras, números, ponto, hífen ou _).';
  }
  if (d.usuario === ADMIN_LOCAL || d.usuario === 'administrador') return 'Este nome de usuário é reservado (uso administrativo).';
  if (d.senha.length < 6) return 'A senha deve ter pelo menos 6 caracteres.';
  if (d.senha !== d.senha2) return 'As senhas não conferem.';
  return null;
}

async function cadastrar() {
  const dados = {
    nome: valor('cadNome'),
    email: valor('cadEmail').toLowerCase(),
    funcao: valor('cadFuncao') || 'Visitante',
    usuario: valor('cadUser').toLowerCase(),
    senha: document.getElementById('cadPass') ? document.getElementById('cadPass').value : '',
    senha2: document.getElementById('cadPass2') ? document.getElementById('cadPass2').value : ''
  };
  mostrarErro('');
  const erro = validarDadosCadastro(dados);
  if (erro) return mostrarErro(erro);

  const botao = document.getElementById('loginBtn');
  if (botao) botao.disabled = true;
  try {
    if (AEREM_MODO === 'servidor') {
      const r = await pedirJson('/api/auth/cadastro', {
        metodo: 'POST',
        corpo: { nome: dados.nome, email: dados.email, funcao: dados.funcao, usuario: dados.usuario, senha: dados.senha }
      });
      if (!r || !r.ok) return mostrarErro((r && r.mensagem) || 'Não foi possível concluir o cadastro.');
      return concluirEntrada(r.usuario);
    }

    /* Modo demonstração: cadastro mantido no próprio navegador */
    const locais = lerJsonLocal(CHAVE_USUARIOS_LOCAIS, []);
    if (locais.some(u => u.usuario === dados.usuario)) return mostrarErro('Este nome de usuário já está em uso.');
    if (locais.some(u => u.email === dados.email)) return mostrarErro('Este e-mail já está cadastrado.');

    const salt = novoId() + novoId();
    const hash = await hashLocal(dados.senha, salt);
    locais.push({
      usuario: dados.usuario,
      nome: dados.nome,
      email: dados.email,
      funcao: dados.funcao,
      perfil: 'usuario',
      salt,
      hash,
      criado_em: new Date().toISOString(),
      ultimo_acesso: new Date().toISOString()
    });
    gravarJsonLocal(CHAVE_USUARIOS_LOCAIS, locais);
    registrarAcessoLocal('cadastro', dados.usuario, dados.nome, dados.funcao);
    registrarAcessoLocal('entrada', dados.usuario, dados.nome, 'cadastro novo (demonstração)');
    return concluirEntrada({ usuario: dados.usuario, nome: dados.nome, perfil: 'usuario', funcao: dados.funcao });
  } catch {
    mostrarErro('Não foi possível concluir o cadastro. Tente novamente.');
  } finally {
    if (botao) botao.disabled = false;
  }
}


/* ── Modo demonstração (sem banco): cadastro e acesso no navegador ─ */
function registrarAcessoLocal(evento, usuario, nome, detalhe) {
  const lista = lerJsonLocal(CHAVE_ACESSOS_LOCAIS, []);
  lista.unshift({
    quando: new Date().toISOString(),
    evento,
    usuario: usuario || null,
    nome: nome || null,
    detalhe: detalhe || null,
    ip: 'navegador local',
    agente: (navigator.userAgent || '').slice(0, 160)
  });
  if (lista.length > LIMITE_ACESSOS_LOCAIS) lista.length = LIMITE_ACESSOS_LOCAIS;
  gravarJsonLocal(CHAVE_ACESSOS_LOCAIS, lista);
}

async function entrarLocal(usuario, senha) {
  if (usuario === ADMIN_LOCAL && senha === ADMIN_LOCAL_SENHA) {
    registrarAcessoLocal('entrada', ADMIN_LOCAL, 'Administrador', 'administrador pré-configurado (demonstração)');
    return concluirEntrada({ usuario: ADMIN_LOCAL, nome: 'Administrador', perfil: 'admin', funcao: 'Administração' });
  }

  const locais = lerJsonLocal(CHAVE_USUARIOS_LOCAIS, []);
  const alvo = locais.find(u => u.usuario === usuario);
  if (!alvo) {
    registrarAcessoLocal('falha_usuario', usuario, null, 'usuário não encontrado (demonstração)');
    return mostrarErro('Usuário ou senha incorretos.');
  }
  const hash = await hashLocal(senha, alvo.salt);
  if (hash !== alvo.hash) {
    registrarAcessoLocal('falha_senha', usuario, alvo.nome, 'senha incorreta (demonstração)');
    return mostrarErro('Usuário ou senha incorretos.');
  }
  alvo.ultimo_acesso = new Date().toISOString();
  gravarJsonLocal(CHAVE_USUARIOS_LOCAIS, locais);
  registrarAcessoLocal('entrada', usuario, alvo.nome, alvo.funcao || null);
  return concluirEntrada({ usuario, nome: alvo.nome, perfil: alvo.perfil || 'usuario', funcao: alvo.funcao || null });
}

/* ── Sessão aplicada: consola para usuários, painel para administrador ── */
function aplicarUIUsuario() {
  const el = document.getElementById('authUser');
  if (el) el.textContent = rotuloUsuario();
  /* Elementos exclusivos do administrador (links do painel, por exemplo) */
  document.querySelectorAll('[data-admin-only]').forEach((no) => no.classList.toggle('hidden', !ehAdmin()));
  document.documentElement.classList.toggle('aerem-admin', ehAdmin());
}

function concluirEntrada(usuario) {
  guardarSessao(usuario);
  esconderTelaAcesso();
  aplicarUIUsuario();

  /* O administrador cai na área administrativa; o usuário, na consola */
  if (ehAdmin() && paginaAtual() !== 'admin') {
    location.href = 'admin.html';
    return;
  }
  if (!ehAdmin() && paginaAtual() === 'admin') {
    sessionStorage.setItem('aerem_aviso', 'Acesso restrito: o painel de controle é exclusivo do administrador.');
    location.href = 'index.html';
    return;
  }
  aviso(ehAdmin()
    ? 'Bem-vindo, administrador — o painel de controle (atuadores e monitoramento de acessos) está liberado.'
    : 'Bem-vindo(a), ' + usuario.nome + '. Consola de supervisão liberada.', 'ok');
}

async function logout() {
  try {
    if (AEREM_MODO === 'servidor') await pedirJson('/api/auth/logout', { metodo: 'POST' }, 4000);
    else if (AEREM_USUARIO) registrarAcessoLocal('saida', AEREM_USUARIO.usuario, AEREM_USUARIO.nome, null);
  } catch { /* sessão local é encerrada de qualquer forma */ }
  limparSessao();
  ['loginUser', 'loginPass', 'cadUser', 'cadPass', 'cadPass2'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  mostrarTelaAcesso();
  aplicarUIUsuario();
}

/* ── Inicialização ───────────────────────────────────────────────── */
function aplicarSessaoInicial(usuario) {
  guardarSessao(usuario);
  esconderTelaAcesso();
  aplicarUIUsuario();

  const pendente = sessionStorage.getItem('aerem_aviso');
  if (pendente) {
    sessionStorage.removeItem('aerem_aviso');
    aviso(pendente, 'erro');
  }
  if (paginaAtual() === 'admin' && !ehAdmin()) {
    sessionStorage.setItem('aerem_aviso', 'Acesso restrito: o painel de controle é exclusivo do administrador.');
    location.href = 'index.html';
  }
}

async function iniciarAcesso() {
  renderModoAcesso();
  aplicarSeloModo();

  const parametros = new URLSearchParams(location.search);
  if (parametros.get('restrito') === '1') {
    aviso('Acesso restrito: apenas o administrador entra no painel de controle.', 'erro');
  } else if (parametros.get('login') === 'admin') {
    /* /admin.html sem sessão é redirecionado por scripts/serve.js para cá */
    aviso('Área administrativa: use uma conta com perfil de administrador para entrar no painel.', 'erro');
  }
  /* Foco inicial no usuário acelera o uso no teclado e no celular */
  setTimeout(() => {
    const campo = document.getElementById(modoAcesso === 'cadastro' ? 'cadNome' : 'loginUser');
    const tela = document.getElementById('loginScreen');
    if (campo && tela && !tela.classList.contains('hidden')) campo.focus();
  }, 150);

  await detectarModo();
  aplicarSeloModo();

  if (AEREM_MODO === 'servidor') {
    try {
      const r = await pedirJson('/api/auth/sessao', {}, 4000);
      if (r && r.ok && r.usuario) return aplicarSessaoInicial(r.usuario);
      limparSessao();
    } catch { /* sem servidor agora: pede login */ }
  } else {
    const guardada = lerSessaoGuardada();
    if (guardada && guardada.usuario) return aplicarSessaoInicial(guardada);
  }
  mostrarTelaAcesso();
}

/* Enter em qualquer campo da tela de acesso confirma */
document.addEventListener('keydown', (evento) => {
  if (evento.key !== 'Enter') return;
  const tela = document.getElementById('loginScreen');
  if (tela && !tela.classList.contains('hidden')) entrar();
});

/* Interface usada pelas outras camadas (ui.js, acessos.js) */
window.AEREM_AUTH = {
  get modo() { return AEREM_MODO; },
  get usuario() { return AEREM_USUARIO; },
  get servidor() { return AEREM_SERVIDOR; },
  ehAdmin,
  rotuloUsuario,
  listarUsuariosLocais: () => lerJsonLocal(CHAVE_USUARIOS_LOCAIS, []),
  listarAcessosLocais: () => lerJsonLocal(CHAVE_ACESSOS_LOCAIS, []),
  registrarAcessoLocal,
  aviso
};

/* Revelar/ocultar senha — botões .campo-revelar da tela de acesso
   (só mexe no type do campo; não interfere na validação de entrar/cadastrar) */
document.addEventListener('click', (evento) => {
  const alvo = evento.target;
  const botao = alvo && alvo.closest ? alvo.closest('.campo-revelar') : null;
  if (!botao) return;
  const campo = document.getElementById(botao.dataset.alvo || '');
  if (!campo) return;
  const visivel = campo.type === 'text';
  campo.type = visivel ? 'password' : 'text';
  botao.classList.toggle('ativo', !visivel);
  botao.setAttribute('aria-label', visivel ? 'Mostrar senha' : 'Ocultar senha');
  campo.focus();
});

iniciarAcesso();

