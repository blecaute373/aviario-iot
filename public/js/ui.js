/* ═══════════════════════════════════════════════════════════════════
   AVIÁRIO IoT · ui.js — helpers de interface compartilhados
   (formatação, anéis SVG, barras, deltas, chips de estado, status pill,
   contagem regressiva de atualização, exportação CSV e limiares).
   ═══════════════════════════════════════════════════════════════════ */

/* Limites operacionais padrão (sincronizados com flows.json / Node-RED).
   O /api/status pode enviar `limites` e sobrescrever estes valores. */
const LIMITES_PADRAO = {
  tempMin: 15.0,
  tempMax: 32.0,
  umidMin: 40.0,
  umidMax: 80.0,
  nh3Max: 25.0
};

/* Metadados dos atuadores reais do aviário */
const ATUADORES = [
  { id: 'v1',  nome: 'Ventilador 1', desc: 'Exaustão principal' },
  { id: 'v2',  nome: 'Ventilador 2', desc: 'Exaustão auxiliar' },
  { id: 'asp', nome: 'Aspersor',     desc: 'Umidade do ar' },
  { id: 'neb', nome: 'Nebulizador',  desc: 'NH₃ e temperatura' }
];

function nomeAtuador(id) {
  const a = ATUADORES.find(x => x.id === id);
  return a ? a.nome : id;
}

function fmtNum(v, casas) {
  if (v === null || v === undefined || isNaN(Number(v))) return '--';
  return Number(v).toFixed(casas === undefined ? 1 : casas);
}

function clampPct(p) { return Math.max(0, Math.min(100, p)); }

function pctFaixa(v, min, max) {
  if (v === null || v === undefined || isNaN(Number(v)) || max === min) return 0;
  return clampPct(((Number(v) - min) / (max - min)) * 100);
}

/* Anel SVG (circunferência ~106.8 para r=17) e barra de progresso */
function setRing(id, pct) {
  const el = document.getElementById(id);
  if (!el) return;
  const c = 106.8;
  el.style.strokeDashoffset = c - (clampPct(pct) / 100) * c;
}

function setBar(id, pct) {
  const el = document.getElementById(id);
  if (el) el.style.width = clampPct(pct) + '%';
}

/* Delta vs leitura anterior */
function calcularDelta(atual, anterior, unidade) {
  if (anterior === null || anterior === undefined || isNaN(Number(anterior))) {
    return { texto: '— primeira leitura', classe: 'flat' };
  }
  const diff = Math.round((Number(atual) - Number(anterior)) * 10) / 10;
  if (Math.abs(diff) < 0.05) return { texto: '→ estável', classe: 'flat' };
  const seta = diff > 0 ? '▲' : '▼';
  const sinal = diff > 0 ? '+' : '';
  return { texto: `${seta} ${sinal}${diff.toFixed(1)} ${unidade} vs ant.`, classe: diff > 0 ? 'up' : 'down' };
}

function aplicarDelta(el, atual, anterior, unidade) {
  if (!el) return;
  const d = calcularDelta(atual, anterior, unidade);
  el.textContent = d.texto;
  el.className = 'delta ' + d.classe;
}

function setStateDot(el, estado, texto) {
  if (!el) return;
  el.className = 'state-dot state-' + estado;
  el.textContent = texto;
}

/* Semáforo de cada grandeza conforme os limites operacionais */
function estadoTemperatura(t, l) {
  if (t > l.tempMax || t < l.tempMin) return 'danger';
  if (t > l.tempMax - 2 || t < l.tempMin + 2) return 'warn';
  return 'ok';
}
function estadoUmidade(u, l) {
  return (u > l.umidMax || u < l.umidMin) ? 'warn' : 'ok';
}
function estadoPressao(p) {
  return (p >= 980 && p <= 1030) ? 'ok' : 'warn';
}
function estadoNh3(n, l) {
  if (n > l.nh3Max) return 'danger';
  if (n > l.nh3Max * 0.6) return 'warn';
  return 'ok';
}
function textoEstado(estado) {
  return { ok: '● NORMAL', warn: '● ATENÇÃO', danger: '● CRÍTICO', idle: '● AGUARDANDO' }[estado] || '● AGUARDANDO';
}

/* Pill de conexão do topbar */
function atualizarPillStatus(ok) {
  const b = document.getElementById('statusPill');
  const t = document.getElementById('statusText');
  if (!b) return;
  if (USE_MOCK) {
    b.className = 'status-pill simulation';
    if (t) t.textContent = 'Simulação';
  } else if (ok) {
    b.className = 'status-pill online';
    if (t) t.textContent = `Conectado · ${BROKER_IP}`;
  } else {
    b.className = 'status-pill offline';
    if (t) t.textContent = `Sem conexão · ${BROKER_IP}:${BROKER_PORT}`;
  }
}

function marcarAtualizado() {
  const el = document.getElementById('refreshInfo');
  if (el) el.textContent = 'Atualizado às ' + new Date().toLocaleTimeString('pt-BR');
}

/* Reinicia a barra de contagem para a próxima atualização */
function reiniciarCountdown(segundos) {
  const el = document.getElementById('countdownBar');
  if (!el) return;
  el.style.transition = 'none';
  el.style.width = '100%';
  void el.offsetWidth;
  el.style.transition = `width ${segundos || 5}s linear`;
  el.style.width = '0%';
}

/* Nome do usuário logado no topbar */
function preencherUsuarioLogado() {
  const el = document.getElementById('authUser');
  if (el) el.textContent = localStorage.getItem('aerem_auth_user') || '';
}

/* Exporta as séries atuais do gráfico em CSV */
function exportarCSV() {
  if (typeof mainChart === 'undefined' || !mainChart) {
    alert('O histórico ainda não foi carregado.');
    return;
  }
  const ds = mainChart.data.datasets;
  const mapa = new Map();
  ds.forEach((serie, i) => {
    (serie.data || []).forEach(pt => {
      const key = pt.x;
      if (!mapa.has(key)) mapa.set(key, {});
      mapa.get(key)[i] = pt.y;
    });
  });
  const linhas = ['data_hora,temperatura_c,umidade_pct,pressao_hpa,nh3_ppm'];
  [...mapa.keys()].sort((a, b) => a - b).forEach(k => {
    const r = mapa.get(k);
    linhas.push([
      new Date(k).toISOString(),
      r[0] !== undefined ? r[0] : '',
      r[1] !== undefined ? r[1] : '',
      r[2] !== undefined ? r[2] : '',
      r[3] !== undefined ? r[3] : ''
    ].join(','));
  });
  const blob = new Blob([linhas.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'aviario-historico-' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}
