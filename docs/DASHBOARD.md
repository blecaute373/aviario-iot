# Dashboard web — AVIÁRIO IoT (AEREM PLS)

Frontend estático de supervisão do aviário: monitoramento ambiental em tempo real (Temperatura, Umidade, Pressão atmosférica e Amônia NH₃), controle de 4 atuadores físicos (Ventilador 1, Ventilador 2, Aspersor e Nebulizador), chave mestra de Modo Automático (Node-RED), gráfico histórico temporal multi-série via InfluxDB 1.x e painel de qualidade do enlace LoRa (RSSI e SNR).

## Estrutura

```
public/
├── index.html          # tela de acesso + dashboard industrial
├── css/
│   ├── tokens.css      # variáveis de design (cores, temas, gradientes)
│   ├── base.css        # header, botões, zoom, modal
│   ├── login.css       # tela de acesso + modal de configuração
│   └── dashboard.css   # layout de sensores, anéis SVG, atuadores, gráfico, alertas
├── js/
│   ├── config.js       # IP/porta do broker/gateway + modal de configuração
│   ├── auth.js         # login/registro local (localStorage + SHA-256)
│   ├── zoom.js         # pinch/pan em telas de toque
│   ├── mock.js         # dados simulados (modo Simulação com lógica do flows.json)
│   └── dashboard.js    # carga de dados, gráfico Chart.js, comandos, deltas, alertas
└── assets/
    ├── logo-aerem.png
    └── logo-baap.png
```

## Modos de operação

- **Simulação** (padrão): dados e dinâmica gerados no próprio navegador com lógica de automação e deltas equivalentes ao firmware e Node-RED — funciona offline e em hospedagens estáticas (ex.: Vercel).
- **Real**: consulta HTTP ao gateway/backend **na rede local** (configurar no modal ⚙️).

## Configuração (navegador)

| Chave (localStorage) | Padrão | Uso |
|---|---|---|
| `aerem_broker_ip` | `192.168.0.5` | IP/host do gateway ou servidor backend |
| `aerem_broker_port` | `80` | porta do servidor HTTP |
| `aerem_auth_user` / `aerem_auth_pass` | — | credenciais do login local (hash SHA-256) |

## API esperada do dispositivo / backend (modo Real)

| Rota | Resposta |
|---|---|
| `GET /api/status` | `{ temperatura, umidade, pressao_hpa, nh3_ppm, rssi, snr, tempoUltimaLeitura, modoAutomatico, atuadores: { v1, v2, asp, neb } }` |
| `GET /api/dados?periodo=1h\|6h\|24h\|7d` | `{ ok: true, dados: [ { t, temp, umid, pres_hpa, nh3 }, ... ] }` (consultado via proxy InfluxDB 1.x) |
| `GET /api/atuador?tipo=v1\|v2\|asp\|neb&acao=on\|off` | `{ ok: true }` |
| `GET /api/modo-auto?ativo=0\|1` | `{ ok: true, modoAutomatico: bool }` |

Cadência: status a cada 5 s; histórico a cada 15 s (constantes em `js/dashboard.js`).

## Alertas e limites operacionais (sincronizados com `flows.json`)

- **Temperatura**: ideal 15.0 a 32.0 °C. Alerta crítico se > 32 °C ou < 15 °C. No modo automático, aciona Ventilador 1, 2 e Nebulizador.
- **Umidade**: ideal 40 a 80 %. Alerta crítico se > 80 %. No modo automático, aciona Aspersor se < 40 %.
- **Amônia (NH₃)**: faixa segura < 15 ppm. Atenção 15 a 25 ppm. Alerta crítico se > 25 ppm (aciona Nebulizador no modo automático).
- **Pressão Atmosférica**: nominal de 980 a 1030 hPa.

## Deploy (Vercel)

Estático — o `vercel.json` da raiz publica `public/`:

```bash
npx vercel login   # uma vez
npx vercel --prod  # na raiz do repositório
```

Ou importe o repositório em [vercel.com/new](https://vercel.com/new) (Framework: *Other*).

**Produção:** https://aerem-pls.vercel.app (projeto `aerem-pls`, deploy atual do `public/`).

> ⚠️ Fora da rede local (ex.: no Vercel), o modo **Real** não conecta — use **Simulação**.

## Segurança

- O login é **local/demonstrativo** (client-side): protege o painel no dispositivo, mas não substitui autenticação de servidor.
- Nenhuma credencial real é versionada; as configurações ficam no `localStorage` do navegador.
