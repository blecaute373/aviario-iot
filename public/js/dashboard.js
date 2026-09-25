/* ═══════════════════════════════════════════════════════════════════
   AVIÁRIO IoT · dashboard.js — consola de supervisão (index.html)
   Monitorização somente-leitura: 4 sensores ambientais, estado dos 4
   atuadores, gráfico histórico (Chart.js + /api/dados via InfluxDB 1.x),
   alertas operacionais e qualidade do enlace LoRa.
   O controle manual dos atuadores fica no painel administrativo
   (admin.html) — este console apenas exibe o estado.
   ═══════════════════════════════════════════════════════════════════ */

const CONFIG_DASH = {
  updateMs: 5000,        /* leitura de /api/status */
  historicoMs: 15000,    /* recarga do gráfico */
  primeiraCarga: true
};

let mainChart = null;
let currentPeriod = '6h';
let limites = Object.assign({}, LIMITES_PADRAO);
let modoAutoGlobal = false;
let ultimosValores = null;

document.addEventListener('DOMContentLoaded', () => {
  initChart();
  preencherUsuarioLogado();
  atualizarPillStatus(false);
  carregarStatus();
  carregarHistorico(currentPeriod);

  document.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentPeriod = btn.dataset.period;
      carregarHistorico(currentPeriod);
    });
  });

  document.querySelectorAll('.legend-item').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!mainChart) return;
      const idx = parseInt(btn.dataset.series, 10);
      if (mainChart.isDatasetVisible(idx)) {
        mainChart.hide(idx);
        btn.classList.add('off');
      } else {
        mainChart.show(idx);
        btn.classList.remove('off');
      }
    });
  });

  setInterval(carregarStatus, CONFIG_DASH.updateMs);
  setInterval(() => carregarHistorico(currentPeriod), CONFIG_DASH.historicoMs);

  /* Troca de modo (Simulação/Real) ou de endereço do gateway no modal */
  document.addEventListener('aerem:modo', recarregarTudo);
  document.addEventListener('aerem:config', () => { if (!USE_MOCK) recarregarTudo(); });
});

function recarregarTudo() {
  CONFIG_DASH.primeiraCarga = true;
  ultimosValores = null;
  carregarStatus();
  carregarHistorico(currentPeriod);
}

/* ── LEITURA DO STATUS ──────────────────────────────────────────── */
async function carregarStatus() {
  try {
    const d = await apiStatus();
    if (d.limites) limites = d.limites;
    modoAutoGlobal = !!d.modoAutomatico;

    aplicarSensores(d);
    aplicarAtuadores(d.atuadores);
    aplicarSistema(d);
    processarAlertas(d);

    ultimosValores = {
      t: Number(d.temperatura),
      u: Number(d.umidade),
      p: Number(d.pressao_hpa !== undefined ? d.pressao_hpa : (Number(d.pressao_pa) / 100)),
      n: Number(d.nh3_ppm)
    };

    atualizarPillStatus(true);
    marcarAtualizado();
    reiniciarCountdown(CONFIG_DASH.updateMs / 1000);
    CONFIG_DASH.primeiraCarga = false;
  } catch (e) {
    atualizarPillStatus(false);
  }
}

