# 🐔 Aviário IoT — Sistema de Monitoramento e Controle Ambiental (AEREM PLS)

Sistema IoT completo de monitoramento ambiental e controle para um aviário (galpão avícola): leitura de temperatura, umidade, pressão e amônia (NH₃) por nós LoRa (ATtiny85/ESP32), supervisão via Node-RED (alertas Telegram/Gmail + automação) e **dashboard web "AEREM PLS"** (modos Simulação/Real, supervisão + painel de controle) com deploy estático no Vercel.

## Início Rápido

### Dashboard web — AEREM PLS (5 minutos)

```bash
# 1. Servir localmente (só precisa do Node.js — sem dependências)
npm run serve
# 2. Abra http://localhost:3000            (consola de supervisão)
#    e http://localhost:3000/admin.html    (painel de controle dos atuadores)
# 3. Primeiro acesso: aba "Entrar" com a conta administrativa (ADMIN_USER/ADMIN_PASS;
#    padrão de desenvolvimento admin/admin) ou aba "Registrar" para criar um usuário comum
#    (o tema claro/escuro da tela de acesso fica no botão no canto do cartão)
# 4. O modo "Simulação" já vem ativo; para dados reais use o ⚙️ e informe IP/porta do ESP32/broker
```

Sem Node.js? Basta abrir `public/index.html` direto no navegador (modo Simulação); o painel de controle fica em `public/admin.html` (controle manual dos 4 atuadores + chave mestra do Modo Automático). Detalhes (modos, API esperada, deploy): [`docs/DASHBOARD.md`](docs/DASHBOARD.md).

### Firmware (VS Code + PlatformIO) — repetir para cada nó

```bash
cd firmware/gateway-esp32                  # ou no-atuador-esp32 / no-sensor-attiny85
cp src/config.h.example src/config.h       # apenas gateway e atuador — edite com WiFi/broker reais
pio run -t upload
```

- **Gateway e atuador**: gravação via porta serial USB (padrão do PlatformIO).
- **Sensor (ATtiny85)**: gravação via programador USBasp — no Windows exige driver libusb-win32; ver [`docs/HARDWARE.md`](docs/HARDWARE.md).
- A configuração de rádio (915 MHz, BW 125 kHz, SF7, CR 4/5) é idêntica nos 3 nós — ver [`docs/PROTOCOLO.md`](docs/PROTOCOLO.md).

### Backend (Debian 12 / Ubuntu 22.04)

```bash
scp -r backend/ usuario@servidor:~/aviario-backend/
ssh usuario@servidor
cd ~/aviario-backend
nano setup_servidor.sh        # troque as senhas de exemplo antes de rodar
sudo bash setup_servidor.sh
```

Depois, importe `backend/grafana/aviario_dashboard.json` no Grafana (Dashboards → Import).

## Estrutura do Projeto

```
aviario-iot/
├── .github/
│   ├── dependabot.yml
│   └── workflows/ci.yml        # check → test → audit
├── public/                     # dashboard web AEREM PLS (deploy Vercel)
│   ├── index.html              # consola de supervisão (somente leitura)
│   ├── admin.html              # painel de controle (atuadores + modo automático)
│   ├── css/                    # tokens, base, login, dashboard, control
│   ├── js/                     # config, auth, zoom, mock, api, ui, dashboard, admin
│   └── assets/                 # logo-aerem.png, logo-baap.png
├── firmware/
│   ├── README.md               # como compilar/gravar cada nó
│   ├── no-sensor-attiny85/     # bare-metal AVR-GCC — src/main.cpp
│   ├── gateway-esp32/          # PlatformIO + Arduino — src/config.h.example (config.h não versionado)
│   └── no-atuador-esp32/       # PlatformIO + Arduino — src/config.h.example (config.h não versionado)
├── backend/
│   ├── setup_servidor.sh       # instala InfluxDB 1.8.x + Telegraf + Grafana
│   ├── telegraf/telegraf.conf
│   └── grafana/aviario_dashboard.json
├── flows/
│   └── flows.json              # export do Node-RED — supervisão (ver docs/NODERED.md)
├── api/
│   └── index.js                # função serverless (Vercel): rotas /api/* do acesso
├── lib/
│   ├── auth.js                 # hash scrypt, tokens de sessão e validações (puro)
│   ├── auth-api.js             # roteador HTTP do acesso (local e nuvem)
│   ├── store-json.js           # armazenamento local do acesso (data/*.json)
│   └── store-mongo.js          # armazenamento na nuvem (MongoDB Atlas)
├── scripts/
│   └── serve.js                # servidor local + API de acesso (npm run serve)
├── test/
│   ├── public.test.js          # testes da estrutura do dashboard (node --test)
│   └── auth.test.js            # teste de integração do acesso (HTTP real)
├── assets/
│   └── logos/                  # logo.jpg, baap.jpg
├── docs/
│   ├── ARQUITETURA.md
│   ├── HARDWARE.md
│   ├── PROTOCOLO.md
│   ├── APRENDIZADOS.md
│   ├── PROXIMOS_PASSOS.md
│   ├── NODERED.md              # supervisão: fluxo Node-RED documentado
│   ├── DASHBOARD.md            # dashboard AEREM PLS: modos, API esperada, deploy
│   ├── ADR-README.md           # índice das decisões arquiteturais
│   ├── ADR-0001-protocolo-lora-texto.md
│   ├── ADR-0002-attiny85-bare-metal.md
│   └── ADR-0003-atuador-dupla-via-comando.md
├── .gitignore
├── LICENSE
├── package.json                # scripts: serve / check / test / audit
├── vercel.json                 # deploy estático de public/
└── README.md
```

