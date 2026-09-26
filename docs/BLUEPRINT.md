# 🧭 BLUEPRINT — Aviário IoT (AEREM PLS)

> **Tudo o que foi feito até agora**, consolidado em um único documento: firmware dos 3 nós, backend, supervisão Node-RED, dashboard web, sistema de acesso/auditoria, testes, CI e deploy de produção.
>
> **Commit de referência:** `951dfda` — `feat(acesso): autenticação de usuários com painel administrativo e auditoria` (25/09/2026) · **Branch:** `main` · **Repositório:** `blecaute373/aviario-iot`
>
> **Escopo:** apenas trabalho **commitado e entregue** até a referência acima. Alterações locais ainda não commitadas ficam de fora. Pendências conhecidas estão na seção 11 e em [`PROXIMOS_PASSOS.md`](PROXIMOS_PASSOS.md).

---

## Índice

1. [Identidade do projeto](#1-identidade-do-projeto)
2. [Linha do tempo — o que foi feito, commit a commit](#2-linha-do-tempo--o-que-foi-feito-commit-a-commit)
3. [Arquitetura entregue](#3-arquitetura-entregue)
4. [Firmware — os 3 nós](#4-firmware--os-3-nós)
5. [Backend (InfluxDB 1.x + Telegraf + Grafana)](#5-backend-influxdb-1x--telegraf--grafana)
6. [Supervisão Node-RED](#6-supervisão-node-red)
7. [Dashboard web AEREM PLS](#7-dashboard-web-aerem-pls)
8. [Qualidade e entrega (testes, CI, produção)](#8-qualidade-e-entrega-testes-ci-produção)
9. [Decisões arquiteturais (ADRs)](#9-decisões-arquiteturais-adrs)
10. [Documentação existente](#10-documentação-existente)
11. [Limitações e estado conhecido](#11-limitações-e-estado-conhecido)

---

## 1. Identidade do projeto

**O que é:** sistema IoT completo de monitoramento ambiental e controle para um aviário (galpão avícola): leitura de temperatura, umidade, pressão e amônia (NH₃) por nós LoRa (ATtiny85/ESP32), supervisão via Node-RED (alertas Telegram/Gmail + automação) e dashboard web **AEREM PLS** com controle dos 4 atuadores e auditoria de acessos.

**Por que existe:** controle ambiental afeta diretamente o bem-estar das aves — ventilação, aspersão e nebulização precisam de visibilidade em tempo real e de comando mesmo com a rede local caída (por isso o duplo caminho de comando do atuador, seção 9).

**Natureza:** projeto acadêmico (TCC), licença `UNLICENSED` (todos os direitos reservados, ver [`../LICENSE`](../LICENSE)).

**Stack por camada:**

| Camada | Tecnologia |
|---|---|
| Sensor | ATtiny85 — C bare-metal (AVR-GCC, sem Arduino), BME280 + MICS6814 + SX1276 |
| Gateway / Atuador | ESP32 — Arduino + RadioLib + PubSubClient + ArduinoJson |
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
npm run check   # node --check em todos os scripts
npm test        # 22 testes (node --test, sem dependências)
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

**Resultado no fim dessa sequência:** sistema de ponta a ponta (sensores → LoRa → gateway → MQTT → InfluxDB/Grafana/Node-RED) documentado + dashboard web de duas páginas publicado em produção com autenticação e auditoria.

---

## 3. Arquitetura entregue

```
[Nó Sensor: ATtiny85] --LoRa (T:xx.x|U:xx|P:xxx|A:xx.x)--> [Gateway: ESP32] --MQTT--> [Mosquitto]
                                                                   ^  |                     |
                                                          LoRa (JSON) |                     v
                                                                   |  v          [Telegraf / Node-RED]
                                                        [Nó Atuador: ESP32]                 |
                                                        4 relés (2 vent.,                    v
                                                        aspersor, nebulizador)         [InfluxDB 1.x]
                                                                                               |
                                                                                               v
                                                                                         [Grafana]

[Dashboard AEREM PLS (Vercel)] --GET /api/status|dados|atuador|modo-auto--> [gateway/backend na rede local]
[Browser] --/api/auth/* + /api/admin/*--> [api/index.js (Vercel) ou scripts/serve.js (local)]
                                              └──> MongoDB (MONGODB_URI) ou data/*.json (local)
```

**Tópicos MQTT** (contrato central do sistema):

| Tópico | Publicado por | Consumido por |
|---|---|---|
| `aviario/no1/sensores` | Gateway | Telegraf → InfluxDB → Grafana; Node-RED (alertas/automação) |
| `aviario/no1/atuadores/estado` | Gateway (repasse) e atuador (retained) | Telegraf → InfluxDB; Node-RED (dashboard) |
| `aviario/no1/atuadores/cmd` | Dashboard, modo automático, Telegram | Gateway → retransmissão LoRa → Atuador |

**Duas rotas de dados pro dashboard:** modo **Simulação** (lógica de automação do `flows.json` replicada em `mock.js`, roda offline) e modo **Real** (HTTP ao gateway na rede local).


## 4. Firmware — os 3 nós

Detalhes completos em [`ARQUITETURA.md`](ARQUITETURA.md), [`PROTOCOLO.md`](PROTOCOLO.md) e [`HARDWARE.md`](HARDWARE.md).

### 4.1 Nó sensor — ATtiny85 (`firmware/no-sensor-attiny85/`)

- Lê BME280 (temperatura/umidade/pressão via **I²C bit-bang**) e MICS6814 (NH₃ via **ADC**, lookup table sem float).
- **Bare-metal AVR-GCC** — sem framework Arduino, sem bibliotecas de terceiros: SPI via USI, driver raw do SX1276 e strings com `snprintf`/`strstr`/`atof` (classe `String` proibida por memória).
- Payload texto pipe-delimited: `T:25.5|U:60|P:101325|A:12.3`.
- Ciclo: leitura NH₃ → I²C (BME280) → SPI (TX LoRa) → deep sleep ~5 min (37 ciclos de WDT de ~8 s).
- Orçamento de memória: **~157 B de RAM e ~968 B de flash** (ATtiny85 tem 512 B / 8 KB).
- Gravação via programador USBasp (Windows: driver libusb-win32 via Zadig).

### 4.2 Gateway — ESP32 (`firmware/gateway-esp32/`)

- Arduino + RadioLib (SX1276) + PubSubClient + ArduinoJson.
- Identifica a origem do pacote pelo **primeiro caractere**: `T` = sensor, `{` = atuador.
- Sensor → parse do payload pipe-delimited → JSON público em `aviario/no1/sensores` (inclui RSSI/SNR do enlace).
- Atuador → repassa o JSON para `aviario/no1/atuadores/estado` (retained).
- Assina `aviario/no1/atuadores/cmd`: comando MQTT → retransmissão LoRa (permite acionar o atuador sem WiFi).
- Pinagem LoRa: NSS 5, MOSI 23, MISO 19, SCK 18, RST 14, DIO0 26.

### 4.3 Nó atuador — ESP32 (`firmware/no-atuador-esp32/`)

- 4 relés **ativo-baixo**: Ventilador 1 (GPIO 25), Ventilador 2 (GPIO 33), Aspersor (GPIO 32), Nebulizador (GPIO 27).
- **Dupla via de comando** (ADR-0003): MQTT direto + fallback LoRa, mesmo payload JSON `{"v1":1,"v2":0,"asp":1,"neb":0}` — só os campos presentes são alterados.
- Publica o estado em `aviario/no1/atuadores/estado` (retained) a cada mudança e em heartbeat a cada 10 s.

### 4.4 Configuração de rádio (idêntica nos 3 nós — ADR-0001)

915 MHz · BW 125 kHz · SF7 · CR 4/5 · sync word 0x12. Qualquer mudança futura precisa ser feita nos 3 nós simultaneamente.

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

| Grupo | Conteúdo |
|---|---|
| 0. Configuração Inicial | Bootstrap das variáveis globais (chatId do Telegram etc.) |
| 1. Sensores → InfluxDB + Dashboard + Alertas | 6 saídas: InfluxDB, 4 gauges e a verificação de limites |
| 2. Estado dos Atuadores → InfluxDB + Dashboard | InfluxDB + 4 indicadores (🟢/⚪) |
| 3. Controle Manual → MQTT | Publica em `aviario/no1/atuadores/cmd` (QoS 1) |
| 4. Modo Automático | Automação por limites → MQTT cmd |
| 5. Comandos via Telegram | Bot "Max" (polling): recebe comando/consulta, publica MQTT e responde |

- **Alertas:** Telegram (sender) e Gmail/SMTP (`smtp.gmail.com:465`, TLS).
- **Limites operacionais** (sincronizados entre `flows.json`, `mock.js` e `dashboard.js`): temperatura ideal 15–32 °C; umidade 40–80 %; NH₃ atenção > 15 ppm e crítico > 25 ppm; pressão nominal 980–1030 hPa.

---

## 7. Dashboard web AEREM PLS

`public/` — 18 arquivos, **duas páginas**, sem build step. Contrato completo em [`DASHBOARD.md`](DASHBOARD.md).

### 7.1 As duas páginas

- **`index.html` — Consola de Supervisão (somente leitura):** 4 sensores com anéis/limiares, estado dos 4 atuadores, gráfico histórico multi-série (Chart.js via `/api/dados`), alertas operacionais e qualidade do enlace LoRa (RSSI/SNR), zoom pinch/pan (`zoom.js`).
- **`admin.html` — Painel de Controle (administrativo):** faixa ao vivo com deltas e chips de estado, **controle manual dos 4 atuadores**, **chave mestra do Modo Automático** (bloqueia os botões manuais enquanto ativa, porque o Node-RED reescreveria o estado na próxima leitura), log de comandos da sessão e painel **Usuários & Acessos**.

### 7.2 Camadas

- **CSS (ordem de carga):** `tokens.css` (design tokens — fonte única da verdade visual) → `base.css` (reset, topbar, botões) → `login.css` (tela de acesso + modal de rede) → `dashboard.css` (consola) → `control.css` (painel de controle).
- **JS:** `config.js` (IP/porta, modo, modal) → `auth.js` (acesso) → `zoom.js` → `mock.js` (simulação) → `api.js` (camada de dados) → `ui.js` (helpers) → `dashboard.js`/`admin.js` (+ `acessos.js` no painel).

### 7.3 Modos de operação

| Modo | Fonte dos dados | Onde funciona |
|---|---|---|
| **Simulação** (padrão) | `mock.js` — mesma lógica de automação do `flows.json` | Qualquer lugar, inclusive offline/Vercel |
| **Real** | HTTP ao gateway/backend na rede local (IP/porta no modal ⚙️, `localStorage`) | Apenas na rede local |

Chaves de `localStorage`: `aerem_modo`, `aerem_broker_ip`, `aerem_broker_port` (+ `aerem_usuarios_local`/`aerem_acessos_local` só na demonstração local).

### 7.4 API esperada do dispositivo (modo Real)

| Rota | Resposta |
|---|---|
| `GET /api/status` | sensores + rssi/snr + modoAutomatico + limites + atuadores `{v1,v2,asp,neb}` |
| `GET /api/dados?periodo=1h\|6h\|24h\|7d` | histórico (proxy InfluxDB 1.x do `scripts/serve.js`) |
| `GET /api/atuador?tipo=v1\|v2\|asp\|neb&acao=on\|off` | publica no MQTT do atuador |
| `GET /api/modo-auto?ativo=0\|1` | liga/desliga a automação do Node-RED |

### 7.5 Sistema de acesso e auditoria (commit `951dfda`)

- **Tela única** (`#loginScreen`) nas duas páginas: administrador pré-configurado (**`admin`/`admin`**) → painel de controle; usuários cadastrados (nome, e-mail, função, usuário, senha) → consola.
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

### 8.1 Testes — 22, sem dependências (`node --test`)

| Arquivo | Cobre |
|---|---|
| `test/public.test.js` | Estrutura do dashboard (arquivos, referências CSS/JS, chaves de CSS balanceadas, tokens definidos), contrato das páginas (`index.html` somente leitura, `admin.html` com os 4 atuadores), contrato HTTP do gateway, `vercel.json`, tela única de acesso nas duas páginas, conversa com `/api/auth/*` e `/api/admin/*`, `flows.json` válido com 45 entradas |
| `test/auth.test.js` | Sobe um servidor HTTP efêmero: status público, cadastro (válido/inválido/reservado/duplicado), login do admin e do usuário, sessão por cookie, logout, monitorização exclusiva do admin, filtro de eventos e freio de tentativas (429 após 8 falhas) |

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

| ADR | Decisão | Por quê (resumo) |
|---|---|---|
| **[ADR-0001](ADR-0001-protocolo-lora-texto.md)** | Payload texto pipe-delimited + rádio SF7/CR 4:5 unificado nos 3 nós | Havia divergência (gateway antigo em binário/SF9 vs. sensor em texto/SF7) — causa provável da falha ponta a ponta. Texto é legível no serial e o impacto no ar é irrelevante (1 pacote/5 min) |
| **[ADR-0002](ADR-0002-attiny85-bare-metal.md)** | Nó sensor em bare-metal AVR-GCC, sem Arduino | ATtiny85 tem 512 B de SRAM e 8 KB de flash; conflito de pino PB2 (ADC/I²C/SPI) exige controle total do USI. Arduino + `String` não cabiam no orçamento |
| **[ADR-0003](ADR-0003-atuador-dupla-via-comando.md)** | Atuador com dupla via: MQTT direto + fallback LoRa | Queda de WiFi não pode deixar ventilação/aspersão inoperantes em avicultura. Mesmo JSON nos dois caminhos |

---

## 10. Documentação existente

| Documento | Conteúdo |
|---|---|
| [`../README.md`](../README.md) | Início rápido (dashboard 5 min, firmware, backend), estrutura, arquitetura, status |
| [`ARQUITETURA.md`](ARQUITETURA.md) | Os 3 nós, pipeline de dados, tópicos MQTT, configuração LoRa |
| [`PROTOCOLO.md`](PROTOCOLO.md) | Payloads (texto/JSON), tabela de campos, tópicos, nota da versão antiga |
| [`HARDWARE.md`](HARDWARE.md) | Lista de componentes, pinagem dos 3 nós, problemas resolvidos, hipóteses abertas |
| [`NODERED.md`](NODERED.md) | Documentação completa do `flows.json` (45 entradas, 6 grupos, convenção fato/interpretação) |
| [`DASHBOARD.md`](DASHBOARD.md) | Contrato das 2 páginas, modos, API esperada, acesso, deploy, segurança, validação |
| [`APRENDIZADOS.md`](APRENDIZADOS.md) | Conflitos de pino, USI, toolchain — para não redescobrir |
| [`PROXIMOS_PASSOS.md`](PROXIMOS_PASSOS.md) | Estado atual e pendências (fonte oficial do que falta) |
| [`ADR-README.md`](ADR-README.md) + 3 ADRs | Decisões arquiteturais registradas retroativamente |

---

## 11. Limitações e estado conhecido

Registradas para não virar surpresa — a fonte oficial é [`PROXIMOS_PASSOS.md`](PROXIMOS_PASSOS.md):

**Funciona hoje:**

- Dashboard publicado em produção com login, cadastro e auditoria (mesmo sem `MONGODB_URI`, cai em demonstração local sem quebrar).
- 22 testes verdes, CI rodando em todo push, audit sem vulnerabilidades high+.
- Modo Simulação completo em qualquer hospedagem (inclusive offline).

**Pendências conhecidas (ainda não entregues):**

1. **Firmware não validado fisicamente** — gravar os 3 nós com o firmware atual e confirmar a transmissão ponta a ponta (o fix SF7/CR5 está no código, mas não foi testado no hardware).
2. **Pipeline LoRa → MQTT → InfluxDB → Grafana não confirmado de ponta a ponta** com dados reais.
3. **Credenciais ainda em placeholder** — `config.h` do firmware e `INFLUX_PASS`/`GRAFANA_ADMIN_PASS` no `setup_servidor.sh` (fora do Git, trocar antes de usar de verdade).
4. **Login real na nuvem** depende de configurar `MONGODB_URI`/`MONGODB_DB` (Atlas) no Vercel — sem isso é modo `demo-nuvem`.
5. **Modo Real** depende da rede local — fora dela o dashboard permanece em Simulação (o modo Real devolve 503 no controle remoto, como no projeto Estufa).
6. **Hipóteses de hardware em aberto:** corrente sob carga de TX (RFM95W ~100–120 mA de pico), continuidade no MISO, efeitos da reinicialização do USI ao alternar I²C/SPI.

**Melhorias opcionais já mapeadas:** PWA instalável, `vercel git connect` (auto-deploy a cada push), persistência do log de comandos da sessão (hoje em memória).

---

> **Como manter este documento vivo:** atualizá-lo a cada milestone (novo commit relevante que altere arquitetura, testes ou produção), sempre apontando o commit de referência no cabeçalho. Pendências mudam → atualizar primeiro [`PROXIMOS_PASSOS.md`](PROXIMOS_PASSOS.md), e refletir aqui só o resumo.
---