/* ── SENSORES ───────────────────────────────────────────────────── */
function aplicarSensores(d) {
  const t = Number(d.temperatura);
  const u = Number(d.umidade);
  const p = Number(d.pressao_hpa !== undefined ? d.pressao_hpa : (Number(d.pressao_pa) / 100 || 1013));
  const n = Number(d.nh3_ppm);

  setTexto('valTemp', fmtNum(t)); setTexto('valUmid', fmtNum(u));
  setTexto('valPres', fmtNum(p, 0)); setTexto('valNh3', fmtNum(n));

  const ant = ultimosValores;
  aplicarDelta(document.getElementById('deltaTemp'), t, ant ? ant.t : null, '°C');
  aplicarDelta(document.getElementById('deltaUmid'), u, ant ? ant.u : null, '%');
  aplicarDelta(document.getElementById('deltaPres'), p, ant ? ant.p : null, 'hPa');
  aplicarDelta(document.getElementById('deltaNh3'), n, ant ? ant.n : null, 'ppm');

  /* Anéis e barras: posição da leitura na escala do instrumento */
  const pctT = pctFaixa(t, 10, 42);
  const pctU = pctFaixa(u, 0, 100);
  const pctP = pctFaixa(p, 960, 1040);
  const pctN = pctFaixa(n, 0, 35);
  setRing('ringTemp', pctT); setBar('barTemp', pctT);
  setRing('ringUmid', pctU); setBar('barUmid', pctU);
  setRing('ringPres', pctP); setBar('barPres', pctP);
  setRing('ringNh3', pctN);  setBar('barNh3', pctN);

  /* Chips de estado conforme os limites operacionais */
  const estT = estadoTemperatura(t, limites);
  const estU = estadoUmidade(u, limites);
  const estP = estadoPressao(p);
  const estN = estadoNh3(n, limites);
  setStateDot(document.getElementById('stateTemp'), estT, textoEstado(estT));
  setStateDot(document.getElementById('stateUmid'), estU, textoEstado(estU));
  setStateDot(document.getElementById('statePres'), estP, textoEstado(estP));
  setStateDot(document.getElementById('stateNh3'), estN, textoEstado(estN));

  /* Destaque de card em situação crítica */
  marcarCritico('cardTemp', estT);
  marcarCritico('cardUmid', estU);
  marcarCritico('cardNh3', estN);

  /* Sublabels com os limites vindos do gateway */
  setTexto('subTemp', `Limite ${fmtNum(limites.tempMin, 0)}–${fmtNum(limites.tempMax, 0)} °C`);
  setTexto('subUmid', `Limite ${fmtNum(limites.umidMin, 0)}–${fmtNum(limites.umidMax, 0)} %`);
  setTexto('subPres', 'Nominal 980–1030 hPa');
  setTexto('subNh3', `Crítico acima de ${fmtNum(limites.nh3Max, 0)} ppm`);

  const chip = document.getElementById('kpiUpdated');
  if (chip) chip.textContent = 'atualizado às ' + new Date().toLocaleTimeString('pt-BR');
}

function setTexto(id, texto) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = texto;
  el.classList.remove('skel');
}

function marcarCritico(cardId, estado) {
  const el = document.getElementById(cardId);
  if (el) el.classList.toggle('is-crit', estado === 'danger');
}

/* ── ATUADORES (somente leitura) ────────────────────────────────── */
function aplicarAtuadores(atuadores) {
  let ativos = 0;
  ATUADORES.forEach(a => {
    const ligado = atuadores ? Number(atuadores[a.id]) === 1 : false;
    if (ligado) ativos++;

    const card = document.querySelector(`.actuator-card[data-tipo="${a.id}"]`);
    if (card) card.classList.toggle('is-on', ligado);

    const chip = document.getElementById('chip-' + a.id);
    if (chip) {
      chip.className = 'act-chip ' + (ligado ? 'chip-on' : 'chip-off');
      chip.innerHTML = '<span class="chip-dot"></span>' + (ligado ? 'Ligado' : 'Desligado');
    }

    const modo = document.getElementById('mode-' + a.id);
    if (modo) modo.textContent = modoAutoGlobal ? 'AUTOMÁTICO' : 'MANUAL';
  });

  const resumo = document.getElementById('actSummary');
  if (resumo) resumo.textContent = `${ativos}/4 ativos · modo ${modoAutoGlobal ? 'automático' : 'manual'}`;
}

