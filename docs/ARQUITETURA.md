# Arquitetura

> Atualizado a partir do código-fonte real dos 3 nós (`firmware/`) e da config de backend (`backend/`).

## Objetivo

Monitoramento ambiental (temperatura, umidade, pressão, NH₃) e controle automático de 4 atuadores (2 ventiladores, aspersor, nebulizador) em um aviário.

## Nós do sistema

### 1. Nó sensor — ATtiny85 (`firmware/no-sensor-attiny85/`)

- Lê temperatura/umidade/pressão via BME280 (I²C bit-bang) e NH₃ via MICS6814 (ADC, lookup table sem float).
- Firmware **bare-metal** em AVR-GCC — sem framework Arduino, sem bibliotecas de terceiros (SPI/I²C/driver LoRa implementados na mão).
- Transmite via LoRa payload texto: `T:25.5|U:60|P:101325|A:12.3`.
- Ciclo: leitura NH₃ → leitura BME280 → transmissão LoRa → deep sleep (~5 min via WDT, 37 ciclos de ~8s).
- Uso de memória estimado: ~157 bytes de RAM, ~968 bytes de flash (ATtiny85: 512B RAM / 8KB flash).

### 2. Gateway — ESP32 (`firmware/gateway-esp32/`)

- Framework Arduino + RadioLib (SX1276) + PubSubClient (MQTT) + ArduinoJson.
- Escuta LoRa continuamente; identifica a origem do pacote pelo primeiro caractere: `T` = nó sensor, `{` = nó atuador.
- Sensor → parseia o payload pipe-delimited, converte para JSON e publica em `aviario/no1/sensores` (inclui RSSI/SNR do link LoRa).
- Atuador → repassa o JSON recebido diretamente para `aviario/no1/atuadores/estado` (retained).
- Assina `aviario/no1/atuadores/cmd`: ao receber um comando via MQTT, retransmite via LoRa para o nó atuador (permite acionamento mesmo se o atuador estiver sem WiFi).

### 3. Nó atuador — ESP32 (`firmware/no-atuador-esp32/`)

- Framework Arduino + RadioLib + PubSubClient + ArduinoJson.
- Controla 4 relés ativo-baixo: Ventilador 1 (GPIO 25), Ventilador 2 (GPIO 33), Aspersor (GPIO 32), Nebulizador (GPIO 27).
- Recebe comandos por **dois caminhos**: MQTT direto (`aviario/no1/atuadores/cmd`) e LoRa (fallback sem WiFi) — payload JSON `{"v1":1,"v2":0,"asp":1,"neb":0}` nos dois casos.
- Publica seu estado em `aviario/no1/atuadores/estado` (retained) a cada mudança e a cada 10s (heartbeat).

## Pipeline de dados (backend)

```
MQTT (Mosquitto) → Telegraf / Node-RED → InfluxDB 1.x (InfluxQL) → Grafana
```

- `backend/setup_servidor.sh` automatiza a instalação de InfluxDB 1.8.x, Telegraf e Grafana em Debian 12 / Ubuntu 22.04, incluindo criação da base `aviario`, datasource InfluxQL no Grafana e config do Telegraf.
- `backend/telegraf/telegraf.conf` — dois `inputs.mqtt_consumer`: um para `aviario/no1/sensores`, outro para `aviario/no1/atuadores/estado`; ambos em formato JSON, gravados no InfluxDB 1.x via `outputs.influxdb` (database `aviario`).
- `backend/grafana/aviario_dashboard.json` — dashboard pronto para importar no Grafana (painéis de sensores e atuadores do "Nó 1", 100% queries InfluxQL).

## Dashboard web (AEREM PLS) — `public/`

- Frontend estático (HTML/CSS/JS vanilla + Chart.js) com dois modos: **Simulação** (dados gerados no navegador) e **Real** (consulta HTTP ao ESP32/broker na rede local: `/api/status`, `/api/dados`, `/api/atuador`).
- Login local por navegador (demonstração), configuração de IP/porta do broker via modal (localStorage).
- Publicado como site estático (Vercel); fora da rede local permanece em Simulação. Detalhes e contrato da API: [`DASHBOARD.md`](DASHBOARD.md).

## Configuração LoRa (deve ser idêntica nos 3 nós)

- Frequência: 915 MHz
- BW: 125 kHz
- SF: 7
- CR: 4/5 (definido como `LORA_CR = 5` no código, notação RadioLib para 4/5)
- Sync word: 0x12 (padrão da biblioteca)

## Tópicos MQTT

| Tópico | Publicado por | Consumido por |
|---|---|---|
| `aviario/no1/sensores` | Gateway | Telegraf → InfluxDB → Grafana |
| `aviario/no1/atuadores/estado` | Gateway (repassa do atuador) | Telegraf → InfluxDB → Grafana |
| `aviario/no1/atuadores/cmd` | (externo — app/dashboard/automação) | Gateway → retransmite via LoRa → Atuador |
