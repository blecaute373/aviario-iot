# Protocolo de comunicação

> Atualizado a partir do código-fonte real dos 3 nós. Versões anteriores desta documentação (e um gateway `.ino` enviado antes) descreviam um payload **binário** de 8 bytes e SF9/CR7 no gateway — isso ficou **substituído** pela versão atual, que usa payload texto pipe-delimited e SF7/CR5 nos 3 nós, consistente entre si.

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
