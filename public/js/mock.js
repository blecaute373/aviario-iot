    const mockState = {
        temperatura: 24.5,
        umidade: 58.0,
        pressao_pa: 101325,
        pressao_hpa: 1013,
        nh3_ppm: 8.5,
        rssi: -68,
        snr: 9.2,
        tempoUltimaLeitura: 8,
        nosAtivos: [1, 2],
        modoAutomatico: false,
        limites: {
            tempMin: 15.0,
            tempMax: 32.0,
            umidMin: 40.0,
            umidMax: 80.0,
            nh3Max: 25.0
        },
        atuadores: {
            v1: 0,
            v2: 0,
            asp: 0,
            neb: 0
        },
        baseTime: Date.now(),
        updateCount: 0
    };

    function variar(v, min, max, d) {
        const delta = (Math.random() - 0.5) * d;
        return Math.round(Math.max(min, Math.min(max, v + delta)) * 10) / 10;
    }

    function atualizarMockState() {
        mockState.updateCount++;
        mockState.tempoUltimaLeitura = Math.floor(Math.random() * 25);
        mockState.rssi = Math.floor(-60 - Math.random() * 25);
        mockState.snr = Math.round((7 + Math.random() * 5) * 10) / 10;

        const hora = new Date().getHours();
        const fd = 1 + Math.sin((hora - 6) * Math.PI / 12) * 0.15;

        mockState.temperatura = variar(mockState.temperatura * (0.95 + 0.1 * Math.random()), 18, 35, 0.4);
        mockState.umidade = variar(mockState.umidade, 35, 85, 1.0);
        mockState.pressao_hpa = Math.round(variar(mockState.pressao_hpa, 990, 1030, 0.8));
        mockState.pressao_pa = mockState.pressao_hpa * 100;
        mockState.nh3_ppm = variar(mockState.nh3_ppm * fd, 4, 30, 0.6);

        // Lógica do Modo Automático (idêntica ao Node-RED flows.json)
        if (mockState.modoAutomatico) {
            mockState.atuadores.v1 = (mockState.temperatura > mockState.limites.tempMax) ? 1 : 0;
            mockState.atuadores.v2 = (mockState.temperatura > mockState.limites.tempMax) ? 1 : 0;
            mockState.atuadores.neb = (mockState.nh3_ppm > mockState.limites.nh3Max || mockState.temperatura > mockState.limites.tempMax) ? 1 : 0;
            mockState.atuadores.asp = (mockState.umidade < mockState.limites.umidMin) ? 1 : 0;
        }
    }

    function mockFetchStatus() {
        return new Promise(r => {
            setTimeout(() => {
                atualizarMockState();
                r({
                    ok: true,
                    json: () => Promise.resolve({
                        temperatura: mockState.temperatura,
                        umidade: mockState.umidade,
                        pressao_pa: mockState.pressao_pa,
                        pressao_hpa: mockState.pressao_hpa,
                        nh3_ppm: mockState.nh3_ppm,
                        rssi: mockState.rssi,
                        snr: mockState.snr,
                        tempoUltimaLeitura: mockState.tempoUltimaLeitura,
                        nosAtivos: mockState.nosAtivos,
                        modoAutomatico: mockState.modoAutomatico,
                        limites: mockState.limites,
                        atuadores: { ...mockState.atuadores }
                    })
                });
            }, 100 + Math.random() * 150);
        });
    }

    function mockFetchHistorico(periodo) {
        return new Promise(r => {
            setTimeout(() => {
                const agora = Date.now();
                let n, iv;
                switch (periodo) {
                    case '1h': n = 60; iv = 60000; break;
                    case '6h': n = 72; iv = 300000; break;
                    case '24h': n = 96; iv = 900000; break;
                    default: n = 168; iv = 3600000;
                }
                let tb = 24.0, ub = 60.0, pb = 1012, nb = 9.0;
                const pts = [];
                for (let i = 0; i < n; i++) {
                    const t = agora - (n - i) * iv;
                    const h = new Date(t).getHours();
                    const fd = 1 + Math.sin((h - 6) * Math.PI / 12) * 0.2;
                    tb = variar(tb * fd, 18, 34, 0.5);
                    ub = variar(ub, 40, 80, 1.2);
                    pb = Math.round(variar(pb, 1000, 1025, 0.5));
                    nb = variar(nb * fd, 5, 28, 0.8);
                    pts.push({ t, temp: tb, umid: ub, pres_hpa: pb, nh3: nb });
                }
                pts.push({
                    t: agora,
                    temp: mockState.temperatura,
                    umid: mockState.umidade,
                    pres_hpa: mockState.pressao_hpa,
                    nh3: mockState.nh3_ppm
                });
                r({ ok: true, json: () => Promise.resolve({ dados: pts }) });
            }, 120 + Math.random() * 200);
        });
    }

    function mockFetchAtuador(tipo, acao) {
        return new Promise(r => {
            setTimeout(() => {
                if (['v1', 'v2', 'asp', 'neb'].includes(tipo)) {
                    mockState.atuadores[tipo] = (acao === 'on') ? 1 : 0;
                }
                r({ ok: true });
            }, 80);
        });
    }

    function mockFetchModoAuto(ativo) {
        return new Promise(r => {
            setTimeout(() => {
                mockState.modoAutomatico = !!ativo;
                if (mockState.modoAutomatico) {
                    atualizarMockState();
                }
                r({ ok: true, modoAutomatico: mockState.modoAutomatico });
            }, 80);
        });
    }

