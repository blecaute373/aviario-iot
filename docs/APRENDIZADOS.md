# Aprendizados e restrições técnicas

Registro de decisões e problemas já resolvidos, para não serem redescobertos.

## Firmware e hardware

- **Conflito de pino PB2 (ATtiny85)**: compartilhado entre ADC1, I²C SCL e SPI SCK. Sequência obrigatória por ciclo: leitura ADC → I²C (BME280) → SPI (transmissão/sleep do LoRa).
- **`radio.begin()` no loop, não no `setup()`**: a reconfiguração do USI para I²C invalida o estado do driver RadioLib — precisa ser reinicializado a cada ciclo.
- **Timeout do sensor precisa exceder o ciclo completo de transmissão**: o ciclo de ~320s do ATtiny causava "OFFLINE" constante no LCD do gateway até o timeout ser elevado para 480s — dependência de timing não óbvia entre nós.
- **`LowDataRateOptimize`**: matematicamente obrigatório apenas acima de SF11 em BW125kHz — deve ser 0 em SF7.
- **Classe `String` do Arduino proibida no ATtiny85** por restrição de memória — usar arrays de `char`, `snprintf`, `strstr`, `atof`.

## Toolchain

- **PlatformIO em caminho não padrão**: variáveis como `$PACKAGES_DIR` não são expandidas dentro de `upload_flags` — usar caminhos absolutos quando o PlatformIO estiver instalado fora do padrão (ex.: `C:\.platformio`).
- **USBasp no Windows**: exige especificamente libusb-win32 (não WinUSB nem libusbK) para compatibilidade com avrdude 6.3.

## Forma de trabalho

- Isolamento sistemático de falhas: hardware → firmware → toolchain, muitas vezes com apoio de um professor nas hipóteses de hardware.
- Mudanças mínimas viáveis: melhorias não críticas são adiadas explicitamente para sessões futuras em vez de empacotadas junto com correções urgentes.
- Existe um documento técnico `.docx` formal cobrindo os três nós, pinagem, protocolo, tópicos MQTT, dificuldades/soluções do ATtiny85 e configuração do PlatformIO — deve ser mantido atualizado conforme o sistema evolui.
