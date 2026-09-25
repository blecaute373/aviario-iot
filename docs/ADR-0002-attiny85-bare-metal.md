# ADR-0002 — Nó sensor em bare-metal AVR-GCC (sem framework Arduino)

**Status:** Aceito (registro retroativo)

## Contexto

O ATtiny85 tem 512 bytes de SRAM e 8 KB de flash. O nó ainda lida com um conflito de pinos documentado: PB2 é compartilhado entre ADC1, I²C SCL e SPI SCK, e PB0 entre MOSI e SDA — o barramento USI precisa ser reconfigurado entre modos a cada ciclo (ADC do NH₃ → I²C do BME280 → SPI do SX1276).

## Decisão

Implementar o firmware como C bare-metal (`avr-gcc`, sem framework), com drivers próprios: SPI via USI, I²C bit-bang, driver raw do SX1276 e formatação de strings sem `printf`/`String` (arrays de `char`, `snprintf`, `strstr`, `atof`).

## Alternativas descartadas

- **Framework Arduino (core attiny85)**: overhead de flash/RAM incompatível com o orçamento (estimativa do firmware final: ~157 B de RAM e ~968 B de flash); a classe `String` é proibida por memória; o controle do USI para alternar I²C/SPI ficaria mais difícil de auditar.
- **Bibliotecas de terceiros (ex.: RadioLib no ATtiny)**: `lib_deps` removido intencionalmente no `platformio.ini` para manter o firmware autocontido.

## Consequências

- `radio.begin()` precisa ser chamado **dentro do loop** (a cada ciclo): a reconfiguração do USI para I²C invalida o estado do driver.
- Sequência obrigatória por ciclo: ADC (NH₃) → I²C (BME280) → SPI (LoRa TX) → deep sleep.
- `_delay_ms` limitado a ~262 ms por chamada @ 8 MHz → aquecimento do NH₃ e sleep implementados como laços de chamadas curtas (sleep: 37 ciclos de WDT de ~8 s ≈ 5 min).
- Sem dependências externas; mais código próprio para manter, porém previsível e enxuto.
