# Supervisão (Node-RED) — Fluxo "Aviário IoT"

> Documentação do fluxo exportado em [`../flows/flows.json`](../flows/flows.json): uma única aba do Node-RED chamada **"Aviário IoT"**, cuja descrição no próprio arquivo é: *"Fluxo de monitoramento e controle do aviário: MQTT -> InfluxDB 1.x, Dashboard, alertas via Telegram e Gmail, comandos via Telegram e Dashboard."*

**Convenção de leitura:**

- Sem marcação → **fato lido do arquivo** (`flows.json`);
- 🔎 → **interpretação** (leitura razoável, não explícita no arquivo);
- ⚠️ → **contexto externo** (informação de outras partes do projeto — confirmar antes de apresentar).

**Composição do export:** 45 entradas — 1 aba, 6 grupos, **30 nós de fluxo** e 8 nós de configuração/UI (broker MQTT, InfluxDB, bot do Telegram, 3 grupos + aba do dashboard e `global-config`). Plugins declarados no próprio export: `node-red-contrib-influxdb 0.7.0`, `node-red-dashboard 3.6.6`, `node-red-contrib-telegrambot 17.4.13`, `node-red-node-email 5.2.4`.

| Grupo | Nome no arquivo |
|---|---|
| 0 | Configuração Inicial |
| 1 | Sensores → InfluxDB + Dashboard + Alertas |
| 2 | Estado dos Atuadores → InfluxDB + Dashboard |
| 3 | Controle Manual → MQTT |
| 4 | Modo Automático |
| 5 | Comandos via Telegram |

## 1. Arquitetura geral

O fluxo começa no **`mqtt in`**: tudo a montante (nós de sensor, gateway ESP32, rádio LoRa) não aparece neste arquivo — do ponto de vista dele, o sistema recebe JSON pronto em dois tópicos e publica comandos em um terceiro.

```
                                      (dentro deste arquivo)
┌─────────────────┐   MQTT    ┌──────────────────────┐      ┌──────────────────────────┐
│ Broker Mosquitto│ ────────► │ mqtt in              │ ───► │ "Processa Sensores" (JS) │
│ localhost:1883  │  tópico   │ aviario/no1/sensores │      └───────────┬──────────────┘
└────────┬────────┘           └──────────────────────┘                  │ 6 saídas
         │                                                              ├─► InfluxDB 1.x ("sensores")
         │                                                              ├─► Gauge Temperatura
         │                                                              ├─► Gauge Umidade
         │                                                              ├─► Gauge Pressão (Pa→hPa)
         │                                                              ├─► Gauge NH3
         │                                                              └─► "Verifica Limites / Automação / Alertas"
         │                                                                        │
         │                    ┌───────────────────────────────────────────────────┤ 3 saídas
         │                    ▼                        ▼                          ▼
         │            Telegram (alerta)        Gmail (alerta)          [modo automático] → MQTT cmd
         │
         │           ┌──────────────────────┐      ┌───────────────────────────┐
         │  MQTT     │ mqtt in              │ ───► │ "Processa Estado          │
         │ ◄──────── │ aviario/no1/         │      │  Atuadores" (JS)          │
         │           │ atuadores/estado     │      └───────────┬───────────────┘
         │           └──────────────────────┘                  │ 5 saídas
         │                                                      ├─► InfluxDB 1.x ("atuadores")
         │                                                      └─► 4× ui_text (🟢/⚪ por atuador)
         │
         │  MQTT     ┌──────────────────────────────────────────┐
         │ ◄──────── │ mqtt out aviario/no1/atuadores/cmd (QoS1)│ ◄── 3 origens:
         │           └──────────────────────────────────────────┘     1) "Monta Comando JSON" (dashboard)
         │                                                            2) "Verifica Limites…" (modo automático)
         │                                                            3) "Processa Comandos Telegram"
         │
         │           ┌──────────────────────┐      ┌──────────────────────────────┐     ┌──────────────────┐
         │           │ telegram receiver    │ ───► │ "Processa Comandos Telegram" │ ──► │ telegram sender  │
         │           │ (bot "Max", polling) │      └──────────────┬───────────────┘     │ (resposta)       │
         │           └──────────────────────┘                     └───► MQTT cmd        └──────────────────┘
```

