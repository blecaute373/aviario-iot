# Firmware — Aviário

Três nós, cada um em seu próprio projeto PlatformIO:

| Nó | Pasta | Plataforma | Bibliotecas |
|----|-------|------------|-------------|
| Sensor | [`no-sensor-attiny85/`](no-sensor-attiny85/) | ATtiny85 — bare-metal AVR-GCC (sem framework; compilar como C) | nenhuma — drivers raw (USI SPI, I²C bit-bang, SX1276) |
| Gateway | [`gateway-esp32/`](gateway-esp32/) | ESP32 — framework Arduino | RadioLib, PubSubClient, ArduinoJson |
| Atuador | [`no-atuador-esp32/`](no-atuador-esp32/) | ESP32 — framework Arduino | RadioLib, PubSubClient, ArduinoJson |

## Compilar e gravar

```bash
cd gateway-esp32        # ou no-atuador-esp32 / no-sensor-attiny85
cp src/config.h.example src/config.h   # apenas gateway e atuador — edite com WiFi/broker reais
pio run -t upload
```

- **Gateway e atuador**: upload via porta serial USB (padrão do PlatformIO).
- **Sensor (ATtiny85)**: upload via programador USBasp — no Windows exige driver **libusb-win32** (compatibilidade com avrdude 6.3); `upload_flags` com caminho absoluto se o PlatformIO estiver fora do padrão (ver [`../docs/HARDWARE.md`](../docs/HARDWARE.md)).
- Se `pio` não estiver no PATH, use a extensão PlatformIO do VS Code.

## Configuração de rádio (idêntica nos 3 nós)

915 MHz · BW 125 kHz · SF7 · CR 4/5 · sync word 0x12 — detalhes em [`../docs/PROTOCOLO.md`](../docs/PROTOCOLO.md).

## Credenciais

`src/config.h` (WiFi + broker) **não é versionado**. Copie de `src/config.h.example` e edite localmente — nunca commite credenciais reais.

## Mais documentação

- Pinagem de cada nó: [`../docs/HARDWARE.md`](../docs/HARDWARE.md)
- Arquitetura e fluxo dos dados: [`../docs/ARQUITETURA.md`](../docs/ARQUITETURA.md)
