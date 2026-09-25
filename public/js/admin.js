/* ═══════════════════════════════════════════════════════════════════
   AVIÁRIO IoT · admin.js — painel administrativo (admin.html)
   Monitorização ao vivo + CONTROLE dos 4 atuadores reais (v1, v2, asp,
   neb) e da chave mestra do Modo Automático (automação Node-RED).
   Comandos no modo Real: GET /api/atuador e /api/modo-auto do gateway
   (que publica nos tópicos MQTT). No modo Simulação, mock.js responde.
   ═══════════════════════════════════════════════════════════════════ */

const CONFIG_ADMIN = { updateMs: 5000 };

let limitesAdmin = Object.assign({}, LIMITES_PADRAO);
let modoAuto = false;
let ultimosAdmin = null;
let comandoEmAndamento = false;
let timerFeedback = null;

document.addEventListener('DOMContentLoaded', () => {
  preencherUsuarioLogado();
  atualizarPillStatus(false);
  aplicarModoAutoUI();
  carregarStatusAdmin();

  document.querySelectorAll('.ctrl-btn[data-tipo]').forEach(btn => {
    btn.addEventListener('click', () => enviarComando(btn.dataset.tipo, btn.dataset.acao));
  });

  const sw = document.getElementById('switchAuto');
  if (sw) sw.addEventListener('click', alternarModoAuto);

  setInterval(carregarStatusAdmin, CONFIG_ADMIN.updateMs);

  document.addEventListener('aerem:modo', () => {
    limitesAdmin = Object.assign({}, LIMITES_PADRAO);
    ultimosAdmin = null;
    comandoLogLimpar();
    carregarStatusAdmin();
  });
  document.addEventListener('aerem:config', () => { if (!USE_MOCK) carregarStatusAdmin(); });
});

/* ── LEITURA DO STATUS (monitorização ao vivo) ──────────────────── */
async function carregarStatusAdmin() {
  try {
    const d = await apiStatus();
    if (d.limites) limitesAdmin = d.limites;
    modoAuto = !!d.modoAutomatico;

    aplicarLiveStrip(d);
    aplicarEstadosAtuadores(d.atuadores);
    aplicarModoAutoUI();
    atualizarPillStatus(true);
    marcarAtualizado();
    reiniciarCountdown(CONFIG_ADMIN.updateMs / 1000);
  } catch (e) {
    atualizarPillStatus(false);
  }
}