### Papel de cada tecnologia

| Tecnologia | Papel no fluxo | Evidência no arquivo |
|---|---|---|
| **MQTT / Mosquitto** | Transporte pub/sub. 2 assinaturas (`sensores` e `atuadores/estado`, QoS 0) e 1 publicação (`atuadores/cmd`, QoS 1, retain `false`). Broker `localhost:1883`, MQTT 3.1.1 (`protocolVersion: 4`), sem TLS e sem credenciais no export; nome do nó: *"Broker Local (Mosquitto)"* | `mqtt in` ×2, `mqtt out` ×1, config `cfg_mqtt` |
| **Node-RED** | Orquestrador central: recebe, processa (funções JS), grava, exibe, alerta, decide automação e publica comandos | toda a aba |
| **InfluxDB 1.x** | Série temporal; database `aviario` em `http://localhost:8086`; measurements `sensores` e `atuadores` | config `cfg_influx` (`influxdbVersion: "1.x"`) |
| **Dashboard (node-red-dashboard)** | UI web na aba "Aviário": medidores, indicadores de estado e interruptores | nós `ui_gauge`, `ui_text`, `ui_switch`, `ui_tab`, `ui_group` |
| **Telegram** | (a) **alertas** (sender alimentado pela verificação de limites); (b) **comando/consulta** (receiver + função + sender de resposta). Bot **"Max"**, modo **polling** | `telegram sender` ×2, `telegram receiver` ×1, config `cfg_telegram` |
| **Gmail (SMTP)** | Alerta por e-mail: `smtp.gmail.com`, porta `465`, TLS, auth `BASIC` | nó `e-mail` |

### Bootstrap (grupo "0. Configuração Inicial")

Ao implantar (inject **"Ao implantar"**, `once: true`, delay 0,3 s), a função **"Define Configurações Globais"** cria as globais **apenas se ainda não existirem**:

| Variável global | Valor padrão no arquivo | Uso |
|---|---|---|
| `telegramChatId` | `'6163223530'` | destino dos alertas no Telegram |
| `modoAutomatico` | `false` | chave geral da automação (grupo 4) |
| `emailDestino` | `'deivisson.linojr@gmail.com'` | destinatário dos alertas por e-mail |
| `estadoAtuadores` | `{ v1:0, v2:0, asp:0, neb:0 }` | último estado conhecido dos 4 atuadores |

## 2. Variáveis monitoradas (tópico `aviario/no1/sensores`)

O `mqtt in` usa `datatype: json`, então `msg.payload` chega como objeto JSON. A função "Processa Sensores" lê e repassa ao InfluxDB exatamente **seis campos**:

| Campo | Unidade | Significado | Onde é usado no fluxo |
|---|---|---|---|
| `temperatura` | °C | Temperatura do galpão | InfluxDB; gauge; alertas; automação |
| `umidade` | % | Umidade relativa do ar | InfluxDB; gauge; alerta; regra do aspersor |
| `pressao_pa` | Pa | Pressão atmosférica | InfluxDB (**bruto em Pa**); gauge e mensagens exibem **hPa** (`Math.round(pressao_pa/100)`) |
| `nh3_ppm` | ppm | Amônia (NH₃) | InfluxDB; gauge; alerta; regra do nebulizador |
| `rssi` | 🔎 dBm | Intensidade do sinal recebido | **Apenas InfluxDB** — sem gauge/alerta/automação |
| `snr` | 🔎 dB | Relação sinal-ruído | **Apenas InfluxDB** — idem |

