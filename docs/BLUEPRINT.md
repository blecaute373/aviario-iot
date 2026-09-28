# 🧭 BLUEPRINT — Aviário IoT (AEREM PLS)

> **Tudo o que foi feito até agora**, consolidado em um único documento: nós de hardware (nó sensor ATtiny85 + nó único gateway-atuador ESP32), backend, supervisão Node-RED, dashboard web, sistema de acesso/auditoria, suíte de testes com validação de failsafe, CI e deploy de produção.
>
> **Última consolidação arquitetural:** Transição para nó único Gateway + Atuador ESP32 ([ADR-0004](ADR-0004-no-unico-gateway-atuador.md)) e failsafe permanente de NH₃ com testes automatizados.
>
> **Escopo:** arquitetura vigente, contratos de comunicação, realidades físicas de acionamento e suíte de qualidade. Pendências e itens em aberto estão na seção 11 e em [`PROXIMOS_PASSOS.md`](PROXIMOS_PASSOS.md).

---

## Índice

1. [Identidade do projeto](#1-identidade-do-projeto)
2. [Linha do tempo — o que foi feito, commit a commit](#2-linha-do-tempo--o-que-foi-feito-commit-a-commit)
3. [Arquitetura entregue e topologia vigente](#3-arquitetura-entregue-e-topologia-vigente)
4. [Firmware — nós físicos e firmware vigentes](#4-firmware--nós-físicos-e-firmware-vigentes)
5. [Backend (InfluxDB 1.x + Telegraf + Grafana)](#5-backend-influxdb-1x--telegraf--grafana)
6. [Supervisão Node-RED](#6-supervisão-node-red)
7. [Dashboard web AEREM PLS](#7-dashboard-web-aerem-pls)
8. [Qualidade e entrega (testes, CI, produção)](#8-qualidade-e-entrega-testes-ci-produção)
9. [Decisões arquiteturais (ADRs)](#9-decisões-arquiteturais-adrs)
10. [Documentação existente](#10-documentação-existente)
11. [Limitações e estado conhecido](#11-limitações-e-estado-conhecido)

---

## 1. Identidade do projeto

**O que é:** sistema IoT completo de monitoramento ambiental e controle para um aviário (galpão avícola): leitura de temperatura, umidade, pressão e amônia (NH₃) por nó sensor LoRa (ATtiny85), supervisão e acionamento centralizados em nó único Gateway + Atuador (ESP32) com LCD 16×2 e relés via PCF8574, supervisão via Node-RED (alertas Telegram/Gmail + automação) e dashboard web **AEREM PLS** com controle de atuadores e auditoria de acessos.

**Por que existe:** controle ambiental afeta diretamente o bem-estar e a vida das aves — o acúmulo de amônia (NH₃) é crítico e tóxico, exigindo acionamento garantido de ventilação mesmo se a conexão WiFi ou o broker caírem (failsafe permanente embarcado no ESP32).

**Natureza:** projeto acadêmico (TCC), licença `UNLICENSED` (todos os direitos reservados, ver [`../LICENSE`](../LICENSE)).

**Stack por camada:**

| Camada | Tecnologia |
|---|---|
| Sensor | ATtiny85 — C bare-metal (AVR-GCC, sem Arduino), BME280 + MICS6814 + SX1276 |
| Gateway + Atuador (Nó Único) | ESP32 — Arduino + RadioLib + PubSubClient + PCF8574 + LiquidCrystal_I2C |
| Rádio | LoRa 915 MHz, BW 125 kHz, SF7, CR 4/5, sync word 0x12 |
| Transporte | MQTT (Mosquitto), MQTT 3.1.1 |
| Séries temporais | InfluxDB 1.x (InfluxQL), database `aviario` |
| Ingestão | Telegraf (`inputs.mqtt_consumer`) |
| Painel de dados | Grafana (dashboard importável em JSON) |
| Orquestração/automação | Node-RED (dashboard, alertas, modo automático) |
| Dashboard web | HTML/CSS/JS vanilla + Chart.js — **sem build step** |
| Acesso/auditoria | Node.js puro (`lib/auth*.js`, scrypt + sessão em cookie httpOnly) |
| Hospedagem | Vercel (estático + função serverless) |
| CI | GitHub Actions (check → test → audit) |

**Comandos essenciais:**

```bash
npm run serve   # servidor local + API de acesso + proxy InfluxDB (http://localhost:3000)
npm run check   # node --check em todos os scripts JS e testes
npm test        # 34 testes (node --test, sem dependências: dashboard, acesso e failsafe V1)
npm run audit   # npm audit --audit-level=high
```

---

## 2. Linha do tempo — o que foi feito, commit a commit

Oito commits entre 24 e 25/09/2026, todos na `main`:

| # | Commit | Data | O que entregou |
|---|---|---|---|
| 1 | `8b5696d` chore: estrutura inicial do repositório | 24/09 | Esqueleto do projeto: `firmware/`, `backend/`, `flows/`, `docs/`, `.github/` |
| 2 | `80f8bec` docs: adiciona export do fluxo Node-RED e documentação da supervisão | 24/09 | `flows/flows.json` (45 entradas) + `docs/NODERED.md` (22 KB) documentando cada grupo/nó |
| 3 | `e5fbdbf` feat: dashboard web AEREM PLS em public/ (modularizado, CI e deploy Vercel) | 24/09 | Dashboard web completo em `public/`, CI GitHub Actions, `vercel.json`, testes iniciais |
| 4 | `ac5ed0f` docs: README padrão GitHub + DASHBOARD.md + estrutura atualizada | 24/09 | README completo (início rápido, estrutura, arquitetura) + `docs/DASHBOARD.md` |
| 5 | `9d076f4` docs: URL de produção (aerem-pls.vercel.app) + .vercelignore | 24/09 | Deploy enxuto e URL de produção registrada |
| 6 | `c0f5967` feat(dashboard): reformula dashboard web com UI industrial e alinha InfluxDB 1.x | 25/09 | Design tokens, UI de consola industrial, histórico via InfluxDB 1.x |
| 7 | `b0ecc27` feat(dashboard): painel de controle (admin.html) + camadas api/ui e documentação das duas páginas | 25/09 | Segunda página (`admin.html`): 4 atuadores + chave mestra do Modo Automático; camadas `js/api.js` e `js/ui.js` |
| 8 | `951dfda` feat(acesso): autenticação de usuários com painel administrativo e auditoria | 25/09 | Tela única de login/cadastro, `lib/auth*.js`, função `api/index.js`, painel "Usuários & Acessos" (`js/acessos.js`), 22 testes |
| 9 | `18eecd4` docs: blueprint consolidando tudo o que foi feito ate o commit 951dfda | 25/09 | Criação do `docs/BLUEPRINT.md` inicial |
| 10 | Fase atual | refactor(firmware): nó único gateway+atuador ESP32 com failsafe permanente de NH3 | 27/09 | Unificação em `firmware/gateway-atuador-esp32/` (ADR-0004), PCF8574 + LCD, failsafe permanente de V1 com teste automatizado (31 testes) |
| 11 | Fase atual | feat(node-red): atualiza contrato de comando e documenta invariante formal no ADR-0004 | 28/09 | Migração de `flows/flows.json` para `aviario/no1/atuadores/comando` (texto pipe-delimited `CMD|...`), V1 exclusivo do firmware, remoção de `gateway_atuador.ino` da raiz, complementação do ADR-0004 e documentação de supervisão alinhada |
| 12 | Fase atual | feat(acesso): tela de entrada split-screen com tema claro/escuro e sem credenciais visíveis | 28/09 | Layout de referência (`lg-painel` + `lg-area-cartao`), abas *Entrar*/*Registrar* com modo explícito, `public/js/theme.js` (tema claro escopado à tela de acesso, anti-FOUC no `<head>`), remoção da dica `admin/admin` da interface e 3 novas asserções de teste (34 no total) |

**Resultado no fim dessa sequência:** sistema de ponta a ponta documentado e compilado com sucesso, operando com nó sensor ATtiny85 e nó único Gateway+Atuador ESP32 sem intermediário LoRa, V1 com proteção por histerese de NH₃ inviolável, além de dashboard web em produção com autenticação e auditoria.

---

## 3. Arquitetura entregue e topologia vigente

A arquitetura vigente adota a topologia de **dois nós físicos em campo** ([ADR-0004](ADR-0004-no-unico-gateway-atuador.md)):

```
[Nó Sensor: ATtiny85] --LoRa (T:xx.x|U:xx|P:xxx|A:xx.x)--> [Nó Único Gateway + Atuador: ESP32]
                                                                  │          │
                                                    Barramento I²C │          │ MQTT
                                                  ┌───────────────┴────┐     ▼
                                                  ▼                    ▼  [Mosquitto]
                                          [LCD 16x2 (0x27)]   [PCF8574 (0x20)]   │
                                          Painel Local        P0: V1 (Instalado) ├─► [Telegraf / Node-RED]
                                                              P1: V2 (Reserva)   │            │
                                                              P2: ASP (Reserva)  │            ▼
                                                              P3: NEB (Reserva)  │      [InfluxDB 1.x]
                                                                                 │            │
                                                                                 ▼            ▼
                                                                             [Dashboard]  [Grafana]

[Dashboard AEREM PLS (Vercel)] --GET /api/status|dados|atuador|modo-auto--> [gateway/backend na rede local]
[Browser] --/api/auth/* + /api/admin/*--> [api/index.js (Vercel) ou scripts/serve.js (local)]
                                              └──> MongoDB (MONGODB_URI) ou data/*.json (local)
```

**Tópicos MQTT** (contrato central do sistema):

| Tópico | Direção | Formato | Papel / Consumidores |
|---|---|---|---|
| `aviario/no1/sensores` | ESP32 → broker | JSON (`nh3`, `nh3_ppm`, `temperatura`, `umidade`, `pressao_pa`, `rssi`, `snr`, `modo`) | Telegraf → InfluxDB → Grafana; Node-RED (alertas/automação) |
| `aviario/no1/atuadores/estado` | ESP32 → broker (retained) | JSON (`modo`, `v1`, `v2`, `aspersor`, `nebulizador`, `asp`, `neb`, `sensor_online`, `v1_protecao`) | Telegraf → InfluxDB; Node-RED (dashboard); Dashboard Web |
| `aviario/no1/atuadores/comando` | broker → ESP32 | Texto pipe-delimited: `CMD\|MODO:MANUAL\|V1:1\|...` ou `CMD\|MODO:AUTO` | Dashboard, Node-RED e Telegram acionam o nó ESP32 |
| `aviario/no1/status` | ESP32 → broker (retained) | Texto: `online` ou `offline` (Last Will) | Monitoramento de conectividade do nó ESP32 |

> ℹ️ `aviario/no1/atuadores/cmd` (JSON) e a retransmissão LoRa gateway → atuador pertencem à arquitetura anterior ([ADR-0003](ADR-0003-atuador-dupla-via-comando.md), superado).

**Duas rotas de dados pro dashboard:** modo **Simulação** (lógica de automação do `flows.json` replicada em `mock.js`, roda offline) e modo **Real** (HTTP ao gateway na rede local).


## 4. Firmware — nós físicos e firmware vigentes

Detalhes completos em [`ARQUITETURA.md`](ARQUITETURA.md), [`PROTOCOLO.md`](PROTOCOLO.md), [`HARDWARE.md`](HARDWARE.md) e [`ADR-0004`](ADR-0004-no-unico-gateway-atuador.md).

### 4.1 Nó sensor — ATtiny85 (`firmware/no-sensor-attiny85/`)

- Lê BME280 (temperatura/umidade/pressão via **I²C bit-bang**) e MICS6814 (NH₃ via **ADC**, lookup table sem float).
- **Bare-metal AVR-GCC** — sem framework Arduino, sem bibliotecas de terceiros: SPI via USI, driver raw do SX1276 e strings com `snprintf`/`strstr`/`atof` (classe `String` proibida por memória).
- Payload texto pipe-delimited: `T:25.5|U:60|P:101325|A:12.3`.
- Ciclo: leitura NH₃ → I²C (BME280) → SPI (TX LoRa) → deep sleep ~320 s (37 ciclos de WDT de ~8 s).
- Orçamento de memória: **~157 B de SRAM e ~968 B de flash** (ATtiny85 tem 512 B / 8 KB).
- Gravação via programador USBasp (Windows: driver libusb-win32 via Zadig).

### 4.2 Nó único Gateway + Atuador — ESP32 (`firmware/gateway-atuador-esp32/`) — **VIGENTE**

- Unifica recepção LoRa, publicação MQTT e acionamento local em um único microcontrolador ESP32 ([ADR-0004](ADR-0004-no-unico-gateway-atuador.md)).
- **Hardware Local:**
  - Barramento I²C (GPIO 21 SDA / 22 SCL): Display LCD 16×2 (0x27) para exibição cíclica local + expansor PCF8574 (0x20) acionando módulo de relés ativo-baixo.
  - Pinagem LoRa SPI: NSS 5, MOSI 23, MISO 19, SCK 18, RST 14, **DIO0 35** (jumper na PCB corrigindo a trilha original do GPIO 26).
- **Realidade física dos atuadores:**
  - **Apenas V1 (Ventilador 1) está fisicamente instalado hoje.**
  - V2, aspersor e nebulizador permanecem como reserva arquitetural de expansão (aceitam parsing e relatam estado no JSON, mas sem efeito físico no galpão).
- **Invariante permanente de NH₃ e Failsafe de V1:**
  - A proteção por amônia opera em **qualquer modo** (inclusive `MODO:MANUAL`).
  - Histerese: liga em `nh3 >= 10.0 ppm` e desliga estritamente abaixo de `nh3 < 5.0 ppm`.
  - Operador manual pode ligar V1 quando quiser, mas **nunca pode desligar V1** se a proteção de NH₃ estiver armada (`v1Desejado = proteger || (modo == MODO_MANUAL && v1Comandado)`).
  - Ausência de sinal: se o nó sensor ficar sem transmitir além do timeout (`SENSOR_TIMEOUT_MS = 480 s`, 1,5× o ciclo do ATtiny85) ou enviar leitura inválida (`isnan(nh3)`), o failsafe liga V1 preventivamente.
  - Sinalização: payload MQTT publica `"v1_protecao": 1` e o LCD indica `V1:ON*`.

### 4.3 Firmwares anteriores (`firmware/gateway-esp32/` e `firmware/no-atuador-esp32/`)

- Mantidos no repositório estritamente para registro histórico da arquitetura separada de 3 nós ([ADR-0003](ADR-0003-atuador-dupla-via-comando.md)), **não estão em operação física**.

### 4.4 Configuração de rádio (idêntica nos nós LoRa — ADR-0001)

915 MHz · BW 125 kHz · SF7 · CR 4/5 · sync word 0x12. Validado e unificado entre o transmissor ATtiny85 e o receptor ESP32.

---

## 5. Backend (InfluxDB 1.x + Telegraf + Grafana)

Arquivos em `backend/`:

| Arquivo | Papel |
|---|---|
| `setup_servidor.sh` | Instalação automatizada em Debian 12 / Ubuntu 22.04: InfluxDB 1.8.x, Telegraf e Grafana; cria a database `aviario`, datasource InfluxQL e config do Telegraf |
| `telegraf/telegraf.conf` | Dois `inputs.mqtt_consumer` (sensores e estado de atuadores), JSON, gravados via `outputs.influxdb` na database `aviario` |
| `grafana/aviario_dashboard.json` | Dashboard pronto pra importar — painéis de sensores e atuadores do "Nó 1", 100% queries InfluxQL |

**Pipeline:** `MQTT (Mosquitto) → Telegraf / Node-RED → InfluxDB 1.x (InfluxQL) → Grafana` — Telegraf e Node-RED gravam no mesmo banco, consumidos harmoniosamente pelo Grafana.

---

## 6. Supervisão Node-RED

`flows/flows.json` — export da aba **"Aviário IoT"**, documentado por completo em [`NODERED.md`](NODERED.md).

- **Composição:** 45 entradas — 1 aba, 6 grupos, **30 nós de fluxo** e 8 nós de configuração/UI.
- **Plugins declarados no export:** `node-red-contrib-influxdb 0.7.0`, `node-red-dashboard 3.6.6`, `node-red-contrib-telegrambot 17.4.13`, `node-red-node-email 5.2.4`.
- **Contrato vigente de comando (ADR-0004):** o fluxo publica em `aviario/no1/atuadores/comando` em formato texto pipe-delimited (`CMD|MODO:MANUAL|V2:x|ASP:x|NEB:x`). V1 nunca é comandado pelo Node-RED (é propriedade exclusiva do firmware sob proteção de NH₃).
- **Consumo de estado:** lê chaves vigentes (`aspersor`/`nebulizador`, `v1_protecao`, `sensor_online`) com fallback para aliases legados (`asp`/`neb`) e registra os diagnósticos do failsafe no InfluxDB e no contexto global.

| Grupo | Conteúdo |
|---|---|
| 0. Configuração Inicial | Bootstrap das variáveis globais (chatId do Telegram etc.) |
| 1. Sensores → InfluxDB + Dashboard + Alertas | 6 saídas: InfluxDB, 4 gauges e a verificação de limites (automação decide V2/ASP/NEB sem tocar em V1) |
| 2. Estado dos Atuadores → InfluxDB + Dashboard | InfluxDB (com campos aditivos de failsafe) + 4 indicadores (🟢/⚪) |
| 3. Controle Manual → MQTT | "Monta Comando CMD" publica em `aviario/no1/atuadores/comando` (QoS 1, payload texto `CMD|...`, ignora V1) |
| 4. Modo Automático | Automação por limites → MQTT comando (`aviario/no1/atuadores/comando`, decide V2/ASP/NEB) |
| 5. Comandos via Telegram | Bot "Max" (polling): recebe comando/consulta, responde sobre estado de V1/failsafe, publica comando para V2/ASP/NEB |

- **Alertas:** Telegram (sender) e Gmail/SMTP (`smtp.gmail.com:465`, TLS).
- **Limites operacionais** (sincronizados entre `flows.json`, `mock.js` e `dashboard.js`): temperatura ideal 15–32 °C; umidade 40–80 %; NH₃ atenção > 15 ppm e crítico > 25 ppm; pressão nominal 980–1030 hPa.

---

## 7. Dashboard web AEREM PLS

`public/` — 19 arquivos, **duas páginas**, sem build step. Contrato completo em [`DASHBOARD.md`](DASHBOARD.md).

### 7.1 As duas páginas

- **`index.html` — Consola de Supervisão (somente leitura):** 4 sensores com anéis/limiares, estado dos 4 atuadores, gráfico histórico multi-série (Chart.js via `/api/dados`), alertas operacionais e qualidade do enlace LoRa (RSSI/SNR), zoom pinch/pan (`zoom.js`).
- **`admin.html` — Painel de Controle (administrativo):** faixa ao vivo com deltas e chips de estado, **controle manual dos 4 atuadores**, **chave mestra do Modo Automático** (bloqueia os botões manuais enquanto ativa, porque o Node-RED reescreveria o estado na próxima leitura), log de comandos da sessão e painel **Usuários & Acessos**.

### 7.2 Camadas

- **CSS (ordem de carga):** `tokens.css` (design tokens — fonte única da verdade visual) → `base.css` (reset, topbar, botões) → `login.css` (tela de acesso + modal de rede) → `dashboard.css` (consola) → `control.css` (painel de controle).
- **JS:** `theme.js` (tema claro/escuro da tela de acesso) → `config.js` (IP/porta, modo, modal) → `auth.js` (acesso) → `zoom.js` → `mock.js` (simulação) → `api.js` (camada de dados) → `ui.js` (helpers) → `dashboard.js`/`admin.js` (+ `acessos.js` no painel).

### 7.3 Modos de operação

| Modo | Fonte dos dados | Onde funciona |
|---|---|---|
| **Simulação** (padrão) | `mock.js` — mesma lógica de automação do `flows.json` | Qualquer lugar, inclusive offline/Vercel |
| **Real** | HTTP ao gateway/backend na rede local (IP/porta no modal ⚙️, `localStorage`) | Apenas na rede local |

Chaves de `localStorage`: `aerem_modo`, `aerem_broker_ip`, `aerem_broker_port`, `aerem_tema` (preferência do tema da tela de acesso) (+ `aerem_usuarios_local`/`aerem_acessos_local` só na demonstração local).

### 7.4 API esperada do dispositivo (modo Real)

| Rota | Resposta |
|---|---|
| `GET /api/status` | sensores + rssi/snr + modoAutomatico + limites + atuadores `{v1,v2,asp,neb}` |
| `GET /api/dados?periodo=1h\|6h\|24h\|7d` | histórico (proxy InfluxDB 1.x do `scripts/serve.js`) |
| `GET /api/atuador?tipo=v1\|v2\|asp\|neb&acao=on\|off` | publica no MQTT do atuador |
| `GET /api/modo-auto?ativo=0\|1` | liga/desliga a automação do Node-RED |

### 7.5 Sistema de acesso e auditoria (commit `951dfda`; layout e tema em 28/09/2026)

- **Tela única** (`#loginScreen`) nas duas páginas, em **split-screen**: painel de marca à esquerda (eyebrow mono *AVIÁRIO 01 · IOT AVÍCOLA*, título *Monitorização em tempo real*, resumo do sistema, SVG decorativo e chips *4 SENSORES* / *~5 min CICLO* / *24/7 ONLINE*) e cartão de acesso à direita (*AEREM PLS* + *MONITOR AVÍCOLA · ACESSO*, abas *Entrar*/*Registrar* com indicador animado e modo explícito por aba, campos com ícone e revelar senha). Abaixo de 900 px o painel vira faixa compacta e só o cartão permanece. Navegação: administrador → painel de controle; usuários cadastrados (nome, e-mail, função, usuário, senha) → consola.
- **Tema claro/escuro escopado à tela de acesso:** `js/theme.js` + script anti-FOUC no `<head>` das duas páginas + bloco `#loginScreen[data-tema="claro"]` em `tokens.css` (com `--lg-*` e semânticas em contraste AA); preferência em `localStorage['aerem_tema']`, fallback no `prefers-color-scheme` do sistema. **A consola e o painel seguem sempre escuros** nesta fase (pendência em [`PROXIMOS_PASSOS.md`](PROXIMOS_PASSOS.md)).
- **Nenhuma credencial na interface:** a dica `admin`/`admin` saiu do HTML das duas páginas (e dos avisos de `auth.js`); a credencial administrativa vem de `ADMIN_USER`/`ADMIN_PASS` no servidor.
- **Validação no servidor** — `lib/auth.js` + `lib/auth-api.js`, compartilhados entre `scripts/serve.js` (local) e `api/index.js` (Vercel):
  - senha com **scrypt + salt**; comparação em **tempo constante**;
  - sessão em cookie **httpOnly** `aerem_sessao` (8 h por padrão, `SESSAO_HORAS`);
  - **freio de 8 tentativas** por IP+usuário → HTTP 429;
  - `/admin.html` exige sessão de administrador no servidor local (usuário comum é redirecionado com aviso).
- **Rotas:** `/api/auth/status|login|cadastro|sessao|logout` e `/api/admin/usuarios|acessos` (exclusivas do administrador).
- **Três modos — nunca quebra:**

| Modo | Detecção | Onde ficam cadastros/acessos |
|---|---|---|
| `servidor` | `/api/auth/status` com `banco: true` (local com `data/*.json` ou Vercel com `MONGODB_URI`) | Servidor (`data/*.json` via `lib/store-json.js` ou MongoDB via `lib/store-mongo.js`) |
| `demo-nuvem` | Vercel sem `MONGODB_URI` | `localStorage` do navegador |
| `estatico` | HTML aberto direto / sem API | `localStorage` do navegador |

- **Eventos auditados:** `entrada`, `saida`, `cadastro`, `falha_usuario`, `falha_senha` — com horário, IP e navegador.
- **Painel "Usuários & Acessos"** (`js/acessos.js`): KPIs (usuários, entradas/falhas do dia, sessões ativas), tabela de usuários e log filtrável por evento, auto-atualização a cada 20 s.

---

## 8. Qualidade e entrega (testes, CI, produção)

### 8.1 Testes — 34, sem dependências (`node --test`)

| Arquivo | Cobre |
|---|---|
| `test/public.test.js` | Estrutura do dashboard (arquivos, referências CSS/JS, chaves de CSS balanceadas, tokens definidos), contrato das páginas (`index.html` somente leitura, `admin.html` com os 4 atuadores), contrato HTTP do gateway, `vercel.json`, tela única de acesso nas duas páginas, conversa com `/api/auth/*` e `/api/admin/*`, layout split-screen + abas com modo explícito, tema claro/escuro (`themeToggle`, `theme.js`, anti-FOUC, bloco claro em `tokens.css`) e ausência de credenciais na interface, `flows.json` válido com 45 entradas (18 asserções) |
| `test/auth.test.js` | Servidor HTTP efêmero: status público, cadastro (válido/inválido/reservado/duplicado), login do admin e do usuário, sessão por cookie, logout, monitorização exclusiva do admin, filtro de eventos e freio de tentativas (429 após 8 falhas) (7 asserções) |
| `test/v1-failsafe.test.js` | Validação pura da lógica de proteção de V1 e histerese de NH₃ do nó ESP32: boot sem leitura (failsafe arma e liga V1), primeira leitura segura (< 5.0 ppm desarma), histerese de subida (liga em ≥ 10.0 ppm), histerese de descida (mantém ligado até < 5.0 ppm), precedência de segurança sobre comando manual do operador, MODO AUTO ignorando residual manual, failsafe por timeout do sensor (480 s) e failsafe por leitura corrompida (`NaN`) (9 asserções) |

### 8.2 CI — GitHub Actions (`.github/workflows/ci.yml`)

Pipeline mínimo em `push`/`pull_request` na `main`, Ubuntu + Node 20 + cache npm:

```
npm ci → npm run check (syntax check, fail-fast) → npm test → npm run audit (high+)
```

+ `dependabot.yml` para atualização automatizada de dependências (cadeia de suprimentos).

### 8.3 Dependências

- `package.json`: **zero dependência runtime** — apenas `mongodb@^7.6.0` em `optionalDependencies` (carregado tardiamente só no modo nuvem com `MONGODB_URI`).
- `package-lock.json` versionado (instalação reprodutível via `npm ci`).

### 8.4 Deploy — Vercel (produção)

- **URLs:** Consola → https://aerem-pls.vercel.app · Painel → https://aerem-pls.vercel.app/admin.html (projeto `aerem-pls`).
- **`vercel.json`:** dois builds (`public/**` estático + `api/index.js` em `@vercel/node`) e rotas `/api/(.*)` → função, `/` → `public/index.html`, resto → `public/$1`.
- **`.vercelignore`:** deploy enxuto (exclui docs, backend, firmware, testes etc.).
- **Variáveis de ambiente opcionais:** `MONGODB_URI`, `MONGODB_DB` (Atlas), `ADMIN_USER`/`ADMIN_PASS`, `SESSAO_HORAS`.
- **Verificação de produção (após o deploy):** `/` 200, `/admin.html` 200, `/js/acessos.js` 200, `/api/auth/status` 200, `/api/admin/acessos` sem sessão responde 503 com `banco: false` (comportamento esperado sem `MONGODB_URI`).

### 8.5 Segurança (resumo entregue)

- Segredos fora do Git: `.env*`, `data/` (JSON do acesso) e `firmware/*/src/config.h` no `.gitignore`; nenhuma credencial real versionada.
- Validação sempre no servidor; mensagem de erro genérica pro usuário (não vaza detalhe interno).
- Sessão: cookie httpOnly + expiração + invalidação no logout; senha nunca guarda texto puro (scrypt + salt).

---

## 9. Decisões arquiteturais (ADRs)

Registro completo em [`ADR-README.md`](ADR-README.md) — formato: título, status, contexto, decisão, alternativas descartadas e consequências:

| ADR | Status | Decisão | Por quê (resumo) |
|---|---|---|---|
| **[ADR-0001](ADR-0001-protocolo-lora-texto.md)** | Aceito | Payload texto pipe-delimited + rádio SF7/CR 4:5 unificado nos nós | Havia divergência (gateway antigo em binário/SF9 vs. sensor em texto/SF7) — causa provável da falha ponta a ponta. Texto é legível no serial e o impacto no ar é irrelevante (1 pacote/5 min) |
| **[ADR-0002](ADR-0002-attiny85-bare-metal.md)** | Aceito | Nó sensor em bare-metal AVR-GCC, sem Arduino | ATtiny85 tem 512 B de SRAM e 8 KB de flash; conflito de pino PB2 (ADC/I²C/SPI) exige controle total do USI. Arduino + `String` não cabiam no orçamento |
| **[ADR-0003](ADR-0003-atuador-dupla-via-comando.md)** | **Superado** | Atuador com dupla via: MQTT direto + fallback LoRa | Substituído pelo ADR-0004 com a eliminação do hop LoRa intermediário de comando |
| **[ADR-0004](ADR-0004-no-unico-gateway-atuador.md)** | **Aceito (Vigente)** | Nó único ESP32 (gateway + atuador) sem hop LoRa de comando, controle via PCF8574 e failsafe permanente de NH₃ em V1 | V1 é o único atuador instalado hoje; simplifica hardware eliminando 1 nó rádio, comando local direto via I²C sem latência e proteção de amônia prioritária em qualquer modo |

---

## 10. Documentação existente

| Documento | Conteúdo |
|---|---|
| [`../README.md`](../README.md) | Início rápido (dashboard 5 min, firmware, backend), estrutura, arquitetura, status |
| [`ARQUITETURA.md`](ARQUITETURA.md) | Os nós do sistema, pipeline de dados, tópicos MQTT, configuração LoRa e nota da topologia de nó único |
| [`PROTOCOLO.md`](PROTOCOLO.md) | Payloads (texto/JSON), tabela de campos, tópicos, contrato vigente do nó único (`CMD\|...`) e failsafe |
| [`HARDWARE.md`](HARDWARE.md) | Lista de componentes, pinagem do sensor ATtiny85 e do nó único ESP32 (PCF8574, LCD e LoRa DIO0 no GPIO 35) |
| [`NODERED.md`](NODERED.md) | Documentação completa do `flows.json` (45 entradas, 6 grupos, convenção fato/interpretação) |
| [`DASHBOARD.md`](DASHBOARD.md) | Contrato das 2 páginas, modos, API esperada, acesso (layout split-screen + tema), deploy, segurança, validação |
| [`../ENGENHARIA.md`](../ENGENHARIA.md) | Framework de referência de boas práticas de engenharia de software (documento geral, não específico do Aviário) |
| [`APRENDIZADOS.md`](APRENDIZADOS.md) | Conflitos de pino, USI, toolchain — para não redescobrir |
| [`PROXIMOS_PASSOS.md`](PROXIMOS_PASSOS.md) | Estado atual e pendências (fonte oficial do que falta) |
| [`ADR-README.md`](ADR-README.md) + 4 ADRs | Decisões arquiteturais registradas (ADR-0001 a ADR-0004) |

---

## 11. Limitações e estado conhecido

Registradas para não virar surpresa — a fonte oficial é [`PROXIMOS_PASSOS.md`](PROXIMOS_PASSOS.md):

**Funciona hoje:**

- Nó único Gateway + Atuador ESP32 implementado e compilado com sucesso no PlatformIO (`firmware/gateway-atuador-esp32/`), com LCD 16×2, relés via PCF8574 e proteção permanente de NH₃ em V1.
- Dashboard publicado em produção com login, cadastro e auditoria (mesmo sem `MONGODB_URI`, cai em demonstração local sem quebrar).
- 34 testes verdes (`node --test`), cobrindo estrutura do dashboard, integração do acesso (layout split-screen, tema claro/escuro e ausência de credenciais na tela) e lógica de failsafe/histerese de V1. CI rodando em todo push, audit sem vulnerabilidades high+.
- Modo Simulação completo em qualquer hospedagem (inclusive offline).

**Pendências conhecidas (ainda não entregues):**

1. **Firmware não validado fisicamente** — gravar os nós físicos (sensor ATtiny85 e nó único ESP32) e confirmar a recepção de telemetria ponta a ponta e o acionamento do relé físico de V1.
2. **Pipeline LoRa → MQTT → InfluxDB → Grafana não confirmado de ponta a ponta** com dados reais no galpão.
3. **Credenciais ainda em placeholder** — `config.h` do firmware e `INFLUX_PASS`/`GRAFANA_ADMIN_PASS` no `setup_servidor.sh` (fora do Git, trocar antes de usar de verdade).
4. **Login real na nuvem** depende de configurar `MONGODB_URI`/`MONGODB_DB` (Atlas) no Vercel — sem isso é modo `demo-nuvem`.
5. **Modo Real** depende da rede local — fora dela o dashboard permanece em Simulação (o modo Real devolve 503 no controle remoto, como no projeto Estufa).
6. **Hipóteses de hardware em aberto:** corrente sob carga de TX (RFM95W ~100–120 mA de pico no ATtiny85), continuidade no MISO, efeitos da reinicialização do USI ao alternar I²C/SPI.

**Melhorias opcionais já mapeadas:** PWA instalável, `vercel git connect` (auto-deploy a cada push), persistência do log de comandos da sessão (hoje em memória).

---

> **Como manter este documento vivo:** atualizá-lo a cada milestone (novo commit relevante que altere arquitetura, testes ou produção), sempre apontando o commit de referência no cabeçalho. Pendências mudam → atualizar primeiro [`PROXIMOS_PASSOS.md`](PROXIMOS_PASSOS.md), e refletir aqui só o resumo.
---