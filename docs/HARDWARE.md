# Hardware

## Lista de componentes (confirmados no código atual)

- ATtiny85 (DIP-8) — nó sensor
- RFM95W / SX1276 (rádio LoRa) — nos 3 nós
- BME280 (temperatura/umidade/pressão, I²C) — nó sensor
- MICS6814 (sensor de gases — NH₃, via ADC) — nó sensor
- ESP32 — gateway
- ESP32 — nó atuador
- 4 relés (módulo ativo-baixo) — nó atuador, controlados por GPIO direto (não via PCF8574 — ver nota abaixo)
- Programador USBasp — gravação do ATtiny85

> ⚠️ **LCD I²C (0x27) e módulo de relés PCF8574**, mencionados em documentação anterior, **não aparecem no código-fonte atual** (gateway nem atuador usam essas bibliotecas/endereços). Pode ser hardware planejado mas não implementado no firmware atual, ou informação desatualizada — confirme antes de montar o circuito achando que eles são necessários.

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
