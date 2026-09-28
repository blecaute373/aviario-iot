# Protocolo de comunicação

> Atualizado a partir do código-fonte real dos 3 nós. Versões anteriores desta documentação (e um gateway `.ino` enviado antes) descreviam um payload **binário** de 8 bytes e SF9/CR7 no gateway — isso ficou **substituído** pela versão atual, que usa payload texto pipe-delimited e SF7/CR5 nos 3 nós, consistente entre si.
>
> ⚠️ **Arquitetura vigente:** o **nó sensor** (LoRa → acima) continua como descrito neste documento, mas gateway e atuador hoje são **um nó único ESP32** — ver [ADR-0004](ADR-0004-no-unico-gateway-atuador.md) e a seção [Nó único Gateway + Atuador](#nó-unico-gateway--atuador-adr-0004--contrato-vigente) no fim deste arquivo. As seções *"LoRa — Gateway ↔ Nó atuador"* e *"Fallback do nó atuador"* descrevem a arquitetura anterior ([ADR-0003](ADR-0003-atuador-dupla-via-comando.md), superado) e ficam apenas para histórico.

## LoRa — Nó sensor → Gateway

Payload texto, pipe-delimited, gerado por `firmware/no-sensor-attiny85/src/main.cpp`:

```
T:25.5|U:60|P:101325|A:12.3
```

| Campo | Significado | Exemplo |
|-------|-------------|---------|
| `T` | Temperatura (°C, 1 casa decimal) | `25.5` |
| `U` | Umidade relativa (%, inteiro) | `60` |
| `P` | Pressão (Pa, inteiro) | `101325` |
| `A` | NH₃ (ppm, 1 casa decimal) | `12.3` |

O gateway identifica esse pacote porque começa com `T` (`PREFIXO_SENSOR`).

## LoRa — Gateway ↔ Nó atuador

Payload JSON nos dois sentidos (MQTT→LoRa e LoRa→MQTT):

```json
{"v1":1,"v2":0,"asp":1,"neb":0}
```

| Campo | Atuador |
|-------|---------|
| `v1` | Ventilador 1 |
| `v2` | Ventilador 2 |
| `asp` | Aspersor |
| `neb` | Nebulizador |

`1` = ligado, `0` = desligado. O gateway identifica esse pacote porque começa com `{` (`PREFIXO_ATUADOR`).

## Configuração de rádio LoRa (idêntica nos 3 nós)

| Parâmetro | Valor |
|-----------|-------|
| Frequência | 915 MHz |
| BW | 125 kHz |
| SF | 7 |
| CR | 4/5 |
| Sync word | 0x12 |

## MQTT — tópicos

| Tópico | Direção | Payload |
|--------|---------|---------|
| `aviario/no1/sensores` | Gateway → broker | JSON: `temperatura`, `umidade`, `pressao_pa`, `nh3_ppm`, `rssi`, `snr` |
| `aviario/no1/atuadores/estado` | Gateway → broker (retained) | JSON: `v1`, `v2`, `asp`, `neb` |
| `aviario/no1/atuadores/cmd` | broker → Gateway | JSON: `v1`, `v2`, `asp`, `neb` (campos opcionais — só os presentes são alterados) |

Broker: Mosquitto, IP definido em `MQTT_BROKER` no firmware do gateway e do atuador (`192.168.0.3` no ambiente de referência).

## Fallback do nó atuador

O nó atuador aceita comandos tanto via **MQTT direto** quanto via **LoRa** (retransmitido pelo gateway) — isso garante acionamento mesmo se o atuador perder WiFi, desde que o link LoRa com o gateway continue funcionando.

## Nota sobre versão anterior (arquivo `gateway-esp32.ino`, já substituído)

Uma versão anterior do gateway (formato `.ino`, upload anterior) usava payload **binário** de 8 bytes e SF9/CR7 — incompatível com o nó sensor (SF7/CR 4:5). Essa versão foi **removida do repositório** e substituída pela versão em PlatformIO documentada acima, que é consistente com os outros dois nós. Se esse `.ino` antigo ainda estiver em uso em algum ESP32 físico, ele precisa ser regravado com o firmware atual de `firmware/gateway-esp32/`.

## Nó único Gateway + Atuador (ADR-0004) — contrato vigente

Firmware: `firmware/gateway-atuador-esp32/`. Gateway e atuador no **mesmo ESP32**, sem hop LoRa de comando; o nó escuta o sensor ATtiny85 por LoRa e aciona os relés via expansor I²C PCF8574.

### Comando (broker → nó)

| Item | Valor |
|---|---|
| Tópico | `aviario/no1/atuadores/comando` (substitui `.../atuadores/cmd`, JSON, do ADR-0003) |
| Formato | texto pipe-delimited: `CMD|MODO:MANUAL|V1:1|V2:0|ASP:0|NEB:0` · `CMD|MODO:AUTO` |
| Campos | `MODO` (`AUTO`/`MANUAL`), `V1`, `V2`, `ASP`, `NEB` (0/1, opcionais — só os presentes são alterados) |

- `1` = ligado, `0` = desligado; campo ausente = não mexe; campo malformado (`V1:abc`) é **ignorado**.
- Em `MODO:MANUAL` os campos são aplicados; em `MODO:AUTO` só o modo muda (a histerese embarcada assume os relés).

### Estado (nó → broker)

Tópico `aviario/no1/atuadores/estado` (retained, a cada mudança + heartbeat de 30 s):

```json
{"modo":"MANUAL","v1":1,"v2":0,"aspersor":0,"nebulizador":0,"asp":0,"neb":0,"sensor_online":1,"v1_protecao":0}
```

`asp`/`neb` são aliases legados de `aspersor`/`nebulizador` (dívida técnica com prazo de remoção no ADR-0004); `v1_protecao: 1` indica que é a **proteção de NH₃** (e não o comando) que mantém V1 ligado.

### Failsafe de V1 (proteção de NH₃) — independe de `MODO`

V1 (ventilador 1) é o **único atuador fisicamente instalado** hoje; V2, aspersor e nebulizador são **reserva de expansão** (sem hardware). Por isso a proteção por amônia é sempre armada:

- `MODO:MANUAL` → V1 = comando **ou** proteção (a proteção liga por cima do comando; nunca desliga um V1 que o operador mandou ligar);
- `MODO:AUTO` → V1 = histerese (liga em ≥ 10 ppm, desliga abaixo de 5 ppm);
- **sem medição confiável** (sensor sem transmitir além do `SENSOR_TIMEOUT_MS` = 480 s, ou NH₃ ausente no pacote) → a proteção arma e V1 fica ligado: na dúvida sobre gás tóxico, ventilar é o estado seguro.

> Detalhes, alternativas descartadas e consequências: [ADR-0004](ADR-0004-no-unico-gateway-atuador.md).
