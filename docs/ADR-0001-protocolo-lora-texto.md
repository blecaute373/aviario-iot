# ADR-0001 — Protocolo LoRa: payload texto + SF7/CR 4:5 unificado nos 3 nós

**Status:** Aceito (registro retroativo)

## Contexto

Havia divergência entre as gerações do firmware: um gateway anterior (`gateway-esp32.ino`, já removido do repositório) usava payload **binário de 8 bytes** com **SF9/CR 4:7**, enquanto o nó sensor transmitia **texto pipe-delimited** (`T:25.5|U:60|P:101325|A:12.3`) em **SF7/CR 4:5**. Essa incompatibilidade de parâmetros de rádio era a causa provável da falha de transmissão ponta a ponta.

## Decisão

Padronizar os três nós em:

- Payload do sensor: texto pipe-delimited; payload do atuador: JSON (`{"v1":1,"v2":0,"asp":1,"neb":0}`).
- Rádio: 915 MHz, BW 125 kHz, SF7, CR 4/5, sync word 0x12.
- O gateway identifica a origem do pacote pelo primeiro caractere: `T` = sensor, `{` = atuador.

## Alternativas descartadas

- **Manter o payload binário de 8 bytes**: mais compacto, porém exigia parser binário nos dois lados e era incompatível com o que já estava gravado no sensor; legibilidade nula no monitor serial.
- **Manter SF9/CR 4:7 no gateway**: o nó sensor já operava em SF7 e exigiria regravação física (USBasp) apenas para igualar — SF7 é suficiente para o alcance curto do galpão.

## Consequências

- Payloads de texto são maiores que os binários, mas a cadência é baixa (1 pacote a cada ~5 min no sensor) — impacto irrelevante no ar.
- Qualquer nó ainda gravado com o firmware antigo precisa ser regravado; o `.ino` antigo não está mais no repositório.
- A configuração de rádio fica congelada: qualquer mudança futura precisa ser feita nos 3 nós simultaneamente.
