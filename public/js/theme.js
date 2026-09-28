/* ═══════════════════════════════════════════════════════════════════
   AEREM PLS · theme.js — tema claro/escuro restrito à tela de acesso
   Contrato:
     · data-tema="claro|escuro" fica pendurado no #loginScreen;
     · preferência do operador em localStorage['aerem_tema'];
     · sem preferência salva, herda o prefers-color-scheme do SO;
     · escuta mudança do SO só enquanto não houver preferência salva;
     · a consola e o painel permanecem sempre escuros nesta fase
       (ver docs/PROXIMOS_PASSOS.md).
   Sem dependências, sem build step.
   ═══════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var CHAVE = 'aerem_tema';
  var CLARO = 'claro';
  var ESCURO = 'escuro';

  function preferenciaSalva() {
    try {
      var v = localStorage.getItem(CHAVE);
      return v === CLARO || v === ESCURO ? v : null;
    } catch (e) {
      return null;
    }
  }

  function temaDoSistema() {
    try {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) return CLARO;
    } catch (e) { /* sem matchMedia: cai no escuro */ }
    return ESCURO;
  }

  function telas() {
    return Array.prototype.slice.call(document.querySelectorAll('#loginScreen'));
  }

  function metaThemeColor(tema) {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', tema === CLARO ? '#eef2f8' : '#070b13');
  }

  function aplicar(tema) {
    telas().forEach(function (tela) { tela.setAttribute('data-tema', tema); });
    /* Espelha no <html> (anti-FOUC do <head> e seletor do tokens.css) */
    try {
      if (tema === CLARO) document.documentElement.setAttribute('data-tema-acesso', CLARO);
      else document.documentElement.removeAttribute('data-tema-acesso');
    } catch (e) { /* documento sem raiz: ignora */ }
    document.querySelectorAll('#themeToggle').forEach(function (botao) {
      botao.setAttribute('aria-pressed', tema === CLARO ? 'true' : 'false');
    });
    metaThemeColor(tema);
  }

  function definir(tema, persistir) {
    if (tema !== CLARO && tema !== ESCURO) tema = ESCURO;
    if (persistir !== false) {
      try { localStorage.setItem(CHAVE, tema); } catch (e) { /* modo privado */ }
    }
    aplicar(tema);
    return tema;
  }

  function alternar() {
    var atual = telas().length && telas()[0].getAttribute('data-tema');
    return definir(atual === CLARO ? ESCURO : CLARO);
  }

  /* Defesa extra caso o anti-FOUC do <head> não tenha rodado. */
  definir(preferenciaSalva() || temaDoSistema(), false);

  document.addEventListener('click', function (evento) {
    var alvo = evento.target;
    var botao = alvo && alvo.closest ? alvo.closest('#themeToggle') : null;
    if (botao) alternar();
  });

  /* Segue o SO apenas enquanto o operador não escolheu um tema. */
  try {
    var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
    var aoMudar = function (e) {
      if (!preferenciaSalva()) aplicar(e.matches ? CLARO : ESCURO);
    };
    if (mq) {
      if (typeof mq.addEventListener === 'function') mq.addEventListener('change', aoMudar);
      else if (typeof mq.addListener === 'function') mq.addListener(aoMudar);
    }
  } catch (e) { /* tema manual continua valendo */ }

  window.AEREM_TEMA = { definir: definir, alternar: alternar, atual: function () {
    var t = telas().length && telas()[0].getAttribute('data-tema');
    return t === CLARO ? CLARO : ESCURO;
  } };
})();
