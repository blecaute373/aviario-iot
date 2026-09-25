# Dashboard web — AVIÁRIO IoT (AEREM PLS)

Frontend estático do aviário, em **duas páginas** com qualidade visual de consola industrial:

- **`index.html` — Consola de Supervisão (somente leitura):** monitoramento ambiental em tempo real (Temperatura, Umidade, Pressão atmosférica e Amônia NH₃) com anéis/limiares, estado dos 4 atuadores, gráfico histórico multi-série via InfluxDB 1.x, alertas operacionais e qualidade do enlace LoRa (RSSI/SNR).
- **`admin.html` — Painel de Controle (administrativo):** monitorização ao vivo em faixa compacta, **controle manual dos 4 atuadores** (Ventilador 1, Ventilador 2, Aspersor e Nebulizador) e **chave mestra do Modo Automático** (automação Node-RED), com feedback e log de comandos da sessão.

## Estrutura

```
public/
├── index.html          # consola de supervisão (somente leitura)
├── admin.html          # painel administrativo (controle dos atuadores)
├── css/
│   ├── tokens.css      # design tokens (cores, raios, sombras, tipografia)
│   ├── base.css        # reset, fundo ambiente, topbar, botões, seções
│   ├── login.css       # tela de acesso + modal de configuração de rede
│   ├── dashboard.css   # cards de sensores/atuadores, gráfico, alertas, sistema
│   └── control.css     # controles do admin (botões, chave mestra, faixa ao vivo)
├── js/
│   ├── config.js       # IP/porta do gateway, modo Simulação/Real, modal
│   ├── auth.js         # login/registro local (localStorage + SHA-256)
│   ├── zoom.js         # pinch/pan em telas de toque (consola)
│   ├── mock.js         # dados simulados (lógica de automação do flows.json)
│   ├── api.js          # camada de dados (status/histórico/atuador/modo-auto)
│   ├── ui.js           # helpers de interface (anéis, deltas, chips, CSV)
│   ├── dashboard.js    # lógica da consola de supervisão
│   └── admin.js        # lógica do painel de controle
└── assets/
    ├── logo-aerem.png
    └── logo-baap.png
```

## Modos de operação

- **Simulação:** dados e dinâmica gerados no navegador (`mock.js`) com a mesma lógica de automação do `flows.json` — funciona offline e em hospedagens estáticas (ex.: Vercel).
- **Real:** consulta HTTP ao gateway/backend **na rede local** (IP/porta configuráveis no modal ⚙️). A escolha persiste em `localStorage` (`aerem_modo`).

| Chave (localStorage) | Padrão | Uso |
|---|---|---|
| `aerem_modo` | `sim` | modo de operação (`sim`/`real`) |
| `aerem_broker_ip` | `192.168.0.5` | IP/host do gateway ou servidor backend |
| `aerem_broker_port` | `80` | porta do servidor HTTP |
| `aerem_auth_user` / `aerem_auth_pass` | — | credenciais do login local (hash SHA-256) |

## API esperada do dispositivo / backend (modo Real)

| Rota | Resposta |
|---|---|
| `GET /api/status` | `{ temperatura, umidade, pressao_hpa, nh3_ppm, rssi, snr, tempoUltimaLeitura, modoAutomatico, nosAtivos, limites, atuadores: { v1, v2, asp, neb } }` |
| `GET /api/dados?periodo=1h\|6h\|24h\|7d` | `{ ok: true, dados: [ { t, temp, umid, pres_hpa, nh3 }, ... ] }` (proxy InfluxDB 1.x do `scripts/serve.js`) |
| `GET /api/atuador?tipo=v1\|v2\|asp\|neb&acao=on\|off` | `{ ok: true }` (publica no tópico MQTT do atuador via Node-RED) |
| `GET /api/modo-auto?ativo=0\|1` | `{ ok: true, modoAutomatico: bool }` (chave mestra da automação) |

Cadência: status a cada 5 s (topbar com barra de contagem); histórico a cada 15 s nas duas páginas.

## Painel administrativo (`admin.html`)

- **Faixa ao vivo:** 4 grandezas com valor, delta vs. leitura anterior, chip de estado (Normal/Atenção/Crítico) e notas de enlace (última leitura, RSSI, SNR, modo).
- **Chave mestra "Modo Automático":** liga/desliga a automação do Node-RED. Com ela **ativa**, os botões manuais ficam **bloqueados** (a automação reescreveria o estado na próxima leitura) e um aviso explica o motivo; os limites operacionais vigentes são exibidos em chips.
- **Controle manual:** botões Ligar/Desligar por atuador, com estado real vindo do `/api/status`, feedback do envio e destaque neon quando o atuador está ligado.
- **Log de comandos:** histórico da sessão (hora, comando, sucesso/falha) — apenas em memória, some ao recarregar.

## Alertas e limites operacionais (sincronizados com `flows.json`)

- **Temperatura:** ideal 15.0 a 32.0 °C. Crítico se > 32 °C ou < 15 °C. No modo automático, aciona Ventilador 1, 2 e Nebulizador.
- **Umidade:** ideal 40 a 80 %. Atenção fora da faixa. No modo automático, aciona Aspersor se < 40 %.
- **Amônia (NH₃):** atenção acima de 15 ppm; crítico se > 25 ppm (aciona Nebulizador no modo automático).
- **Pressão Atmosférica:** nominal de 980 a 1030 hPa.

## Deploy (Vercel)

Estático — o `vercel.json` da raiz publica `public/` (o `admin.html` fica em `/admin.html`):

```bash
npx vercel login   # uma vez
npx vercel --prod  # na raiz do repositório
```

**Produção:** https://aerem-pls.vercel.app (projeto `aerem-pls`).

> ⚠️ Fora da rede local (ex.: no Vercel), o modo **Real** não conecta ao gateway e o histórico fica indisponível — use **Simulação**; o gráfico exibe o estado de erro com opção de tentar de novo.

## Segurança

- O login é **local/demonstrativo** (client-side): protege o painel no dispositivo, mas não substitui autenticação de servidor. O painel administrativo compartilha as mesmas credenciais locais da consola.
- Nenhuma credencial real é versionada; as configurações ficam no `localStorage` do navegador.

## Validação

```bash
npm run check   # node --check em todos os scripts (inclui admin.js/api.js/ui.js)
npm test        # 12 testes: arquivos, refs, CSS balanceado, variáveis, contratos
npm run serve   # servidor local + proxy InfluxDB 1.x em /api/dados
```
