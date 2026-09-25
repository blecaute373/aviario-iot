/* ═══════════════════════════════════════════════════════════════════
   AVIÁRIO IoT · api.js — camada de dados compartilhada
   Encapsula o contrato HTTP do gateway/backend (modo Real) e o gerador
   local (modo Simulação, mock.js) atrás das mesmas funções:
     apiStatus()            → GET  /api/status
     apiHistorico(periodo)  → GET  /api/dados?periodo=1h|6h|24h|7d
     apiComandarAtuador()   → GET  /api/atuador?tipo=v1|v2|asp|neb&acao=on|off
     apiDefinirModoAuto()   → GET  /api/modo-auto?ativo=0|1
   Requer config.js (brokerBase/USE_MOCK) e mock.js carregados antes.
   ═══════════════════════════════════════════════════════════════════ */

async function apiStatus() {
  if (USE_MOCK) return (await mockFetchStatus()).json();
  const r = await fetch(brokerBase() + '/api/status', { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function apiHistorico(periodo) {
  if (USE_MOCK) return (await mockFetchHistorico(periodo)).json();
  /* Histórico vem do proxy InfluxDB 1.x do servidor local (scripts/serve.js).
     Na nuvem (estático) esta rota não existe — a UI mostra o estado de erro. */
  const r = await fetch('/api/dados?periodo=' + encodeURIComponent(periodo), { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function apiComandarAtuador(tipo, acao) {
  if (USE_MOCK) { await mockFetchAtuador(tipo, acao); return true; }
  const r = await fetch(`${brokerBase()}/api/atuador?tipo=${encodeURIComponent(tipo)}&acao=${encodeURIComponent(acao)}`);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return true;
}

async function apiDefinirModoAuto(ativo) {
  if (USE_MOCK) { await mockFetchModoAuto(ativo); return true; }
  const r = await fetch(`${brokerBase()}/api/modo-auto?ativo=${ativo ? 1 : 0}`);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return true;
}