/* ── SISTEMA E ENLACE LORA ──────────────────────────────────────── */
function aplicarSistema(d) {
  const elUltima = document.getElementById('sysUltima');
  const elRssi = document.getElementById('sysRssi');
  const elSnr = document.getElementById('sysSnr');
  const elBroker = document.getElementById('sysBroker');
  const elModo = document.getElementById('sysModo');
  const elNos = document.getElementById('sysNos');

  if (elUltima) {
    const s = Number(d.tempoUltimaLeitura);
    if (!isNaN(s) && s >= 0) {
      const m = Math.floor(s / 60);
      elUltima.textContent = m > 0 ? `${m}m ${s % 60}s atrás` : `${s}s atrás`;
    } else {
      elUltima.textContent = 'agora';
    }
  }

  if (elRssi) {
    const r = Number(d.rssi);
    if (isNaN(r)) { elRssi.textContent = '--'; elRssi.className = 'sys-value'; }
    else {
      elRssi.textContent = `${r} dBm`;
      elRssi.className = 'sys-value ' + (r >= -90 ? 'ok' : r >= -105 ? 'warn' : 'danger');
    }
  }

  if (elSnr) {
    const s = Number(d.snr);
    elSnr.textContent = isNaN(s) ? '--' : `${s} dB`;
    elSnr.className = 'sys-value ' + (!isNaN(s) && s >= 7 ? 'ok' : 'warn');
  }

  if (elBroker) elBroker.textContent = USE_MOCK ? 'Simulação local' : `${BROKER_IP}:${BROKER_PORT}`;
  if (elModo) {
    elModo.textContent = modoAutoGlobal ? 'AUTOMÁTICO' : 'MANUAL';
    elModo.className = 'sys-value ' + (modoAutoGlobal ? 'ok' : '');
  }
  if (elNos) {
    const n = Array.isArray(d.nosAtivos) ? d.nosAtivos.length : null;
    elNos.textContent = n === null ? '--' : `${n} nó(s) LoRa`;
  }
}

/* ── ALERTAS OPERACIONAIS ───────────────────────────────────────── */
function processarAlertas(d) {
  const logEl = document.getElementById('alertsLog');
  const countEl = document.getElementById('badgeCount');
  if (!logEl) return;

  const t = Number(d.temperatura);
  const u = Number(d.umidade);
  const n = Number(d.nh3_ppm);
  const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const alertas = [];

  if (t > limites.tempMax) {
    alertas.push({ nivel: 'danger', msg: `Temperatura crítica: ${fmtNum(t)} °C (limite ${fmtNum(limites.tempMax, 0)} °C) — ventilação e nebulização em auto` });
  } else if (t < limites.tempMin) {
    alertas.push({ nivel: 'danger', msg: `Temperatura baixa: ${fmtNum(t)} °C (mínimo ${fmtNum(limites.tempMin, 0)} °C) — aquecimento recomendado` });
  }
  if (u > limites.umidMax) {
    alertas.push({ nivel: 'warn', msg: `Umidade elevada: ${fmtNum(u)} % (limite ${fmtNum(limites.umidMax, 0)} %) — cama pode compactar` });
  } else if (u < limites.umidMin) {
    alertas.push({ nivel: 'warn', msg: `Umidade baixa: ${fmtNum(u)} % (mínimo ${fmtNum(limites.umidMin, 0)} %) — aspersor em auto` });
  }
  if (n > limites.nh3Max) {
    alertas.push({ nivel: 'danger', msg: `Amônia (NH₃) crítica: ${fmtNum(n)} ppm (limite ${fmtNum(limites.nh3Max, 0)} ppm) — nebulizador em auto` });
  } else if (n > limites.nh3Max * 0.6) {
    alertas.push({ nivel: 'warn', msg: `Amônia (NH₃) em atenção: ${fmtNum(n)} ppm` });
  }

  if (countEl) {
    countEl.textContent = alertas.length;
    countEl.classList.toggle('hidden', alertas.length === 0);
  }

  if (alertas.length === 0) {
    logEl.innerHTML = '<div class="no-alerts">Nenhum alerta — sistema saudável 🌿🐔</div>';
    return;
  }
  logEl.innerHTML = alertas.map(a => `
    <div class="log-item ${a.nivel}">
      <span class="log-msg">${a.msg}</span>
      <span class="log-time">${hora}</span>
    </div>`).join('');
}

function limparAlertas() {
  const logEl = document.getElementById('alertsLog');
  const countEl = document.getElementById('badgeCount');
  if (logEl) logEl.innerHTML = '<div class="no-alerts">Log limpo pelo operador.</div>';
  if (countEl) { countEl.textContent = '0'; countEl.classList.add('hidden'); }
}