**Separação:** variáveis **ambientais** = `temperatura`, `umidade`, `pressao_pa`, `nh3_ppm`; **métricas de comunicação** = `rssi` e `snr` (⚠️ são métricas do enlace LoRa no contexto do projeto; no arquivo são apenas dois campos numéricos extras). A última leitura completa também é guardada em `global.ultimosSensores` — é o que alimenta o `/status` do Telegram.

## 3. Atuadores

| Campo | Nome no dashboard | Relé (⚠️ referência do firmware) |
|---|---|---|
| `v1` | Ventilador 1 | GPIO 25 |
| `v2` | Ventilador 2 | GPIO 33 |
| `asp` | Aspersor | GPIO 32 |
| `neb` | Nebulizador | GPIO 27 |

**Como o estado chega:** o `mqtt in` **`aviario/no1/atuadores/estado`** (JSON, QoS 0) abastece a função **"Processa Estado Atuadores"**, que:

1. atualiza `global.estadoAtuadores` com `{v1, v2, asp, neb}`;
2. monta `payload: {v1, v2, asp, neb}` + `measurement: 'atuadores'` → **InfluxDB**;
3. emite 4 booleanos (`d.v1 === 1`…) → 4 nós **`ui_text`** no dashboard (`🟢 Ligado` / `⚪ Desligado`).

Assim, o dashboard mostra o **estado real reportado pelo dispositivo** (quem publica nesse tópico é o firmware), e o InfluxDB registra o mesmo estado como série temporal (1/0 por campo). Comentário presente no código: o payload para o plugin `influxdb` 1.x precisa ser **objeto simples** (`{campo: valor}`) com o measurement em `msg.measurement` — array ali causa o erro *"val.slice is not a function"*.

## 4. Modo automático

**Ativação:** switch de dashboard **"Modo Automático"** (tópico `modoAutomatico`, booleano) → função **"Define Modo Automático"**: `global.set('modoAutomatico', msg.payload === true)`. Quem consome a flag é **"Verifica Limites / Automação / Alertas"**, executada a cada leitura de sensores.

### Limites no código (inalterados)

```js
const LIM_TEMP_MAX = 32; // °C
const LIM_TEMP_MIN = 15; // °C
const LIM_UMID_MAX = 80; // %
const LIM_NH3_MAX  = 25; // ppm
```

### Regras de automação (somente se `modoAutomatico === true`)

| Condição | Ação calculada |
|---|---|
| `temperatura > 32 °C` | `v1 = 1` e `v2 = 1` (os dois ventiladores LIGAM); senão, ambos `0` |
| `nh3_ppm > 25 ppm` **ou** `temperatura > 32 °C` | `neb = 1`; senão `0` |
| `umidade < 40 %` | `asp = 1`; senão `0` |

**Atualização do estado:** se o resultado diferir de `global.estadoAtuadores` (comparação por `JSON.stringify`), a função grava a nova global e emite `{ payload: novo }` na 3ª saída → o `mqtt out` **`aviario/no1/atuadores/cmd`**. Sem mudança → nada é publicado. O ciclo fecha quando o dispositivo publica o novo estado no tópico `.../estado` (seção 3).

### Alertas (independentes do modo automático)

| Condição | Mensagem disparada |
|---|---|
| `temperatura > 32 °C` | `🌡️ Temperatura ALTA: ... °C (limite 32 °C)` |
| `temperatura < 15 °C` | `🥶 Temperatura BAIXA: ... °C (limite 15 °C)` |
| `umidade > 80 %` | `💧 Umidade ALTA: ... % (limite 80 %)` |
| `nh3_ppm > 25 ppm` | `☣️ Amônia (NH3) ALTA: ... ppm (limite 25 ppm)` |

Havendo alerta, monta o texto completo (Temp/Umid/NH3/Pressão) e envia ao Telegram e ao Gmail. Sem alerta: `[null, null, autoMsg]` — os canais de alerta ficam silenciosos, mas o comando automático (se houver) ainda sai.