function aplicarLiveStrip(d) {
  const t = Number(d.temperatura);
  const u = Number(d.umidade);
  const p = Number(d.pressao_hpa !== undefined ? d.pressao_hpa : (Number(d.pressao_pa) / 100 || 1013));
  const n = Number(d.nh3_ppm);

  setTextoLive('valTemp', fmtNum(t), ' °C');
  setTextoLive('valUmid', fmtNum(u), ' %');
  setTextoLive('valPres', fmtNum(p, 0), ' hPa');
  setTextoLive('valNh3', fmtNum(n), ' ppm');

  const ant = ultimosAdmin;
  aplicarDelta(document.getElementById('deltaTemp'), t, ant ? ant.t : null, '°C');
  aplicarDelta(document.getElementById('deltaUmid'), u, ant ? ant.u : null, '%');
  aplicarDelta(document.getElementById('deltaPres'), p, ant ? ant.p : null, 'hPa');
  aplicarDelta(document.getElementById('deltaNh3'), n, ant ? ant.n : null, 'ppm');

  const estT = estadoTemperatura(t, limitesAdmin);
  const estU = estadoUmidade(u, limitesAdmin);
  const estP = estadoPressao(p);
  const estN = estadoNh3(n, limitesAdmin);
  setStateDot(document.getElementById('stateTemp'), estT, textoEstado(estT));
  setStateDot(document.getElementById('stateUmid'), estU, textoEstado(estU));
  setStateDot(document.getElementById('statePres'), estP, textoEstado(estP));
  setStateDot(document.getElementById('stateNh3'), estN, textoEstado(estN));

  ultimosAdmin = { t, u, p, n };

  /* Notas de sistema da faixa */
  const elUltima = document.getElementById('liveUltima');
  const elRssi = document.getElementById('liveRssi');
  const elSnr = document.getElementById('liveSnr');
  const elModo = document.getElementById('liveModo');

  if (elUltima) {
    const s = Number(d.tempoUltimaLeitura);
    elUltima.textContent = (!isNaN(s) && s >= 0) ? `${s}s` : '--';
  }
  if (elRssi) {
    const r = Number(d.rssi);
    elRssi.textContent = isNaN(r) ? '--' : `${r} dBm`;
    elRssi.className = 'sys-value ' + (isNaN(r) ? '' : r >= -90 ? 'ok' : r >= -105 ? 'warn' : 'danger');
  }
  if (elSnr) {
    const s = Number(d.snr);
    elSnr.textContent = isNaN(s) ? '--' : `${s} dB`;
    elSnr.className = 'sys-value ' + (isNaN(s) ? '' : s >= 7 ? 'ok' : 'warn');
  }
  if (elModo) {
    elModo.textContent = modoAuto ? 'AUTOMÁTICO' : 'MANUAL';
    elModo.className = 'sys-value ' + (modoAuto ? 'ok' : '');
  }

  /* Limites exibidos no card mestre */
  const lt = document.getElementById('limitTemp');
  const lu = document.getElementById('limitUmid');
  const ln = document.getElementById('limitNh3');
  if (lt) lt.innerHTML = `Temp ideal <b>${fmtNum(limitesAdmin.tempMin, 0)}–${fmtNum(limitesAdmin.tempMax, 0)} °C</b>`;
  if (lu) lu.innerHTML = `Umidade ideal <b>${fmtNum(limitesAdmin.umidMin, 0)}–${fmtNum(limitesAdmin.umidMax, 0)} %</b>`;
  if (ln) ln.innerHTML = `NH₃ crítico <b>${fmtNum(limitesAdmin.nh3Max, 0)} ppm</b>`;
}

function setTextoLive(id, valor, unidade) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = `${valor}<span class="sensor-unit">${unidade}</span>`;
  el.classList.remove('skel');
}

/* ── ESTADO REAL DOS ATUADORES NOS CARDS ────────────────────────── */
function aplicarEstadosAtuadores(atuadores) {
  ATUADORES.forEach(a => {
    const ligado = atuadores ? Number(atuadores[a.id]) === 1 : false;
    const card = document.querySelector(`.actuator-card[data-tipo="${a.id}"]`);
    if (card) card.classList.toggle('is-on', ligado);

    const chip = document.getElementById('chip-' + a.id);
    if (chip) {
      chip.className = 'act-chip ' + (ligado ? 'chip-on' : 'chip-off');
      chip.innerHTML = '<span class="chip-dot"></span>' + (ligado ? 'Ligado' : 'Desligado');
    }
  });
}

/* ── CHAVE MESTRA: MODO AUTOMÁTICO ──────────────────────────────── */
function aplicarModoAutoUI() {
  const sw = document.getElementById('switchAuto');
  const estado = document.getElementById('masterState');
  const aviso = document.getElementById('autoWarn');

  if (sw) {
    sw.classList.toggle('on', modoAuto);
    sw.setAttribute('aria-checked', String(modoAuto));
  }
  if (estado) {
    estado.textContent = modoAuto ? 'Automático ativo' : 'Manual';
    estado.classList.toggle('on', modoAuto);
  }
  if (aviso) aviso.classList.toggle('hidden', !modoAuto);

  /* Com a automação no comando, os botões manuais ficam bloqueados
     (o Node-RED reescreveria o estado na próxima leitura). */
  document.querySelectorAll('.ctrl-btn[data-tipo]').forEach(btn => {
    btn.disabled = modoAuto || comandoEmAndamento;
  });

  ATUADORES.forEach(a => {
    const modo = document.getElementById('mode-' + a.id);
    if (modo) modo.textContent = modoAuto ? 'AUTOMÁTICO' : 'MANUAL';
  });
}

