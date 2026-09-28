# ADRs — Registro de decisões arquiteturais

Uma decisão por arquivo. Formato: título, status (proposto/aceito/superado), contexto, decisão, consequências.

Os ADRs 0001–0003 foram registrados **de forma retroativa**, a partir do histórico já documentado em [`PROTOCOLO.md`](PROTOCOLO.md), [`ARQUITETURA.md`](ARQUITETURA.md), [`HARDWARE.md`](HARDWARE.md) e [`APRENDIZADOS.md`](APRENDIZADOS.md). O **ADR-0004** foi registrado junto com a implementação do nó único (`firmware/gateway-atuador-esp32/`).

| ADR | Título | Status |
|-----|--------|--------|
| [ADR-0001](ADR-0001-protocolo-lora-texto.md) | Protocolo LoRa: payload texto + SF7/CR 4:5 unificado nos 3 nós | Aceito |
| [ADR-0002](ADR-0002-attiny85-bare-metal.md) | Nó sensor em bare-metal AVR-GCC (sem framework Arduino) | Aceito |
| [ADR-0003](ADR-0003-atuador-dupla-via-comando.md) | Atuador com dupla via de comando: MQTT + fallback LoRa | Superado pelo ADR-0004 |
| [ADR-0004](ADR-0004-no-unico-gateway-atuador.md) | Nó único Gateway + Atuador (ESP32) e failsafe de V1 por NH₃ | Aceito |