### Observações factuais

- O limiar do aspersor é o **literal `40`** (comentário no código: `// exemplo: aspersor liga se umidade muito baixa`) — **não** é a constante `LIM_UMID_MAX = 80`, que serve só ao alerta de umidade alta.
- **Temperatura baixa (< 15 °C) só gera alerta** — nenhuma ação automática.
- **Sem histerese/temporização**: recalcula a cada mensagem e publica apenas quando o resultado muda.
- **Sem deduplicação de alertas**: cada leitura fora dos limites gera novo Telegram/e-mail.

## 5. Controle manual (dashboard → MQTT)

Quatro switches `ui_switch`, um por atuador:

| Switch | `msg.topic` | Valores |
|---|---|---|
| Ventilador 1 | `v1` | `true`/`false` |
| Ventilador 2 | `v2` | `true`/`false` |
| Aspersor | `asp` | `true`/`false` |
| Nebulizador | `neb` | `true`/`false` |

Todos convergem na função **"Monta Comando JSON"**, que: (1) recupera `global.estadoAtuadores`; (2) aplica a mudança pelo `msg.topic` (`estado[msg.topic] = msg.payload ? 1 : 0`); (3) regrava a global; (4) emite `msg.payload = { v1, v2, asp, neb }` — **sempre os quatro campos**, não apenas o alterado.

O comando sai pelo `mqtt out` **`aviario/no1/atuadores/cmd`** — **QoS 1**, **retain `false`**, `contentType: application/json`. Esse é o **ponto único de saída** de todos os comandos (manual, automático e Telegram).

🔎 Nada alimenta a entrada dos switches — o interruptor mostra a posição deixada pelo usuário e **não se reposiciona sozinho** quando o comando vem do Telegram ou do modo automático. Já os `ui_text` de estado (grupo 2) mostram o estado real.

## 6. Controle via Telegram

**Bot:** nome **"Max"**, `updatemode: "polling"`, `pollinterval: 300`, `baseapiurl: https://api.telegram.org`; campos `usernames`/`chatids` vazios no export.

**Recebimento:** `telegram receiver` → função **"Processa Comandos Telegram"** (normaliza com `trim().toLowerCase()` e decide por `switch`):

| Comando | O que faz |
|---|---|
| `/status` | Responde com as **últimas leituras** em cache (`global.ultimosSensores`): Temp, Umidade, NH3, Pressão em hPa (`'--'` se não houver dado) + estado dos 4 atuadores (`ON`/`OFF`) + modo automático (`ATIVADO`/`DESATIVADO`). **Não consulta o InfluxDB.** |
| `/v1_on` · `/v1_off` | `v1 = 1` · `v1 = 0`; responde `Ventilador 1 LIGADO`/`DESLIGADO`; **publica o comando** |
| `/v2_on` · `/v2_off` | idem para `v2` |
| `/asp_on` · `/asp_off` | idem para `asp` |
| `/neb_on` · `/neb_off` | idem para `neb` |
| `/help` · `/start` | Texto de ajuda (`🐔 Bot Aviário` + lista de comandos) |
| *(qualquer outro texto)* | `Comando não reconhecido. Envie /help para ver os comandos disponíveis.` |

**Mecânica:** todo comando válido de atuador atualiza `global.estadoAtuadores` e emite na 2ª saída `{ payload: {v1,v2,asp,neb} }` → o **mesmo** `mqtt out` `aviario/no1/atuadores/cmd`. A 1ª saída sempre responde ao `chatId` de origem. Como o texto é convertido para minúsculas, `/V1_ON` também funciona.

🔎 O fluxo **não verifica o chat de origem** — o `chatId` recebido é usado apenas para responder; não há lista de autorizados no arquivo (os campos de controle do bot estão vazios neste export).

## 7. Banco de dados (InfluxDB 1.x)