## Variáveis de Ambiente

**Firmware** — `firmware/*/src/config.h` (não versionado; copie de `config.h.example`):

```c
#define WIFI_SSID   "SUA_REDE"
#define WIFI_PASS   "SUA_SENHA"
#define MQTT_BROKER "192.168.0.3"   // IP do broker Mosquitto
```

**Dashboard (AEREM PLS)** — configuração pelo próprio navegador (modal ⚙️):

| Chave (localStorage) | Para que serve |
|---|---|
| `aerem_broker_ip` / `aerem_broker_port` | endereço do ESP32/broker na rede local (modo Real; padrão `192.168.0.5:80`) |
| `aerem_modo` | modo de operação (`sim`/`real`) |

**Acesso (login/cadastro/monitoramento de acessos)** — variáveis de ambiente opcionais:

| Variável | Padrão | Uso |
|---|---|---|
| `ADMIN_USER` / `ADMIN_PASS` | `admin` / `admin` | credencial pré-configurada do administrador (entra no painel) |
| `SESSAO_HORAS` | `8` | validade da sessão (cookie `aerem_sessao`, httpOnly) |
| `AEREM_DATA_DIR` | `data/` (fora do Git) | pasta dos JSON do acesso no `npm run serve` |
| `MONGODB_URI` / `MONGODB_DB` | — / `aviario` | MongoDB Atlas para o acesso **na nuvem** (Vercel) |

> Sem `MONGODB_URI` a função da nuvem responde `{ banco: false }` e a tela de acesso opera em **demonstração local** (cadastros no navegador) — o deploy estático nunca quebra.

**Backend** — senhas de exemplo em `backend/setup_servidor.sh` (`INFLUX_PASS`, `GRAFANA_ADMIN_PASS`): troque antes de rodar em produção.

## Segurança

| Camada | Implementação |
|---|---|
| Login do dashboard | **Servidor de acesso** (`lib/auth.js` + `lib/auth-api.js`): senha com **scrypt + salt**, sessão em cookie **httpOnly** (`aerem_sessao`, 8 h), freio de tentativas por IP+usuário e log de acessos auditável — a mesma lógica no servidor local e na nuvem |
| Perfis de acesso | `admin` pré-configurado (`ADMIN_USER`/`ADMIN_PASS`, padrão `admin`/`admin`) entra no **painel de controle** com monitoramento de acessos; usuários cadastrados entram na **consola de supervisão**; `/admin.html` exige sessão de administrador |
| Sem servidor | Abrir o HTML direto (ou Vercel sem `MONGODB_URI`) cai em **demonstração local**: cadastros no `localStorage`, útil para testar a tela — sem prometer segurança de servidor |
| Dados de acesso | Servidor local: `data/*.json` (fora do Git); nuvem: MongoDB Atlas (`MONGODB_URI`) com coleções `usuarios`, `sessoes` e `acessos` |
| Firmware | `config.h` (WiFi/broker) **fora do Git** — apenas `config.h.example` versionado |
| Backend | credenciais placeholder no `setup_servidor.sh`; nada real versionado |
| Repositório | `.gitignore` cobre `.env*`, `config.h`, `*.pem`, `*.key`, `.vercel/`, `.pio/`, `data/` |
| CI | `check` (sintaxe) → `test` (estrutura + integração do acesso) → `audit` de dependências a cada push |
| Histórico | nenhum token/senha real commitado (verificado) |

## Deploy (Vercel)

O dashboard é **estático** (sem build): o `vercel.json` publica `public/` e a função `api/index.js` atende `/api/auth/*` e `/api/admin/*`.

