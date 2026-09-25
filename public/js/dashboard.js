    // Inicialização da tela de login
    const loginPassEl = document.getElementById('loginPass');
    if (loginPassEl) {
        loginPassEl.addEventListener('keydown', e => { if (e.key === 'Enter') handleLoginSubmit(); });
    }
    if (sessionStorage.getItem('aerem_logged_in') === '1') {
        hideLoginScreen();
    } else {
        showLoginScreen();
    }

    const CONFIG = {
        updateInterval: 5000,
        limites: {
            tempMin: 15.0,
            tempMax: 32.0,
            umidMin: 40.0,
            umidMax: 80.0,
            nh3Max: 25.0
        }
    };

    let mainChart = null;
    let currentPeriod = '6h';
    let limites = CONFIG.limites;
    let modoAutomaticoGlobal = false;
    let ultimosValores = null;
    const historicoAlertas = [];

    function setMode(simulacao) {
        USE_MOCK = simulacao;
        const btnSim = document.getElementById('btnSimulacao');
        const btnReal = document.getElementById('btnReal');
        if (btnSim) btnSim.className = 'mode-toggle-btn' + (simulacao ? ' active-sim' : '');
        if (btnReal) btnReal.className = 'mode-toggle-btn' + (!simulacao ? ' active-real' : '');
        updateConnectionStatus(true);
        loadStatus();
        loadHistorico(currentPeriod);
    }

    document.addEventListener('DOMContentLoaded', () => {
        initChart();
        loadStatus();
        loadHistorico(currentPeriod);

        document.querySelectorAll('.period-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentPeriod = btn.dataset.period;
                loadHistorico(currentPeriod);
            });
        });

        document.querySelectorAll('.legend-toggle-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (!mainChart) return;
                const idx = parseInt(btn.dataset.series, 10);
                const isVisible = mainChart.isDatasetVisible(idx);
                if (isVisible) {
                    mainChart.hide(idx);
                    btn.classList.add('off');
                } else {
                    mainChart.show(idx);
                    btn.classList.remove('off');
                }
            });
        });

        setInterval(() => loadStatus(), CONFIG.updateInterval);
        setInterval(() => loadHistorico(currentPeriod), CONFIG.updateInterval * 3);
    });

    function setRingOffset(id, pct) {
        const el = document.getElementById(id);
        if (!el) return;
        const circumference = 106.8;
        const val = Math.max(0, Math.min(100, pct));
        const offset = circumference - (val / 100) * circumference;
        el.style.strokeDashoffset = offset;
    }

    function setProgressBar(id, pct) {
        const el = document.getElementById(id);
        if (el) el.style.width = Math.max(0, Math.min(100, pct)) + '%';
    }

    function calcularDelta(atual, anterior, unidade) {
        if (anterior === null || anterior === undefined) {
            return { texto: '— primeira leitura', classe: 'flat' };
        }
        const diff = Math.round((atual - anterior) * 10) / 10;
        if (Math.abs(diff) < 0.05) {
            return { texto: '→ estável', classe: 'flat' };
        }
        if (diff > 0) {
            return { texto: `▲ +${diff.toFixed(1)} ${unidade} vs ant.`, classe: 'up' };
        }
        return { texto: `▼ ${diff.toFixed(1)} ${unidade} vs ant.`, classe: 'down' };
    }
    function initChart() {
        const ctx = document.getElementById('mainChart').getContext('2d');
        mainChart = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [
                    {
                        label: 'Temperatura (°C)',
                        borderColor: '#f87171',
                        backgroundColor: 'rgba(248,113,113,0.08)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.35,
                        pointRadius: 0,
                        pointHoverRadius: 5,
                        yAxisID: 'y'
                    },
                    {
                        label: 'Umidade (%)',
                        borderColor: '#38bdf8',
                        backgroundColor: 'rgba(56,189,248,0.08)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.35,
                        pointRadius: 0,
                        pointHoverRadius: 5,
                        yAxisID: 'y'
                    },
                    {
                        label: 'Pressão (hPa)',
                        borderColor: '#34d399',
                        backgroundColor: 'rgba(52,211,153,0.05)',
                        borderWidth: 2,
                        fill: false,
                        tension: 0.35,
                        pointRadius: 0,
                        pointHoverRadius: 5,
                        yAxisID: 'yPres'
                    },
                    {
                        label: 'NH₃ (ppm)',
                        borderColor: '#fbbf24',
                        backgroundColor: 'rgba(251,191,36,0.08)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.35,
                        pointRadius: 0,
                        pointHoverRadius: 5,
                        yAxisID: 'y'
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
                        backgroundColor: 'rgba(7,10,16,0.95)',
                        padding: 12,
                        borderColor: '#1e2535',
                        borderWidth: 1,
                        callbacks: {
                            title: ctx => ctx[0]?.parsed?.x ? new Date(ctx[0].parsed.x).toLocaleString('pt-BR') : ''
                        }
                    }
                },
                scales: {
                    x: {
                        type: 'time',
                        time: { displayFormats: { minute: 'HH:mm', hour: 'HH:mm', day: 'dd/MM' } },
                        grid: { color: 'rgba(255,255,255,0.04)' },
                        ticks: { color: '#64748b', maxTicksLimit: 8 }
                    },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: { display: true, text: '°C / % / ppm', color: '#64748b' },
                        min: 0,
                        max: 60,
                        grid: { color: 'rgba(255,255,255,0.04)' },
                        ticks: { color: '#64748b' }
                    },
                    yPres: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        title: { display: true, text: 'hPa', color: '#64748b' },
                        min: 960,
                        max: 1040,
                        grid: { drawOnChartArea: false },
                        ticks: { color: '#64748b' }
                    }
                },
                animation: { duration: 400 }
            }
        });
    }

    async function loadStatus() {
        try {
            const r = USE_MOCK ? await mockFetchStatus() : await fetch(`http://${BROKER_IP}:${BROKER_PORT}/api/status`);
            if (!r.ok) throw new Error();
            const d = await r.json();
            if (d.limites) limites = d.limites;
            if (d.modoAutomatico !== undefined) modoAutomaticoGlobal = d.modoAutomatico;

            updateSensoresUI(d);
            updateAtuadoresUI(d.atuadores);
            updateModoAutoUI(modoAutomaticoGlobal);
            updateSistemaUI(d);
            processarAlertas(d);
            updateConnectionStatus(true);
        } catch (e) {
            updateConnectionStatus(false);
        }
    }
    function updateSensoresUI(d) {
        const t = d.temperatura !== undefined ? Number(d.temperatura) : 0;
        const u = d.umidade !== undefined ? Number(d.umidade) : 0;
        const p = d.pressao_hpa || (d.pressao_pa ? Math.round(d.pressao_pa / 100) : 1013);
        const nh3 = d.nh3_ppm !== undefined ? Number(d.nh3_ppm) : 0;

        document.getElementById('valTemp').textContent = t.toFixed(1);
        document.getElementById('valUmid').textContent = u.toFixed(1);
        document.getElementById('valPres').textContent = p;
        document.getElementById('valNh3').textContent = nh3.toFixed(1);

        // Deltas vs leitura anterior
        if (ultimosValores) {
            const dTemp = calcularDelta(t, ultimosValores.t, '°C');
            const dUmid = calcularDelta(u, ultimosValores.u, '%');
            const dPres = calcularDelta(p, ultimosValores.p, 'hPa');
            const dNh3 = calcularDelta(nh3, ultimosValores.nh3, 'ppm');

            const elDt = document.getElementById('deltaTemp');
            if (elDt) { elDt.textContent = dTemp.texto; elDt.className = 'delta ' + dTemp.classe; }
            const elDu = document.getElementById('deltaUmid');
            if (elDu) { elDu.textContent = dUmid.texto; elDu.className = 'delta ' + dUmid.classe; }
            const elDp = document.getElementById('deltaPres');
            if (elDp) { elDp.textContent = dPres.texto; elDp.className = 'delta ' + dPres.classe; }
            const elDn = document.getElementById('deltaNh3');
            if (elDn) { elDn.textContent = dNh3.texto; elDn.className = 'delta ' + dNh3.classe; }
        }

        ultimosValores = { t, u, p, nh3 };

        // Anéis SVG e Barras proporcionais (escalas personalizadas)
        // Temperatura: 0 a 50 °C
        const pctTemp = Math.min(100, Math.max(0, (t / 50) * 100));
        setRingOffset('ringTemp', pctTemp);
        setProgressBar('barTemp', pctTemp);

        // Umidade: 0 a 100 %
        const pctUmid = Math.min(100, Math.max(0, u));
        setRingOffset('ringUmid', pctUmid);
        setProgressBar('barUmid', pctUmid);

        // Pressão: 950 a 1050 hPa
        const pctPres = Math.min(100, Math.max(0, ((p - 950) / 100) * 100));
        setRingOffset('ringPres', pctPres);
        setProgressBar('barPres', pctPres);

        // NH3: 0 a 50 ppm
        const pctNh3 = Math.min(100, Math.max(0, (nh3 / 50) * 100));
        setRingOffset('ringNh3', pctNh3);
        setProgressBar('barNh3', pctNh3);

        // Chips de estado semântico baseados no flows.json
        // Temp: 15-32 ideal, >28 atenção, >32 ou <15 crítico
        const chipTemp = document.getElementById('chipTemp');
        if (chipTemp) {
            if (t > limites.tempMax || t < limites.tempMin) {
                chipTemp.className = 'state-chip crit';
                chipTemp.textContent = t > limites.tempMax ? '● ALTA' : '● BAIXA';
            } else if (t > 28) {
                chipTemp.className = 'state-chip warn';
                chipTemp.textContent = '● ATENÇÃO';
            } else {
                chipTemp.className = 'state-chip ok';
                chipTemp.textContent = '● IDEAL';
            }
        }

        // Umidade: 40-80 ideal, >60 atenção, >80 ou <40 crítico
        const chipUmid = document.getElementById('chipUmid');
        if (chipUmid) {
            if (u > limites.umidMax || u < limites.umidMin) {
                chipUmid.className = 'state-chip crit';
                chipUmid.textContent = u > limites.umidMax ? '● ELEVADA' : '● BAIXA';
            } else if (u > 60) {
                chipUmid.className = 'state-chip warn';
                chipUmid.textContent = '● ATENÇÃO';
            } else {
                chipUmid.className = 'state-chip ok';
                chipUmid.textContent = '● IDEAL';
            }
        }

        // Pressão: 980-1030 nominal
        const chipPres = document.getElementById('chipPres');
        if (chipPres) {
            if (p < 980 || p > 1030) {
                chipPres.className = 'state-chip warn';
                chipPres.textContent = '● VARIANDO';
            } else {
                chipPres.className = 'state-chip ok';
                chipPres.textContent = '● NOMINAL';
            }
        }

        // NH3: <15 ideal, 15-25 atenção, >25 crítico
        const chipNh3 = document.getElementById('chipNh3');
        if (chipNh3) {
            if (nh3 > limites.nh3Max) {
                chipNh3.className = 'state-chip crit';
                chipNh3.textContent = '● CRÍTICO';
            } else if (nh3 >= 15) {
                chipNh3.className = 'state-chip warn';
                chipNh3.textContent = '● ATENÇÃO';
            } else {
                chipNh3.className = 'state-chip ok';
                chipNh3.textContent = '● SEGURO';
            }
        }
    }
    function updateAtuadoresUI(atuadores) {
        if (!atuadores) return;
        ['v1', 'v2', 'asp', 'neb'].forEach(tipo => {
            const ligado = Number(atuadores[tipo]) === 1;
            const card = document.querySelector(`.atuador-card.${tipo}`);
            const chip = document.getElementById(`chip-${tipo}`);
            const lbl = document.getElementById(`lbl-${tipo}`);
            const btnOn = document.getElementById(`btn-on-${tipo}`);
            const btnOff = document.getElementById(`btn-off-${tipo}`);

            if (card) card.classList.toggle('is-on', ligado);
            if (chip) chip.className = 'atuador-chip ' + (ligado ? 'chip-on' : 'chip-off');
            if (lbl) lbl.textContent = ligado ? 'LIGADO' : 'DESLIGADO';

            if (btnOn) btnOn.classList.toggle('active', ligado);
            if (btnOff) btnOff.classList.toggle('active', !ligado);
        });
    }

    function updateModoAutoUI(ativo) {
        const btn = document.getElementById('btnModoAuto');
        const txt = document.getElementById('txtModoAuto');
        const badge = document.getElementById('badgeModoAuto');
        if (btn) {
            btn.className = 'auto-master-btn ' + (ativo ? 'is-active' : 'is-inactive');
            btn.textContent = ativo ? 'ATIVADO' : 'DESATIVADO';
        }
        if (txt) {
            txt.textContent = ativo ? 'Automação Ativa (Limites Node-RED)' : 'Controle Manual Habilitado';
        }
        if (badge) {
            badge.textContent = ativo ? 'AUTO ATIVO' : 'MANUAL';
            badge.style.color = ativo ? 'var(--state-ok)' : 'var(--text-muted)';
        }
    }

    function updateSistemaUI(d) {
        const elRssi = document.getElementById('sysRssi');
        const elSnr = document.getElementById('sysSnr');
        const elUltima = document.getElementById('sysUltima');
        const elBroker = document.getElementById('sysBroker');

        if (elRssi) elRssi.textContent = (d.rssi !== undefined && d.rssi !== null) ? `${d.rssi} dBm` : '--';
        if (elSnr) elSnr.textContent = (d.snr !== undefined && d.snr !== null) ? `${d.snr} dB` : '--';

        if (elUltima && d.tempoUltimaLeitura >= 0) {
            const m = Math.floor(d.tempoUltimaLeitura / 60);
            const s = d.tempoUltimaLeitura % 60;
            elUltima.textContent = m > 0 ? `${m}m ${s}s atrás` : `${s}s atrás`;
        } else if (elUltima) {
            elUltima.textContent = 'Agora';
        }

        if (elBroker) {
            elBroker.textContent = USE_MOCK ? 'Simulação Local' : `${BROKER_IP}:${BROKER_PORT}`;
        }
    }

    function processarAlertas(d) {
        const logEl = document.getElementById('alertsLog');
        const countEl = document.getElementById('alertsCount');
        if (!logEl) return;

        const alertasAtuais = [];
        const t = Number(d.temperatura);
        const u = Number(d.umidade);
        const nh3 = Number(d.nh3_ppm);
        const horaStr = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        if (t > limites.tempMax) {
            alertasAtuais.push({ nivel: 'crit', icon: 'fa-temperature-arrow-up', msg: `Temperatura crítica: ${t.toFixed(1)} °C (limite ${limites.tempMax} °C)` });
        } else if (t < limites.tempMin) {
            alertasAtuais.push({ nivel: 'crit', icon: 'fa-temperature-arrow-down', msg: `Temperatura baixa: ${t.toFixed(1)} °C (mínimo ${limites.tempMin} °C)` });
        }

        if (u > limites.umidMax) {
            alertasAtuais.push({ nivel: 'warn', icon: 'fa-droplet', msg: `Umidade elevada: ${u.toFixed(1)} % (limite ${limites.umidMax} %)` });
        } else if (u < limites.umidMin) {
            alertasAtuais.push({ nivel: 'warn', icon: 'fa-droplet-slash', msg: `Umidade baixa: ${u.toFixed(1)} % (aciona aspersor em auto)` });
        }

        if (nh3 > limites.nh3Max) {
            alertasAtuais.push({ nivel: 'crit', icon: 'fa-triangle-exclamation', msg: `Amônia (NH₃) crítica: ${nh3.toFixed(1)} ppm (limite ${limites.nh3Max} ppm)` });
        }

        if (countEl) countEl.textContent = alertasAtuais.length;

        if (alertasAtuais.length === 0) {
            logEl.innerHTML = '<div class="no-alerts"><i class="fa-solid fa-circle-check" style="color:var(--state-ok);margin-right:6px"></i> Sistema saudável — nenhum alerta ativo no galpão.</div>';
            return;
        }

        logEl.innerHTML = alertasAtuais.map(al => `
            <div class="alert-item ${al.nivel}">
                <div><i class="fa-solid ${al.icon}" style="margin-right:8px"></i><strong>${al.msg}</strong></div>
                <div class="alert-item-time">${horaStr}</div>
            </div>
        `).join('');
    }
    async function loadHistorico(periodo) {
        const loading = document.getElementById('chartLoading');
        if (loading) loading.classList.remove('hidden');

        try {
            // Tenta consultar proxy local/backend ou fallback mock
            let d;
            if (USE_MOCK) {
                d = await (await mockFetchHistorico(periodo)).json();
            } else {
                const r = await fetch(`/api/dados?periodo=${periodo}`);
                if (r.ok) {
                    d = await r.json();
                } else {
                    // Fallback para mock caso esteja fora do alcance
                    d = await (await mockFetchHistorico(periodo)).json();
                }
            }

            const agora = Date.now();
            const tempD = [], umidD = [], presD = [], nh3D = [];

            if (d.dados && Array.isArray(d.dados)) {
                d.dados.forEach(p => {
                    if (p.temp !== null && p.temp !== undefined) tempD.push({ x: p.t, y: p.temp });
                    if (p.umid !== null && p.umid !== undefined) umidD.push({ x: p.t, y: p.umid });
                    if (p.pres_hpa !== null && p.pres_hpa !== undefined) presD.push({ x: p.t, y: p.pres_hpa });
                    if (p.nh3 !== null && p.nh3 !== undefined) nh3D.push({ x: p.t, y: p.nh3 });
                });
            }

            if (mainChart) {
                mainChart.data.datasets[0].data = tempD;
                mainChart.data.datasets[1].data = umidD;
                mainChart.data.datasets[2].data = presD;
                mainChart.data.datasets[3].data = nh3D;
                mainChart.options.scales.x.min = agora - getPeriodMs(periodo);
                mainChart.options.scales.x.max = agora;
                mainChart.update('none');
            }
        } catch (e) {
            console.warn('Falha ao carregar histórico:', e);
        } finally {
            if (loading) loading.classList.add('hidden');
        }
    }

    async function controlarAtuador(tipo, acao) {
        try {
            if (USE_MOCK) {
                await mockFetchAtuador(tipo, acao);
            } else {
                await fetch(`http://${BROKER_IP}:${BROKER_PORT}/api/atuador?tipo=${tipo}&acao=${acao}`);
            }
            loadStatus();
        } catch (e) {
            console.error('Erro ao acionar atuador:', e);
        }
    }

    async function toggleModoAutomatico() {
        const novoModo = !modoAutomaticoGlobal;
        try {
            if (USE_MOCK) {
                await mockFetchModoAuto(novoModo);
            } else {
                await fetch(`http://${BROKER_IP}:${BROKER_PORT}/api/modo-auto?ativo=${novoModo ? 1 : 0}`);
            }
            modoAutomaticoGlobal = novoModo;
            updateModoAutoUI(novoModo);
            loadStatus();
        } catch (e) {
            console.error('Erro ao alterar modo automático:', e);
        }
    }

    function limparAlertas() {
        const logEl = document.getElementById('alertsLog');
        const countEl = document.getElementById('alertsCount');
        if (logEl) {
            logEl.innerHTML = '<div class="no-alerts"><i class="fa-solid fa-circle-check" style="color:var(--state-ok);margin-right:6px"></i> Log de alertas limpo pelo operador.</div>';
        }
        if (countEl) countEl.textContent = '0';
    }

    function updateConnectionStatus(ok) {
        const b = document.getElementById('connectionStatus');
        if (!b) return;
        b.className = 'status-badge ' + (USE_MOCK ? 'simulation' : (ok ? 'online' : 'offline'));
        const lbl = b.querySelector('span:last-child');
        if (lbl) {
            lbl.textContent = USE_MOCK ? 'Simulação' : (ok ? `Conectado (${BROKER_IP})` : 'Sem Conexão');
        }
    }

    function getPeriodMs(p) {
        return { '1h': 3600000, '6h': 6 * 3600000, '24h': 24 * 3600000, '7d': 7 * 24 * 3600000 }[p] || 3600000;
    }