**Configuração (`cfg_influx`):** InfluxDB **1.x**, `http`, `localhost:8086`, database **`aviario`**. Os nós de saída não definem `precision` nem `retentionPolicy` (padrões do plugin).

| Measurement | Origem | Campos | Finalidade |
|---|---|---|---|
| `sensores` | cada mensagem de `aviario/no1/sensores` | `temperatura`, `umidade`, `pressao_pa`, `nh3_ppm`, `rssi`, `snr` | histórico ambiental + qualidade do enlace de rádio |
| `atuadores` | cada mensagem de `aviario/no1/atuadores/estado` | `v1`, `v2`, `asp`, `neb` (**1/0**) | histórico de acionamentos |

O fluxo **não define tags explicitamente** (apenas measurement + campos); o carimbo de tempo é do momento da gravação. Este banco serve a consultas históricas externas — o dashboard do Node-RED **não** exibe gráficos de histórico.

O pipeline de dados do projeto está padronizado em **InfluxDB 1.x (InfluxQL)**: tanto o Telegraf quanto o Node-RED gravam no mesmo database `aviario`, compartilhando a mesma base para os painéis do Grafana (`backend/grafana/aviario_dashboard.json`).

## 8. Dashboard

Aba única **"Aviário"** (`ui_tab`), com 3 grupos:

| Grupo | Componentes | O que o operador acompanha/faz |
|---|---|---|
| **Sensores** | 4 × `ui_gauge` | **Temperatura** (0–50 °C; faixas: verde < 28, amarelo 28–35, vermelho > 35) · **Umidade** (0–100 %; 60/80) · **Pressão** (950–1050 hPa; faixas 980/1030, todas verdes) · **NH3** (0–50 ppm; 15/25) |
| **Atuadores** | 4 × `ui_text` + 4 × `ui_switch` | Estado em tempo real (`🟢 Ligado`/`⚪ Desligado`) e interruptores de comando manual |
| **Automação** | 1 × `ui_switch` | **"Modo Automático"** (liga/desliga as regras da seção 4) |

**Tempo real:** gauges atualizam a cada mensagem de `sensores`; indicadores de estado, a cada mensagem de `atuadores/estado`. Não há gráficos de histórico, tabelas de eventos nem medidores de RSSI/SNR no dashboard — histórico fica no InfluxDB.

## 9. Alertas

**Condições:** as 4 da seção 4 (`temp > 32`, `temp < 15`, `umidade > 80`, `NH3 > 25`), avaliadas a cada leitura, com ou sem modo automático.

**Mensagem única:**

```
⚠️ ALERTA AVIÁRIO ⚠️

[uma linha por alerta]

Leitura completa:
Temp: X °C | Umid: Y % | NH3: Z ppm | Pressão: W hPa
```

**Telegram:** `{ payload: { type:'message', content: texto, chatId: global(telegramChatId) } }` → nó **"Telegram - Alerta"** (destino padrão no arquivo: `6163223530`).

**Gmail:** `{ to: global(emailDestino), topic: 'Alerta - Sistema de Monitoramento do Aviário', payload: texto }` → nó **e-mail** (`smtp.gmail.com:465`, TLS). O `msg.topic` vira o **assunto**. O comentário no código justifica o `to` na mensagem: *"evita o erro 'No recipients defined' caso o campo 'To' do nó e-mail não seja preenchido corretamente"*. Destino padrão: `deivisson.linojr@gmail.com`.

**Limitações implementadas:** sem deduplicação/cooldown/alerta de normalização; **credenciais** (token do bot, conta Gmail) **não estão no export** — ficam no credential store do Node-RED (`flows_cred.json`). 🔎 Para Gmail com auth `BASIC` normalmente se usa senha de app (o arquivo não mostra o método de credencial).

## 10. Fluxo completo (sequência)

**Monitoramento:**