1. **CLI:** `npx vercel login` (uma vez) → `npx vercel --prod` na raiz do repositório.
2. **GitHub:** importe o repositório em [vercel.com/new](https://vercel.com/new) (Framework: *Other*); cada push na `main` gera deploy automático.
3. *(Opcional)* Ative o cadastro/login na nuvem: `MONGODB_URI` (Atlas), `MONGODB_DB`, `ADMIN_USER` e `ADMIN_PASS` em **Settings → Environment Variables**.

> ⚠️ O modo **Real** depende do ESP32/broker na **rede local** — fora dela (ex.: no Vercel) o dashboard permanece em **Simulação** (mesmo comportamento do projeto Estufa, que devolve 503 no controle remoto).

## URLs de Produção

- **Consola de supervisão:** https://aerem-pls.vercel.app (produção — projeto `aerem-pls` na Vercel)
- **Painel de controle:** https://aerem-pls.vercel.app/admin.html

## Arquitetura / Decisões

- Visão geral do sistema: [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md)
- Camada de supervisão (Node-RED): [`docs/NODERED.md`](docs/NODERED.md)
- Decisões arquiteturais registradas (ADRs): [`docs/ADR-README.md`](docs/ADR-README.md)

## Stack

- **Firmware**: C bare-metal (AVR-GCC, ATtiny85) e C++/Arduino (ESP32), build via PlatformIO
- **Rádio**: LoRa 915 MHz (SX1276/RFM95W — RadioLib nos ESP32, driver raw no ATtiny85)
- **Mensageria**: MQTT (Mosquitto)
- **Backend**: Telegraf → InfluxDB 1.x (InfluxQL) → Grafana (instalação via Bash)
- **Supervisão**: Node-RED (`flows/flows.json`) — dashboard, alertas Telegram/Gmail e automação; gravação em InfluxDB 1.x (ver [`docs/NODERED.md`](docs/NODERED.md))
- **Dashboard web**: HTML/CSS/JS vanilla + Chart.js (sem build step) — `public/`, deploy estático no Vercel (ver [`docs/DASHBOARD.md`](docs/DASHBOARD.md))

## Visão geral da arquitetura

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
```

- **Nó sensor (ATtiny85)**: lê temperatura/umidade/pressão (BME280 via I²C bit-bang) e NH₃ (MICS6814 via ADC). Firmware bare-metal (AVR-GCC puro, sem framework Arduino). Transmite via LoRa payload texto: `T:25.5|U:60|P:101325|A:12.3`.
- **Gateway (ESP32)**: escuta LoRa de ambos os nós, identifica a origem pelo primeiro caractere do payload (`T` = sensor, `{` = atuador), publica no MQTT e retransmite comandos MQTT→LoRa para o atuador. Framework Arduino + RadioLib + PubSubClient + ArduinoJson.
- **Nó atuador (ESP32)**: controla 4 relés (ventilador 1, ventilador 2, aspersor, nebulizador). Recebe comandos tanto via MQTT direto quanto via LoRa (fallback sem WiFi), payload JSON `{"v1":1,"v2":0,"asp":1,"neb":0}`. Publica seu estado de volta.
- **Backend**: MQTT (Mosquitto) → Telegraf → InfluxDB 1.x → Grafana, com script de instalação automatizada (`backend/setup_servidor.sh`) para Debian 12 / Ubuntu 22.04.

Detalhes completos em [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) e [`docs/PROTOCOLO.md`](docs/PROTOCOLO.md).

## Configuração de rede LoRa (deve ser idêntica nos 3 nós)

- Frequência: 915 MHz
- BW: 125 kHz
- SF: 7
- CR: 4/5
- Sync word: 0x12 (padrão RadioLib)

## Ambiente de desenvolvimento

- VS Code + PlatformIO.
- ATtiny85: bare-metal AVR-GCC, sem framework — `src/main.cpp` compilado como C (ver comentário no topo do arquivo).
- ESP32 (gateway e atuador): framework Arduino, bibliotecas RadioLib, PubSubClient, ArduinoJson.

## Status atual

- Dashboard web **AEREM PLS** publicado em https://aerem-pls.vercel.app — duas páginas: consola de supervisão (`index.html`) e painel de controle (`admin.html`, 4 atuadores + chave mestra do Modo Automático); modos Simulação/Real, login local e gráfico com limites.
- Ver [`docs/PROXIMOS_PASSOS.md`](docs/PROXIMOS_PASSOS.md) para o estado mais recente e itens em aberto.

## Documento técnico formal

Existe um documento técnico `.docx` cobrindo os três nós, pinagem, protocolo, tópicos MQTT, dificuldades/soluções do ATtiny85 e configuração do PlatformIO — deve ser mantido atualizado conforme o sistema evolui.

## Licença

Projeto acadêmico (TCC). **Todos os direitos reservados** — ver [`LICENSE`](LICENSE).
