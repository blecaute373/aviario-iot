/* ═══════════════════════════════════════════════════════════════════
   AVIÁRIO IoT · config.js — conexão (IP/porta do gateway), modo de
   operação (Simulação/Real) e modal de configuração de rede.
   Carregado pela consola (index.html) e pelo painel (admin.html).
   ═══════════════════════════════════════════════════════════════════ */

const DEFAULT_BROKER_IP = '192.168.0.5';
const DEFAULT_BROKER_PORT = '80';

let BROKER_IP = localStorage.getItem('aerem_broker_ip') || DEFAULT_BROKER_IP;
let BROKER_PORT = localStorage.getItem('aerem_broker_port') || DEFAULT_BROKER_PORT;

/* Modo de operação: 'sim' (dados locais) ou 'real' (gateway na rede local).
   A escolha persiste entre sessões (localStorage). */
let USE_MOCK = (localStorage.getItem('aerem_modo') || 'sim') !== 'real';

function brokerBase() {
  return `http://${BROKER_IP}:${BROKER_PORT}`;
}

function aplicarModoUI() {
  const btnSim = document.getElementById('btnSimulacao');
  const btnReal = document.getElementById('btnReal');
  if (btnSim) btnSim.className = 'mode-toggle-btn' + (USE_MOCK ? ' active-sim' : '');
  if (btnReal) btnReal.className = 'mode-toggle-btn' + (!USE_MOCK ? ' active-real' : '');
}

/* Troca o modo e avisa as páginas (elas recarregam os dados ao ouvir). */
function setModo(simulacao) {
  USE_MOCK = !!simulacao;
  localStorage.setItem('aerem_modo', USE_MOCK ? 'sim' : 'real');
  aplicarModoUI();
  document.dispatchEvent(new CustomEvent('aerem:modo', { detail: { simulacao: USE_MOCK } }));
}

/* ── Modal de configuração de rede ───────────────────────────────── */
function openSettings() {
  document.getElementById('brokerIpInput').value = BROKER_IP;
  document.getElementById('brokerPortInput').value = BROKER_PORT;
  document.getElementById('settingsError').textContent = '';
  document.getElementById('settingsModal').classList.add('active');
}

function closeSettings() {
  document.getElementById('settingsModal').classList.remove('active');
}

function saveSettings() {
  const ip = document.getElementById('brokerIpInput').value.trim();
  const port = document.getElementById('brokerPortInput').value.trim();
  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$|^[a-zA-Z0-9.-]+$/;
  if (!ip || !ipRegex.test(ip)) {
    document.getElementById('settingsError').textContent = 'Informe um endereço IP ou host válido.';
    return;
  }
  if (port && !/^\d{1,5}$/.test(port)) {
    document.getElementById('settingsError').textContent = 'Informe uma porta válida (apenas números).';
    return;
  }
  BROKER_IP = ip;
  BROKER_PORT = port || DEFAULT_BROKER_PORT;
  localStorage.setItem('aerem_broker_ip', BROKER_IP);
  localStorage.setItem('aerem_broker_port', BROKER_PORT);
  closeSettings();
  document.dispatchEvent(new CustomEvent('aerem:config'));
}

document.addEventListener('DOMContentLoaded', aplicarModoUI);
