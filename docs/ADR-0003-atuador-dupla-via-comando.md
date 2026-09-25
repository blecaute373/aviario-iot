# ADR-0003 — Atuador com dupla via de comando: MQTT + fallback LoRa

**Status:** Aceito (registro retroativo)

## Contexto

O nó atuador (ESP32) controla os 4 relés do galpão (2 ventiladores, aspersor, nebulizador). Depender exclusivamente de WiFi/MQTT o deixaria inoperante em caso de queda da rede — cenário crítico em avicultura, já que ventilação e aspersão afetam diretamente o bem-estar das aves.

## Decisão

O atuador aceita comandos por **dois caminhos**, com o mesmo payload JSON:

1. **MQTT direto**: assina `aviario/no1/atuadores/cmd` no broker.
2. **LoRa (fallback)**: o gateway assina o mesmo tópico e retransmite o comando via rádio.

Em ambos os caminhos, só os campos presentes no JSON são alterados (`v1`, `v2`, `asp`, `neb`). O estado é publicado em `aviario/no1/atuadores/estado` (retained) a cada mudança e em heartbeat a cada 10 s.

## Alternativas descartadas

- **Somente MQTT**: simples, mas deixa o controle inoperante em queda de WiFi.
- **Somente LoRa (gateway como único caminho)**: depende do link LoRa mesmo com WiFi saudável, acrescenta latência e impede o atuador de assinar o broker diretamente.

## Consequências

- Duas rotas de comando para manter e testar em conjunto (mesma semântica de campos opcionais).
- O tópico `aviario/no1/atuadores/estado` pode ser publicado tanto pelo próprio atuador (MQTT) quanto pelo gateway (repasse do LoRa) — o valor mais recente prevalece no broker.
