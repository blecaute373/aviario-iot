/* ═══════════════════════════════════════════════════════════════════
   AVIÁRIO IoT · acessos.js — monitoramento de usuários e acessos
   Seção exclusiva do painel de controle (admin.html): mostra quem entrou
   (administrador e usuários cadastrados), quando, de qual endereço e
   navegador, além dos cadastros e das falhas de login.
   Fonte no modo servidor: /api/admin/acessos e /api/admin/usuarios;
   no modo demonstração (sem banco), o histórico local do navegador.
   ═══════════════════════════════════════════════════════════════════ */

const CONFIG_ACESSOS = { updateMs: 20000, limite: 40 };
let filtroEvento = '';
let timerAcessos = null;

const EVENTOS_ROTULO = {
  entrada: 'Entrada',
  saida: 'Saída',
  cadastro: 'Cadastro',
  falha_usuario: 'Falha — usuário',
  falha_senha: 'Falha — senha'
};

document.addEventListener('DOMContentLoaded', () => {
  const filtro = document.getElementById('accFiltro');
  if (filtro) filtro.addEventListener('change', () => { filtroEvento = filtro.value; carregarAcessos(); });
  carregarAcessos();
  timerAcessos = setInterval(() => { if (!document.hidden) carregarAcessos(); }, CONFIG_ACESSOS.updateMs);
});

/* ── Formatação ─────────────────────────────────────────────────── */
function escaparHtml(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function formatarQuando(iso) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '--' : d.toLocaleString('pt-BR');
}

/* Resume o navegador a partir do user-agent (sem guardar strings longas) */
function abreviarAgente(agente) {
  const a = String(agente || '');
  if (/edg/i.test(a)) return 'Edge';
  if (/chrome|crios/i.test(a)) return 'Chrome';
  if (/firefox|fxios/i.test(a)) return 'Firefox';
  if (/safari/i.test(a)) return 'Safari';
  if (/curl|node|postman/i.test(a)) return 'Terminal';
  return a ? a.slice(0, 28) : '--';
}

function rotuloEvento(evento) {
  return EVENTOS_ROTULO[evento] || evento || '--';
}

/* ── Carga dos dados (servidor de acesso ou demonstração local) ─── */
async function carregarAcessos() {
  const chip = document.getElementById('accChip');
  const msg = document.getElementById('accMsg');
  const modo = window.AEREM_AUTH ? AEREM_AUTH.modo : 'estatico';

  try {
    if (modo === 'servidor') {
      const filtro = filtroEvento ? '&evento=' + encodeURIComponent(filtroEvento) : '';
      const [acessos, usuarios] = await Promise.all([
        pedirJson('/api/admin/acessos?limite=' + CONFIG_ACESSOS.limite + filtro),
        pedirJson('/api/admin/usuarios')
      ]);

      if (acessos.status === 401 || acessos.status === 403 || !acessos.ok || !usuarios.ok) {
        if (msg) msg.textContent = 'Sessão de administrador necessária — entre novamente para acompanhar os acessos.';
        return;
      }

      renderizarResumo(acessos.resumo);
      renderizarAcessos(acessos.dados);
      renderizarUsuarios(usuarios.dados);
      if (chip) chip.textContent = acessos.total + ' evento(s) no servidor';
      if (msg) msg.textContent = 'Monitoramento no servidor de acesso · atualizado às ' + new Date().toLocaleTimeString('pt-BR');
      return;
    }

    /* Demonstração: histórico mantido neste navegador */
    const locais = window.AEREM_AUTH ? AEREM_AUTH.listarAcessosLocais() : [];
    const usuariosLocais = window.AEREM_AUTH ? AEREM_AUTH.listarUsuariosLocais() : [];
    const filtrados = filtroEvento ? locais.filter(a => a.evento === filtroEvento) : locais;
    const hoje = new Date().toISOString().slice(0, 10);
    const doDia = locais.filter(a => String(a.quando || '').slice(0, 10) === hoje);

    renderizarResumo({
      usuarios: usuariosLocais.length,
      acessos_hoje: doDia.filter(a => a.evento === 'entrada').length,
      falhas_hoje: doDia.filter(a => String(a.evento || '').startsWith('falha')).length,
      sessoes_ativas: window.AEREM_AUTH && AEREM_AUTH.usuario ? 1 : 0
    });
    renderizarAcessos(filtrados);
    renderizarUsuarios(usuariosLocais);
    if (chip) chip.textContent = filtrados.length + ' evento(s) neste navegador';
    if (msg) {
      msg.textContent = modo === 'demo-nuvem'
        ? 'Demonstração na nuvem: para registrar acessos de outros dispositivos, defina MONGODB_URI no projeto Vercel.'
        : 'Modo local: os eventos exibidos são apenas deste navegador (sem servidor de acesso).';
    }
  } catch {
    if (msg) msg.textContent = 'Falha ao carregar o monitoramento de acessos.';
  }
}

