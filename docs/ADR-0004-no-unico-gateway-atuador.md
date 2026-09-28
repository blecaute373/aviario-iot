# ADR-0004 — Nó único Gateway + Atuador (ESP32) e failsafe de V1 por NH₃

**Status:** Aceito (Vigente) · **Substitui:** [ADR-0003](ADR-0003-atuador-dupla-via-comando.md) no caminho do atuador (o nó atuador separado e o fallback LoRa de comando não são mais usados)

## Contexto

A arquitetura de 3 nós (ADR-0001/ADR-0003) previa gateway ESP32 **e** nó atuador ESP32 separado, com dupla via de comando (MQTT + fallback LoRa). Na prática:

- o hop LoRa de comando nunca chegou a operar (o nó atuador separado não entrou em serviço);
- o galpão tem **um único atuador fisicamente instalado hoje: V1 (ventilador 1)** — V2, aspersor e nebulizador **não existem no hardware**;
- V1 é, portanto, a **única linha de defesa contra acúmulo de amônia** (gás tóxico) no galpão.

Firmware de referência: `firmware/gateway-atuador-esp32/`.

## Decisão

1. **Nó único (gateway + atuador no mesmo ESP32)**, sem hop LoRa intermediário: o nó recebe o sensor ATtiny85 por LoRa, publica no broker MQTT e aciona os relés localmente via expansor I²C PCF8574 (0x20), com LCD 16×2 I²C (0x27) para operação local.
2. **Contrato de comando**: tópico `aviario/no1/atuadores/comando` com payload texto pipe-delimited — `CMD|MODO:MANUAL|V1:1|V2:0|ASP:0|NEB:0` ou `CMD|MODO:AUTO`. Substitui o `aviario/no1/atuadores/cmd` (JSON) do ADR-0003. O estado vai para `aviario/no1/atuadores/estado` (JSON, retained) e passa a carregar `modo`, `sensor_online` e `v1_protecao`.
3. **Realidade física e reservas**: **V1 é hoje o único atuador físico instalado no galpão**. V2, aspersor e nebulizador estão reservados no protocolo e na arquitetura para expansão futura. O protocolo aceita, memoriza e publica os 4 campos — porém V2/ASP/NEB não possuem acionamento físico real nesta fase.
4. **A invariante formal de ventilação de V1**:
   A ventilação efetiva é regida pela invariante booleana:
   ```text
   v1Desejado = protecaoNH3Ativa || (modo == MODO_MANUAL && v1Comandado)
   ```
   Isso garante matematicamente que:
   - A proteção nunca é desligada por comando, só reforçada;
   - O operador manual pode ligar V1 quando quiser, mas **nunca pode desligar V1** enquanto a proteção de NH₃ estiver ativa;
   - O campo `MODO` (`AUTO`/`MANUAL`) **NUNCA afeta V1** — a proteção opera com a mesma autoridade em qualquer modo. O modo serve exclusivamente para arbitrar quem decide V2/ASP/NEB (quando estes existirem fisicamente).
5. **Limiares exatos e histerese**:
   - Liga com `nh3 >= 10.0 ppm`;
   - Desliga estritamente abaixo de `nh3 < 5.0 ppm`;
   - A faixa intermediária (5.0 a 9.9 ppm) preserva o estado anterior com memória, evitando oscilação e repique mecânico do relé e do contator do motor.
6. **Duplo failsafe de emergência**:
   - **Por perda de sinal (sensor offline)**: medido por tempo contínuo via `millis() - sensor.recebidoEm > SENSOR_TIMEOUT_MS`. O timeout é fixado em **480 s** (~1,5× o ciclo nominal de ~320 s do nó sensor ATtiny85), tolerando jitter do watchdog timer sem falsos alarmes;
   - **Por leitura inválida (`isnan(nh3)`)**: mesmo com pacote recebido e sensor online, se o campo de amônia estiver corrompido, a proteção arma preventivamente;
   - Em qualquer incerteza sobre a concentração de gás tóxico, o sistema falha seguro (**liga V1**).
7. **Execução ininterrupta no `loop()`**:
   A função `executarProtecaoNH3()` é invocada a cada ciclo do loop do ESP32 (`delay(2)`), garantindo que a expiração temporal do sensor arme o relé na fração de milissegundo correspondente, independentemente de pacotes LoRa ou comandos MQTT externos.
8. **Decisão D1 — Aliases de payload mantidos como dívida técnica aditiva**:
   O firmware publica tanto as chaves novas (`nh3`, `aspersor`, `nebulizador`, `v1_protecao`, `sensor_online`) quanto os aliases legados (`nh3_ppm`, `asp`, `neb`) juntas no mesmo payload JSON. Trata-se de uma dívida técnica consciente e aditiva, sem prazo de remoção imediato, para manter retrocompatibilidade até que todos os consumidores históricos (Node-RED, Telegraf, InfluxDB, Grafana) sejam uniformizados.
9. **Suíte formal de validação**:
   A invariante e todas as transições de borda são formalmente verificadas fora do hardware pelo teste automatizado `test/v1-failsafe.test.js`, que contém aviso explícito de conformidade e rastreabilidade apontando para as linhas canônicas do firmware (`firmware/gateway-atuador-esp32/src/main.cpp`).

## Alternativas descartadas

- **Manter o nó atuador separado com fallback LoRa (ADR-0003)**: mais superfície (duas placas, dois firmwares, link LoRa de comando) para um galpão com um ventilador instalado; e o Wi-Fi do galpão é o mesmo caminho que alimenta o gateway, então o fallback não cobria o cenário principal (rede caída).
- **Proteção de NH₃ só em `MODO:AUTO`** (comportamento anterior): deixava a brecha de um comando desligar V1 com amônia alta em `MODO:MANUAL` — exatamente o caso de risco às aves que o failsafe existe para cobrir.
- **Assumir "sensor offline ⇒ mantém o estado atual"**: se o sensor morresse com o galpão em risco, V1 nunca ligaria. Optou-se por falhar para o lado seguro (ventilar).
- **Ventilação contínua permanente**: descartada por custo térmico/energético e por conflitar com o comando do operador quando não há risco.

## Consequências

- Um único firmware para gravar e manter; `firmware/gateway-esp32/` e `firmware/no-atuador-esp32/` deixam de representar a arquitetura em operação.
- Perde-se o fallback LoRa de comando: com o Wi-Fi caído não há comando remoto — mas a proteção de NH₃ continua atuando localmente (é o motivo de ela ser embarcada).
- `SENSOR_TIMEOUT_MS` (= 1,5× o ciclo de ~320 s do ATtiny85 ⇒ 480 s) define com precisão temporal quando a proteção arma por ausência de telemetria.
- No boot, antes do primeiro pacote válido, V1 inicia preventivamente ligado (sem medição = ventila) e desliga assim que a primeira leitura com NH₃ < 5.0 ppm é processada.
- Comandos para V2/ASP/NEB continuam aceitos e memorizados pelo protocolo, porém sem atuação física real até instalação de hardware complementar.
- Sinalização no painel local LCD 16×2 (`V1:ON*`) e no payload MQTT (`"v1_protecao": 1`) permite distinguir quando V1 está ligado por failsafe ou por solicitação do operador.
- A conformidade do firmware é continuamente assegurada pela suíte de testes integrada ao pipeline de CI (`npm test`).
- Pendência de documentação: [`PROTOCOLO.md`](PROTOCOLO.md), [`ARQUITETURA.md`](ARQUITETURA.md) e [`HARDWARE.md`](HARDWARE.md) já apontam para este ADR como arquitetura vigente.