1. **Sensor** (fora deste arquivo) mede temperatura/umidade/pressão/NH₃ e transmite;
2. **Gateway** (fora deste arquivo) recebe, converte e **publica MQTT** em `aviario/no1/sensores` (+ `rssi`/`snr` do enlace);
3. **Node-RED** (`mqtt in`) recebe o JSON;
4. **"Processa Sensores"** guarda a última leitura em global e ramifica em 6 saídas;
5. **InfluxDB 1.x** grava `sensores`; **4 gauges** atualizam o dashboard;
6. **"Verifica Limites / Automação / Alertas"** avalia os limites → violação ⇒ **Telegram** + **Gmail**; modo automático ativo ⇒ calcula novo estado e, se mudou, **publica** em `cmd`.

**Estado dos atuadores:**

7. O dispositivo publica em `aviario/no1/atuadores/estado` → **"Processa Estado Atuadores"** → **InfluxDB** (`atuadores`) + **4 indicadores** + atualização de `global.estadoAtuadores`.

**Decisão automática (fecha o ciclo):**

8. `Verifica Limites…` → **`mqtt out` `aviario/no1/atuadores/cmd`** (QoS 1) → (fora do arquivo: gateway/atuador aplica nos relés) → novo estado volta pelo tópico `estado` (passo 7), atualizando dashboard e banco.

**Controle manual:**

9. **Switch** do dashboard → `msg.topic` identifica o atuador → **"Monta Comando JSON"** → **mesmo `mqtt out` `cmd`**.

**Controle via Telegram:**

10. Comando ao bot "Max" → **receiver** → **"Processa Comandos Telegram"** → resposta (sender) e, se for comando de atuador, publicação no **mesmo `mqtt out` `cmd`**; `/status` responde do cache global, sem tocar no MQTT.

**⇢ Os três caminhos de comando (manual, automático e Telegram) convergem no MESMO nó de publicação e no MESMO tópico `aviario/no1/atuadores/cmd`** — característica central da arquitetura.

## Diferenciação final: implementado × interpretação × dependências externas

**✅ Implementado no arquivo:** tudo o que esta documentação descreve, incluindo os plugins declarados no próprio export.

**❌ Não está no arquivo (dependências externas):**

- O broker **Mosquitto em si** (o arquivo só aponta para `localhost:1883`, sem TLS e sem credenciais declaradas);
- O **servidor InfluxDB 1.x** e o database `aviario`;
- Os **nós físicos** (sensor, gateway, atuador ESP32) e o rádio LoRa — nada a montante do `mqtt in` aparece;
- O **token do bot "Max"** e as **credenciais do Gmail** (omitidas do export, por padrão do Node-RED);
- Nenhuma **verificação de autorização** no fluxo para comandos do Telegram.

**⚠️ Pontos de atenção (verificáveis no arquivo):**

1. Aspersor com limiar `40` **literal**, diferente da constante `LIM_UMID_MAX = 80` (o comentário admite ser um "exemplo");
2. Temp. baixa (< 15 °C) apenas alerta; sem ação automática;
3. Switches do dashboard **não sincronizam** com o estado real (nada ligado às suas entradas); os textos de estado sincronizam;
4. Alertas **sem debounce** — podem repetir a cada leitura;
5. **Chat ID e e-mail reais embutidos** no fluxo (`6163223530`, `deivisson.linojr@gmail.com`) — se o repositório for publicado, considere parametrizar/mascarar;
6. **Conexões do broker**: aqui o broker padrão no export é `localhost:1883`, enquanto na máquina de teste/cenário distribuído o gateway pode publicar em `192.168.0.3` — ajuste conforme a topologia da rede local;
7. ⚠️ No restante do projeto alguns valores do gateway aparecem como **string** (ex.: `"temperatura":"25.5"`); se ocorrer no ambiente real, o InfluxDB gravaria campos de texto (as comparações JS continuam funcionando por coerção) — vale conferir.

**Reprodução:** importe `flows/flows.json` no Node-RED (Menu → Import) e instale os 4 módulos listados no início deste documento.