/* ── Indicadores (KPIs) ─────────────────────────────────────────── */
function renderizarResumo(resumo) {
  const r = resumo || {};
  const definir = (id, valor) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(valor == null ? 0 : valor);
  };
  definir('accKpiUsuarios', r.usuarios);
  definir('accKpiEntradas', r.acessos_hoje);
  definir('accKpiFalhas', r.falhas_hoje);
  definir('accKpiSessoes', r.sessoes_ativas);
}

/* ── Tabela de acessos (quem entrou, quando, de onde) ───────────── */
function renderizarAcessos(lista) {
  const corpo = document.getElementById('accLogBody');
  if (!corpo) return;
  const eventos = Array.isArray(lista) ? lista : [];
  if (!eventos.length) {
    corpo.innerHTML = '<tr><td colspan="6" class="acc-vazio">Nenhum evento registrado' +
      (filtroEvento ? ' para o filtro selecionado.' : ' ainda.') + '</td></tr>';
    return;
  }
  corpo.innerHTML = eventos.map(a => {
    const classe = 'ev-' + String(a.evento || 'outro').replace(/[^a-z_]/g, '');
    const nome = a.nome ? '<small>' + escaparHtml(a.nome) + '</small>' : '';
    const perfil = (a.usuario === 'admin') ? ' <span class="ev-chip ev-admin">admin</span>' : '';
    return '<tr>' +
      '<td class="acc-quando">' + escaparHtml(formatarQuando(a.quando)) + '</td>' +
      '<td><span class="ev-chip ' + classe + '">' + escaparHtml(rotuloEvento(a.evento)) + '</span></td>' +
      '<td><strong>' + escaparHtml(a.usuario || '--') + '</strong>' + perfil + nome + '</td>' +
      '<td>' + escaparHtml(a.ip || '--') + '</td>' +
      '<td>' + escaparHtml(abreviarAgente(a.agente)) + '</td>' +
      '<td>' + escaparHtml(a.detalhe || '--') + '</td>' +
    '</tr>';
  }).join('');
}

/* ── Tabela de usuários cadastrados ─────────────────────────────── */
function renderizarUsuarios(lista) {
  const corpo = document.getElementById('usrBody');
  if (!corpo) return;
  const usuarios = Array.isArray(lista) ? lista : [];
  if (!usuarios.length) {
    corpo.innerHTML = '<tr><td colspan="6" class="acc-vazio">Nenhum usuário cadastrado ainda — ' +
      'use “Criar conta” na tela de acesso.</td></tr>';
    return;
  }
  corpo.innerHTML = usuarios.map(u => {
    const admin = u.perfil === 'admin' || u.usuario === 'admin';
    return '<tr>' +
      '<td><strong>' + escaparHtml(u.nome || '--') + '</strong>' +
        (admin ? ' <span class="ev-chip ev-admin">admin</span>' : '') + '</td>' +
      '<td>' + escaparHtml(u.usuario || '--') + '</td>' +
      '<td>' + escaparHtml(u.email || '--') + '</td>' +
      '<td>' + escaparHtml(u.funcao || '--') + '</td>' +
      '<td class="acc-quando">' + escaparHtml(u.criado_em ? formatarQuando(u.criado_em) : 'pré-configurado') + '</td>' +
      '<td class="acc-quando">' + escaparHtml(u.ultimo_acesso ? formatarQuando(u.ultimo_acesso) : 'nunca') + '</td>' +
    '</tr>';
  }).join('');
}

/* Atualização manual (botão do painel) */
function atualizarAcessos() {
  carregarAcessos();
}

