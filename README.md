# Aviário — Sistema IoT de Monitoramento e Controle Ambiental

Sistema IoT completo de monitoramento ambiental e controle para um aviário (galpão avícola), com leitura de temperatura, umidade, pressão e amônia (NH₃), e acionamento automático de 4 atuadores (2 ventiladores, aspersor, nebulizador) via LoRa + MQTT.

## Início Rápido

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
aviario/
├── firmware/
│   ├── README.md               # como compilar/gravar cada nó
│   ├── no-sensor-attiny85/     # bare-metal AVR-GCC — src/main.cpp
│   ├── gateway-esp32/          # PlatformIO + Arduino — src/config.h.example (config.h não versionado)
│   └── no-atuador-esp32/       # PlatformIO + Arduino — src/config.h.example (config.h não versionado)
├── backend/
│   ├── setup_servidor.sh       # instala InfluxDB 2.x + Telegraf + Grafana
│   ├── telegraf/telegraf.conf
│   └── grafana/aviario_dashboard.json
├── flows/
│   └── flows.json              # export do Node-RED — supervisão (ver docs/NODERED.md)
├── assets/
│   └── logos/                  # logo.jpg, baap.jpg
├── docs/
│   ├── ARQUITETURA.md
│   ├── HARDWARE.md
│   ├── PROTOCOLO.md
│   ├── APRENDIZADOS.md
│   ├── PROXIMOS_PASSOS.md
│   ├── NODERED.md              # supervisão: fluxo Node-RED documentado
│   ├── ADR-README.md           # índice das decisões arquiteturais
│   ├── ADR-0001-protocolo-lora-texto.md
│   ├── ADR-0002-attiny85-bare-metal.md
│   └── ADR-0003-atuador-dupla-via-comando.md
├── .gitignore
├── LICENSE
└── README.md
```

## Arquitetura / Decisões

- Visão geral do sistema: [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md)
- Camada de supervisão (Node-RED): [`docs/NODERED.md`](docs/NODERED.md)
- Decisões arquiteturais registradas (ADRs): [`docs/ADR-README.md`](docs/ADR-README.md)

## Stack

- **Firmware**: C bare-metal (AVR-GCC, ATtiny85) e C++/Arduino (ESP32), build via PlatformIO
- **Rádio**: LoRa 915 MHz (SX1276/RFM95W — RadioLib nos ESP32, driver raw no ATtiny85)
- **Mensageria**: MQTT (Mosquitto)
- **Backend**: Telegraf → InfluxDB 2.x → Grafana (instalação via Bash)
- **Supervisão**: Node-RED (`flows/flows.json`) — dashboard, alertas Telegram/Gmail e automação; gravação em InfluxDB 1.x (ver [`docs/NODERED.md`](docs/NODERED.md))

## Visão geral da arquitetura

```
[Nó Sensor: ATtiny85] --LoRa (T:xx.x|U:xx|P:xxx|A:xx.x)--> [Gateway: ESP32] --MQTT--> [Mosquitto]
                                                                   ^  |                     |
                                                          LoRa (JSON) |                     v
                                                                   |  v                [Telegraf]
                                                        [Nó Atuador: ESP32]                 |
                                                        4 relés (2 vent.,                    v
                                                        aspersor, nebulizador)         [InfluxDB 2.x]
                                                                                              |
                                                                                              v
                                                                                        [Grafana]
```

- **Nó sensor (ATtiny85)**: lê temperatura/umidade/pressão (BME280 via I²C bit-bang) e NH₃ (MICS6814 via ADC). Firmware bare-metal (AVR-GCC puro, sem framework Arduino). Transmite via LoRa payload texto: `T:25.5|U:60|P:101325|A:12.3`.
- **Gateway (ESP32)**: escuta LoRa de ambos os nós, identifica a origem pelo primeiro caractere do payload (`T` = sensor, `{` = atuador), publica no MQTT e retransmite comandos MQTT→LoRa para o atuador. Framework Arduino + RadioLib + PubSubClient + ArduinoJson.
- **Nó atuador (ESP32)**: controla 4 relés (ventilador 1, ventilador 2, aspersor, nebulizador). Recebe comandos tanto via MQTT direto quanto via LoRa (fallback sem WiFi), payload JSON `{"v1":1,"v2":0,"asp":1,"neb":0}`. Publica seu estado de volta.
- **Backend**: MQTT (Mosquitto) → Telegraf → InfluxDB 2.x → Grafana, com script de instalação automatizada (`backend/setup_servidor.sh`) para Debian 12 / Ubuntu 22.04.

Detalhes completos em [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) e [`docs/PROTOCOLO.md`](docs/PROTOCOLO.md).

## Configuração de rede LoRa (deve ser idêntica nos 3 nós)

- Frequência: 915 MHz
- BW: 125 kHz
- SF: 7
- CR: 4/5
- Sync word: 0x12 (padrão RadioLib)

## Credenciais e segredos

- Firmware (gateway e atuador): WiFi e broker ficam em `src/config.h`, **não versionado** (bloqueado pelo `.gitignore`) — copie de `src/config.h.example` e edite localmente antes de gravar. Nunca commite credenciais reais.
- `backend/setup_servidor.sh` tem senhas de exemplo para InfluxDB e Grafana (`INFLUX_PASS`, `GRAFANA_ADMIN_PASS`) — troque antes de rodar em produção. Evite commitar o arquivo já editado com senhas reais.

## Ambiente de desenvolvimento

- VS Code + PlatformIO.
- ATtiny85: bare-metal AVR-GCC, sem framework — `src/main.cpp` compilado como C (ver comentário no topo do arquivo).
- ESP32 (gateway e atuador): framework Arduino, bibliotecas RadioLib, PubSubClient, ArduinoJson.

## Status atual

Ver [`docs/PROXIMOS_PASSOS.md`](docs/PROXIMOS_PASSOS.md) para o estado mais recente e itens em aberto.

## Documento técnico formal

Existe um documento técnico `.docx` cobrindo os três nós, pinagem, protocolo, tópicos MQTT, dificuldades/soluções do ATtiny85 e configuração do PlatformIO — deve ser mantido atualizado conforme o sistema evolui.