async function alternarModoAuto() {
  if (comandoEmAndamento) return;
  const sw = document.getElementById('switchAuto');
  if (sw) sw.disabled = true;
  const novo = !modoAuto;
  try {
    await apiDefinirModoAuto(novo);
    modoAuto = novo;
    aplicarModoAutoUI();
    feedback(novo
      ? 'Modo automático ATIVADO — os atuadores passam a seguir os limites do Node-RED.'
      : 'Modo automático desativado — controle manual liberado.', false);
    registrarComando(`Modo Automático → ${novo ? 'ATIVAR' : 'DESATIVAR'}`, true);
    setTimeout(carregarStatusAdmin, 700);
  } catch (e) {
    feedback('Falha ao alterar o modo automático. Verifique a conexão com o gateway.', true);
    registrarComando(`Modo Automático → ${novo ? 'ATIVAR' : 'DESATIVAR'}`, false);
  } finally {
    if (sw) sw.disabled = false;
  }
}

/* ── COMANDO MANUAL DOS ATUADORES ───────────────────────────────── */
async function enviarComando(tipo, acao) {
  if (comandoEmAndamento) return;
  comandoEmAndamento = true;

  const card = document.querySelector(`.actuator-card[data-tipo="${tipo}"]`);
  if (card) card.classList.add('is-busy');
  aplicarModoAutoUI();

  const rotulo = `${nomeAtuador(tipo)} → ${acao === 'on' ? 'LIGAR' : 'DESLIGAR'}`;
  try {
    await apiComandarAtuador(tipo, acao);
    feedback(`${rotulo} — comando enviado ao gateway.`, false);
    registrarComando(rotulo, true);
    setTimeout(carregarStatusAdmin, 800);
  } catch (e) {
    feedback(`Falha ao enviar "${rotulo}". Confira o IP/porta do gateway e a rede local.`, true);
    registrarComando(rotulo, false);
  } finally {
    comandoEmAndamento = false;
    if (card) card.classList.remove('is-busy');
    aplicarModoAutoUI();
  }
}

/* ── FEEDBACK DOS COMANDOS ──────────────────────────────────────── */
function feedback(mensagem, erro) {
  const el = document.getElementById('ctrlMsg');
  if (!el) return;
  el.textContent = mensagem;
  el.className = 'ctrl-status-msg show' + (erro ? ' err' : '');
  if (timerFeedback) clearTimeout(timerFeedback);
  timerFeedback = setTimeout(() => { el.classList.remove('show'); }, 4000);
}

/* ── LOG DE COMANDOS (memória da sessão) ────────────────────────── */
let comandosSessao = [];

function registrarComando(descricao, ok) {
  comandosSessao.unshift({
    descricao,
    ok,
    quando: new Date().toLocaleTimeString('pt-BR')
  });
  if (comandosSessao.length > 12) comandosSessao.pop();
  renderComandos();
}

function comandoLogLimpar() {
  comandosSessao = [];
  renderComandos();
}

function renderComandos() {
  const el = document.getElementById('cmdLog');
  if (!el) return;
  if (comandosSessao.length === 0) {
    el.innerHTML = '<div class="no-alerts">Nenhum comando enviado nesta sessão.</div>';
    return;
  }
  el.innerHTML = comandosSessao.map(c => `
    <div class="cmd-item ${c.ok ? 'ok' : 'err'}">
      <span class="log-msg">${c.ok ? '✔' : '✖'} ${c.descricao}</span>
      <span class="cmd-when">${c.quando}</span>
    </div>`).join('');
}

