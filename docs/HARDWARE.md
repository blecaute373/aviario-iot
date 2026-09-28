# Hardware

## Lista de componentes (confirmados no código atual)

- ATtiny85 (DIP-8) — nó sensor
- RFM95W / SX1276 (rádio LoRa) — no nó sensor e no nó único (o gateway antigo e o nó atuador separado não estão em operação)
- BME280 (temperatura/umidade/pressão, I²C) — nó sensor
- MICS6814 (sensor de gases — NH₃, via ADC) — nó sensor
- ESP32 — **nó único** gateway + atuador (em operação — ver nota abaixo)
- 4 relés (módulo ativo-baixo) — acionados pelo **PCF8574** no nó único; **apenas V1 (ventilador 1) está instalado**, V2/aspersor/nebulizador são reserva de expansão
- LCD 16×2 I²C (0x27) — painel local do nó único
- ESP32 — nó atuador separado (`firmware/no-atuador-esp32/`): **não está em operação** (superado pelo ADR-0004)
- Programador USBasp — gravação do ATtiny85

> ℹ️ **Atualização (ADR-0004):** enquanto `firmware/gateway-esp32/` e `firmware/no-atuador-esp32/` não usam LCD nem expansor I²C, o nó vigente — `firmware/gateway-atuador-esp32/` — **usa os dois**: LCD 16×2 I²C em `0x27` e módulo de relés via **PCF8574 em `0x20`**. Pinagem desse nó abaixo. Ver [`ADR-0004`](ADR-0004-no-unico-gateway-atuador.md).

## Pinagem confirmada — Gateway ESP32 (`firmware/gateway-esp32/src/main.cpp`)

| Sinal | GPIO |
|-------|------|
| LoRa NSS | 5 |
| LoRa MOSI | 23 |
| LoRa MISO | 19 |
| LoRa SCK | 18 |
| LoRa RST | 14 |
| LoRa DIO0 | 26 |

## Pinagem confirmada — Nó atuador ESP32 (`firmware/no-atuador-esp32/src/main.cpp`)

LoRa: mesma pinagem do gateway (NSS 5, RST 14, DIO0 26).

| Atuador | GPIO | Lógica |
|---------|------|--------|
| Ventilador 1 | 25 | ativo-baixo (LOW = liga) |
| Ventilador 2 | 33 | ativo-baixo |
| Aspersor | 32 | ativo-baixo |
| Nebulizador | 27 | ativo-baixo |

## Pinagem confirmada — Nó único Gateway + Atuador ESP32 (`firmware/gateway-atuador-esp32/`)

| Sinal | Pino | Observação |
|-------|------|------------|
| LoRa NSS / RST / DIO0 | 5 / 14 / **35** | DIO0 em 35 (a trilha original para o GPIO 26 faltou na PCB — corrigido com jumper) |
| LoRa SCK / MISO / MOSI | 18 / 19 / 23 | SPI explícito: `SPI.begin(18, 19, 23, LORA_NSS)` |
| I²C SDA / SCL | 21 / 22 | LCD (0x27) e PCF8574 (0x20) no mesmo barramento |
| Relés (V1/V2/ASP/NEB) | P0…P3 do **PCF8574** | ativo-baixo (bit em 0 = relé ligado); 1 transação I²C por atualização |

> **Apenas V1 (ventilador 1) está instalado hoje.** V2, aspersor e nebulizador são reserva de expansão: o firmware mantém estado e protocolo para eles, sem efeito físico enquanto o relé não existir ([ADR-0004](ADR-0004-no-unico-gateway-atuador.md)).

## Pinagem confirmada — ATtiny85 (conforme `firmware/no-sensor-attiny85/src/main.cpp`)

- **PB0**: MOSI (USI DO) / SDA I²C — compartilhado, nunca simultâneo.
- **PB1**: MISO (USI DI) — não usado ativamente.
- **PB2**: SCK (USI CK) / SCL I²C — compartilhado, nunca simultâneo. Conflito conhecido entre ADC1, I²C SCL e SPI SCK — exige sequência obrigatória por ciclo: ADC primeiro → I²C (BME280) → SPI (transmissão/sleep do LoRa).
- **PB3**: CS do SX1276 / ADC3 do MICS6814 (leitura do NH₃).
- **PB4**: RST físico do SX1276 (reset por hardware, toggle no pino — *não* é reset por software via `RegOpMode` como registrado anteriormente).

> Nota: esta versão do código usa reset físico via PB4, diferente de uma versão anterior documentada que eliminava o pino RST em favor de reset por software. Se você já tiver soldado o circuito sem o pino RST conectado, confira se está usando esta versão do firmware.

## Problemas de hardware resolvidos

- Resistor queimado substituído.
- Trilha de RST ausente corrigida com fio jumper.
- Ponte de solda entre os pinos 4–5 do módulo LoRa foi ressoldada.
- Driver do USBasp corrigido via Zadig (uso de libusb-win32, não WinUSB nem libusbK — requisito de compatibilidade com avrdude 6.3).
- `upload_flags` do PlatformIO corrigido para caminho absoluto: `C:\.platformio\packages\tool-avrdude\avrdude.conf` (variáveis como `$PACKAGES_DIR` não são expandidas dentro de `upload_flags`).

## Hipóteses em aberto (última sessão registrada)

- Corrente insuficiente sob carga de TX (RFM95W consome ~100–120 mA de pico em PA_BOOST).
- Possíveis problemas de continuidade no MISO do SPI.
- Efeitos colaterais da reinicialização do USI ao alternar entre modos I²C e SPI.

## Restrições de firmware relacionadas a hardware

- A classe `String` do Arduino é proibida no ATtiny85 por restrição de memória — todo tratamento de string usa arrays de `char`, `snprintf`, `strstr`, `atof`.
- `radio.begin()` deve ser chamado dentro do loop, não no `setup()`, pois a reconfiguração do USI para I²C invalida o estado do driver RadioLib.