/* ── GRÁFICO HISTÓRICO ──────────────────────────────────────────── */
function initChart() {
  const canvas = document.getElementById('mainChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  mainChart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'Temperatura (°C)', borderColor: '#f87171',
          backgroundColor: 'rgba(248,113,113,0.07)', borderWidth: 2,
          fill: true, tension: 0.35, pointRadius: 0, pointHoverRadius: 5, yAxisID: 'y'
        },
        {
          label: 'Umidade (%)', borderColor: '#38bdf8',
          backgroundColor: 'rgba(56,189,248,0.07)', borderWidth: 2,
          fill: true, tension: 0.35, pointRadius: 0, pointHoverRadius: 5, yAxisID: 'y'
        },
        {
          label: 'Pressão (hPa)', borderColor: '#34d399',
          backgroundColor: 'rgba(52,211,153,0.05)', borderWidth: 2,
          fill: false, tension: 0.35, pointRadius: 0, pointHoverRadius: 5, yAxisID: 'yPres'
        },
        {
          label: 'NH₃ (ppm)', borderColor: '#fbbf24',
          backgroundColor: 'rgba(251,191,36,0.07)', borderWidth: 2,
          fill: true, tension: 0.35, pointRadius: 0, pointHoverRadius: 5, yAxisID: 'y'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(6,12,20,0.96)',
          padding: 12,
          borderColor: 'rgba(122,168,255,0.22)',
          borderWidth: 1,
          callbacks: {
            title: ctxArr => ctxArr[0]?.parsed?.x ? new Date(ctxArr[0].parsed.x).toLocaleString('pt-BR') : ''
          }
        }
      },
      scales: {
        x: {
          type: 'time',
          time: { displayFormats: { minute: 'HH:mm', hour: 'HH:mm', day: 'dd/MM' } },
          grid: { color: 'rgba(226,240,255,0.05)' },
          ticks: { color: '#7286a6', maxTicksLimit: 8 }
        },
        y: {
          type: 'linear', position: 'left', min: 0, max: 60,
          title: { display: true, text: '°C / % / ppm', color: '#7286a6' },
          grid: { color: 'rgba(226,240,255,0.05)' },
          ticks: { color: '#7286a6' }
        },
        yPres: {
          type: 'linear', position: 'right', min: 960, max: 1040,
          title: { display: true, text: 'hPa', color: '#7286a6' },
          grid: { drawOnChartArea: false },
          ticks: { color: '#7286a6' }
        }
      },
      animation: { duration: 400 }
    }
  });
}

function periodoMs(p) {
  return { '1h': 3600000, '6h': 6 * 3600000, '24h': 24 * 3600000, '7d': 7 * 24 * 3600000 }[p] || 3600000;
}

async function carregarHistorico(periodo) {
  const erro = document.getElementById('chartError');
  const sub = document.getElementById('chartSub');
  try {
    const d = await apiHistorico(periodo);
    const pontos = (d && Array.isArray(d.dados)) ? d.dados : [];
    const tempD = [], umidD = [], presD = [], nh3D = [];

    pontos.forEach(p => {
      if (p.temp !== null && p.temp !== undefined) tempD.push({ x: p.t, y: p.temp });
      if (p.umid !== null && p.umid !== undefined) umidD.push({ x: p.t, y: p.umid });
      if (p.pres_hpa !== null && p.pres_hpa !== undefined) presD.push({ x: p.t, y: p.pres_hpa });
      if (p.nh3 !== null && p.nh3 !== undefined) nh3D.push({ x: p.t, y: p.nh3 });
    });

    if (mainChart) {
      mainChart.data.datasets[0].data = tempD;
      mainChart.data.datasets[1].data = umidD;
      mainChart.data.datasets[2].data = presD;
      mainChart.data.datasets[3].data = nh3D;
      const agora = Date.now();
      mainChart.options.scales.x.min = agora - periodoMs(periodo);
      mainChart.options.scales.x.max = agora;
      mainChart.update('none');
    }
    if (erro) erro.classList.remove('show');
    if (sub) sub.textContent = `${pontos.length} pontos · ${USE_MOCK ? 'simulação' : 'InfluxDB 1.x'} · clique na legenda para ocultar`;
  } catch (e) {
    if (erro) erro.classList.add('show');
    if (sub) sub.textContent = 'histórico indisponível';
  }
}

