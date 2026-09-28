/*
 * ESP32 — Nó único Gateway + Atuador (sem hop LoRa intermediário)
 *
 * Arquitetura (ADR-0004):
 *   Nó sensor (ATtiny85 + MiCS-6814 + BME280 + SX1276)
 *          └── LoRa P2P ──> ESP32 + SX1276
 *                              ├── LCD 16x2 (I2C 0x27)
 *                              ├── relés via PCF8574 (I2C 0x20)
 *                              └── Wi-Fi/MQTT
 *
 * Credenciais: src/config.h (copie de config.h.example — não versionado).
 *
 * ⚠️ CONTRATO DE COMANDO (também em docs/PROTOCOLO.md)
 * ═══════════════════════════════════════════════════════════════════════════
 * Tópico:  aviario/no1/atuadores/comando
 *   CMD|MODO:MANUAL|V1:1|V2:0|ASP:0|NEB:0
 *   CMD|MODO:AUTO
 * Em MODO:MANUAL os campos V1/V2/ASP/NEB são aplicados; em MODO:AUTO
 * apenas o modo muda (a histerese NH3 do dispositivo assume os relés).
 * O Node-RED/Telegram/dashboard enviam MODO:MANUAL explícito quando querem
 * comandar: em MODO:MANUAL quem decide V2/ASP/NEB é o Node-RED; em MODO:AUTO
 * quem decide é a histerese embarcada (exclusão mútua documentada no ADR-0004).
 *
 * ── FAILSAFE DE V1 (proteção de NH3) — armado SEMPRE ────────────────────────
 * Hoje V1 é o ÚNICO atuador instalado (V2/ASP/NEB são reserva de expansão, ver
 * ADR-0004) e a única defesa contra acúmulo de amônia no galpão. Por isso a
 * proteção por NH3 NÃO depende do campo MODO — o campo não a desabilita:
 *   • MODO:MANUAL → V1 = comando do operador OU proteção (a proteção pode ligar
 *     V1 por cima do comando; nunca desligar um V1 pedido pelo operador);
 *   • MODO:AUTO   → V1 = proteção (histerese; comando manual de V1 é ignorado);
 *   • sem medição confiável (sensor offline ou NH3 ausente no pacote) → a
 *     proteção arma: na dúvida sobre gás tóxico, ventilar é o estado seguro.
 * O estado publicado carrega "v1_protecao":1 quando é a proteção (e não o
 * comando) que mantém V1 ligado, para dashboard/Node-RED distinguirem failsafe
 * de comando.
 *
 * Payload do sensor (ATtiny85, sem prefixo "SENS|"):
 *   T:25.5|U:60|P:101325|A:12.3
 *   T → temperatura (°C, float)   U → umidade (%RH)
 *   P → pressão (Pa)              A → NH3 (ppm)
 * Não existe campo de bateria (BAT:) neste firmware.
 *
 * Tópicos publicados:
 *   aviario/no1/sensores           (JSON + alias legado nh3_ppm)
 *   aviario/no1/atuadores/estado   (JSON + aliases legados asp/neb)
 *   aviario/no1/status             (Last Will: online/offline, retained)
 *
 * Bibliotecas (ver platformio.ini):
 *   RadioLib, PubSubClient, LiquidCrystal_I2C, PCF8574 (Rob Tillaart)
 *
 * Notas de implementação (revisão de robustez):
 *   • Relés: 1 write8() por atualização no PCF8574 (1 transação I²C) em vez
 *     de 4 write() com read-modify-write — menos tempo de barramento e sem
 *     estado intermediário entre relés.
 *   • LCD: só reescreve quando o texto muda (cache por linha) e no máximo
 *     1×/s, com redesenho forçado a cada 30 s. Antes, cada iteração do loop
 *     reescrevia as 2 linhas (limpa + escreve = ~34 transações I²C).
 *   • LoRa: reinit automático se o rádio não subir no boot ou após
 *     LORA_ERROS_MAX erros seguidos de leitura — este hardware tem histórico
 *     de solda fria/jumper (docs/HARDWARE.md).
 *   • MQTT: leitura do sensor que não pôde ser publicada (broker fora do ar
 *     no instante do pacote LoRa) é reenviada no ciclo de 30 s, em vez de
 *     ficar perdida até o próximo ciclo de ~5 min do ATtiny85.
 *   • Parsers: campo ausente OU malformado é ignorado, e não vira 0/NaN
 *     silencioso (o comando "V1:abc" não desliga mais o ventilador).
 *   • Fail-safe de V1: a proteção de NH3 é reavaliada a cada loop (não só
 *     quando chega pacote), então "sensor morreu" também arma a ventilação —
 *     ver ADR-0004 e a seção PROTEÇÃO DE NH3.
 */

#include <Arduino.h>
#include <SPI.h>
#include <Wire.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <RadioLib.h>
#include <LiquidCrystal_I2C.h>
#include <PCF8574.h>

#include <math.h>     // isfinite()/isnan() na validação dos campos

#include "config.h"   // WiFi/MQTT locais (não versionado)

// Falha cedo e com mensagem clara quando o config.h não foi criado/preenchido.
#if !defined(WIFI_SSID) || !defined(WIFI_PASSWORD) || !defined(MQTT_HOST) || !defined(MQTT_PORT)
#error "config.h ausente ou incompleto: copie src/config.h.example para src/config.h e edite"
#endif

// ============================== TÓPICOS ======================================

const char *MQTT_CLIENT_PREFIX = "aerem-gateway-";
const char *MQTT_LAST_WILL     = "offline";   // Last Will/Testamento (retained)

const char *TOPIC_SENSOR  = "aviario/no1/sensores";
const char *TOPIC_COMMAND = "aviario/no1/atuadores/comando";  // era .../cmd (ADR-0004)
const char *TOPIC_STATE   = "aviario/no1/atuadores/estado";
const char *TOPIC_STATUS  = "aviario/no1/status";

// ============================== PINAGEM ======================================

// SX1276
#define LORA_NSS   5
#define LORA_RST   14
#define LORA_DIO0  35   // era GPIO 26 — trilha da PCB faltou, corrigido com jumper

// I2C
#define I2C_SDA       21
#define I2C_SCL       22
#define PCF8574_ADDR  0x20
#define LCD_ADDR      0x27

// Saídas do PCF8574 (expansor I2C — substitui os GPIO 25/33/32/27 diretos)
#define PCF_VENT1  0
#define PCF_VENT2  1
#define PCF_ASPER  2
#define PCF_NEBUL  3

#define RELAY_ON   LOW
#define RELAY_OFF  HIGH

#define LCD_COLS 16
#define LCD_ROWS 2

// ============================ CONFIGURAÇÃO LoRa ==============================

#define LORA_FREQ  915.0f
#define LORA_BW    125.0f
#define LORA_SF    7
#define LORA_CR    5
#define LORA_SYNC_WORD 0x12

// ── Prefixo do pacote do sensor — ATtiny85 NÃO envia prefixo "SENS|" ────────
// O payload começa direto em "T:", então o teste de reconhecimento usa isso.
#define PREFIX_SENSOR "T:"

// Eco de estado por LoRa (diagnóstico de rádio): 0 = desligado, pois o nó
// único não tem mais hop intermediário para retransmitir/comandar (ADR-0004).
// Ligue com build_flags = -DLORA_ECHO_DIAGNOSTICO=1 para testar o link.
#ifndef LORA_ECHO_DIAGNOSTICO
#define LORA_ECHO_DIAGNOSTICO 0
#endif

// ============================== TEMPORIZAÇÃO =================================

const uint32_t WIFI_RETRY_MS      = 10000UL;
const uint32_t MQTT_RETRY_MS      = 5000UL;
const uint32_t STATE_PUBLISH_MS   = 30000UL;
const uint32_t LCD_PAGE_MS        = 4000UL;
const uint32_t LCD_REFRESH_MS     = 1000UL;   // avalia o texto do LCD 1×/s
const uint32_t LCD_REDRAW_MS      = 30000UL;  // redesenho forçado (ressincroniza)
const uint32_t LORA_RETRY_MS      = 60000UL;  // reinit do rádio indisponível
// Ciclo de transmissão do nó sensor (ATtiny85): ~320 s (deep sleep de 37 × 8 s
// do WDT). Valor de referência registrado em docs/APRENDIZADOS.md.
const uint32_t SENSOR_CICLO_MS    = 320000UL;
// 1,5× o ciclo: tolera um ciclo atrasado (o WDT tem jitter) sem declarar o
// sensor OFFLINE — timeout menor que o ciclo deixava o sensor OFF quase sempre
// e a automação por NH3 nunca disparava. Este timeout é também o que arma o
// fail-safe de V1 quando o sensor para de transmitir (sem medição = ventila):
// encurtar reduz a janela sem informação de NH3, mas abaixo de 1 ciclo a
// proteção ligaria V1 à toa.
const uint32_t SENSOR_TIMEOUT_MS  = (SENSOR_CICLO_MS * 3UL) / 2UL;   // 480 s

// ============================ TAMANHOS DE BUFFER =============================

const uint16_t MQTT_BUFFER_BYTES     = 512;   // payload máx. de RX/TX no PubSubClient
const uint16_t MQTT_KEEPALIVE_S      = 30;
const uint16_t MQTT_SOCKET_TIMEOUT_S = 5;     // default 15 s travava o loop ao conectar
const size_t   CMD_BUFFER_BYTES      = 160;   // payload máx. aceito em .../comando
const size_t   LORA_BUFFER_BYTES     = 128;   // buffer de recepção LoRa
const size_t   LORA_PACOTE_MAX_BYTES = LORA_BUFFER_BYTES - 1;
const uint8_t  LORA_ERROS_MAX        = 5;     // erros seguidos → reinit do rádio
const uint8_t  LCD_PAGINAS           = 3;

// ============================ CONTROLE AUTOMÁTICO =============================

// Histerese da amônia — FAILSAFE OPCIONAL (ativo só em MODO:AUTO).
// Padrão de fábrica é MODO:MANUAL (dono da automação = Node-RED, ADR-0004):
// as duas automações nunca rodam ao mesmo tempo.
const float NH3_LIGA_PPM     = 10.0f;
const float NH3_DESLIGA_PPM  = 5.0f;

// Neste exemplo, o controle automático atua em V1.
// V2 é RESERVA DE EXPANSÃO: não existe hardware instalado hoje, por isso o
// espelhamento fica desligado; ASP e NEB também não têm hardware e não entram
// na histerese (são associados a controle térmico/umidade, não a NH3).
const bool AUTO_USAR_VENT2 = false;

// =============================== OBJETOS ======================================

SX1276 radio = new Module(LORA_NSS, LORA_DIO0, LORA_RST);
LiquidCrystal_I2C lcd(LCD_ADDR, LCD_COLS, LCD_ROWS);
PCF8574 relayExp(PCF8574_ADDR);

WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);

// ============================== ESTRUTURAS ====================================

enum ModoOperacao : uint8_t {
  MODO_AUTOMATICO,
  MODO_MANUAL
};

struct EstadoAtuadores {
  bool vent1 = false;
  bool vent2 = false;
  bool asper = false;
  bool nebul = false;
};

struct DadosSensor {
  float nh3 = NAN;
  float temperatura = NAN;
  float umidade = NAN;
  float pressao_pa = NAN;   // mantido — o BME280 lê e o dado é válido
  float rssi = NAN;
  float snr = NAN;
  uint32_t recebidoEm = 0;
  bool valido = false;
};

EstadoAtuadores estado;
DadosSensor sensor;
// Padrão MANUAL (D2/ADR-0004): o Node-RED é o dono da automação por
// temperatura/umidade; a histerese NH3 embarcada só entra com CMD|MODO:AUTO.
ModoOperacao modo = MODO_MANUAL;

// ============================== VARIÁVEIS =====================================

volatile bool pacoteLoRaRecebido = false;

uint32_t ultimoWifiRetry = 0;
uint32_t ultimoMqttRetry = 0;
uint32_t ultimaPublicacaoEstado = 0;
uint32_t ultimaTrocaLCD = 0;
uint32_t ultimaAvaliacaoLCD = 0;      // throttle do LCD (ver atualizarLCD)
uint32_t ultimoRedesenhoLCD = 0;      // redesenho forçado do LCD
uint8_t paginaLCD = 0;

bool loraDisponivel = false;
uint32_t ultimaTentativaLoRa = 0;
uint8_t errosLoRaConsecutivos = 0;

// Proteção de NH3 de V1 (ver ADR-0004 e a seção PROTEÇÃO DE NH3):
//   protecaoNH3Ativa — saída da histerese, armada em QUALQUER modo;
//   v1Comandado      — última intenção do operador para V1 (MODO:MANUAL).
// A proteção pode ligar V1 por cima de v1Comandado; nunca desligá-lo.
bool protecaoNH3Ativa = false;
bool v1Comandado = false;

// Contador de leituras recebidas × publicadas: permite reenviar ao broker a
// última leitura que não pôde ser publicada (ver publicarSensorPendente).
uint32_t leiturasRecebidas = 0;
uint32_t leiturasPublicadas = 0;

// ============================== UTILITÁRIOS ===================================

void IRAM_ATTR sinalizarPacoteLoRa() {
  pacoteLoRaRecebido = true;
}

const char *textoModo() {
  return modo == MODO_AUTOMATICO ? "AUTO" : "MANUAL";
}

// Escreve exatamente LCD_COLS caracteres (preenchendo com espaços à direita),
// o que já apaga sobras da escrita anterior em uma única passada — antes era
// preciso limpar a linha com 16 espaços e só então escrever o texto.
void escreverLinhaLCD(uint8_t linha, const char *texto) {
  char buffer[LCD_COLS + 1];
  snprintf(buffer, sizeof(buffer), "%-*s", LCD_COLS, texto);
  lcd.setCursor(0, linha);
  lcd.print(buffer);
}

bool sensorOnline() {
  return sensor.valido && (millis() - sensor.recebidoEm <= SENSOR_TIMEOUT_MS);
}

// ── Parsers do payload texto pipe-delimited ─────────────────────────────────
// Campo ausente OU malformado devolve false e NÃO altera o destino — o
// chamador decide o que fazer (antes, "V1:abc" virava 0 = relé desligado).
static bool extrairFloat(const char *payload, const char *chave, float &destino) {
  if (payload == nullptr) return false;

  const char *p = strstr(payload, chave);
  if (p == nullptr) return false;

  p += strlen(chave);
  char *fim = nullptr;
  const float valor = strtof(p, &fim);

  if (fim == p || !isfinite(valor)) return false;
  destino = valor;
  return true;
}

// Devolve qualquer inteiro da faixa (inclusive negativo) por referência: o
// int8_t anterior truncava valores > 127 silenciosamente.
static bool extrairInteiro(const char *payload, const char *chave, int &destino) {
  if (payload == nullptr) return false;

  const char *p = strstr(payload, chave);
  if (p == nullptr) return false;

  p += strlen(chave);
  char *fim = nullptr;
  const long valor = strtol(p, &fim, 10);

  if (fim == p) return false;
  destino = static_cast<int>(valor);
  return true;
}

// ================================ RELÉS ======================================

// A composição abaixo assume módulo de relé ativo-baixo (RELAY_ON = LOW).
static_assert(RELAY_ON == LOW && RELAY_OFF == HIGH,
              "comporSaidas() assume relés ativo-baixo (RELAY_ON = LOW)");

// Máscara de um pino no estado LIGADO (bit em 0 — relé ativo-baixo).
constexpr uint8_t mascaraLigado(uint8_t pino) {
  return static_cast<uint8_t>(~(1u << pino));
}

// Byte completo de saída do PCF8574; bits não usados ficam em 1 (repouso).
uint8_t comporSaidas() {
  uint8_t mascara = 0xFF;

  if (estado.vent1) mascara &= mascaraLigado(PCF_VENT1);
  if (estado.vent2) mascara &= mascaraLigado(PCF_VENT2);
  if (estado.asper) mascara &= mascaraLigado(PCF_ASPER);
  if (estado.nebul) mascara &= mascaraLigado(PCF_NEBUL);

  return mascara;
}

// Uma única transação I²C por atualização (write8) — antes eram 4 write(),
// cada um pagando o custo do barramento a 100 kHz (~300 µs) e deixando os
// relés em estados intermediários até o último write.
void aplicarEstado() {
  relayExp.write8(comporSaidas());
}

void desligarTodos() {
  estado.vent1 = false;
  estado.vent2 = false;
  estado.asper = false;
  estado.nebul = false;
  aplicarEstado();
}

// ============================== MQTT =========================================

bool publicarEstado(bool retained = true) {
  if (!mqtt.connected()) return false;

  // Chaves novas (aspersor/nebulizador) + aliases legados (asp/neb) para
  // Telegraf/Grafana/Node-RED — dívida técnica com prazo de remoção no ADR-0004.
  // "v1_protecao": 1 = V1 mantido ligado pela proteção de NH3 (fail-safe), e
  // não pelo comando — chave aditiva, não quebra consumidor existente.
  char payload[192];
  snprintf(
    payload,
    sizeof(payload),
    "{\"modo\":\"%s\",\"v1\":%d,\"v2\":%d,\"aspersor\":%d,"
    "\"nebulizador\":%d,\"asp\":%d,\"neb\":%d,"
    "\"sensor_online\":%d,\"v1_protecao\":%d}",
    textoModo(),
    estado.vent1 ? 1 : 0,
    estado.vent2 ? 1 : 0,
    estado.asper ? 1 : 0,
    estado.nebul ? 1 : 0,
    estado.asper ? 1 : 0,
    estado.nebul ? 1 : 0,
    sensorOnline() ? 1 : 0,
    protecaoNH3Ativa ? 1 : 0
  );

  if (mqtt.publish(TOPIC_STATE, payload, retained)) {
    Serial.printf("[MQTT TX] %s -> %s\n", TOPIC_STATE, payload);
    return true;
  }

  Serial.printf("[MQTT ERRO] falha ao publicar em %s (mqtt.state=%d)\n",
                TOPIC_STATE, mqtt.state());
  return false;
}

bool publicarSensor() {
  if (!mqtt.connected() || !sensor.valido) return false;

  // "nh3" é a chave nova; "nh3_ppm" é o alias legado consumido por
  // Node-RED (alertas), Telegraf/Grafana — ver ADR-0004 (dívida técnica).
  char payload[256];
  snprintf(
    payload,
    sizeof(payload),
    "{\"nh3\":%.2f,\"nh3_ppm\":%.2f,\"temperatura\":%.2f,\"umidade\":%.2f,"
    "\"pressao_pa\":%.0f,\"rssi\":%.1f,\"snr\":%.1f,\"modo\":\"%s\"}",
    sensor.nh3,
    sensor.nh3,
    sensor.temperatura,
    sensor.umidade,
    sensor.pressao_pa,
    sensor.rssi,
    sensor.snr,
    textoModo()
  );

  if (!mqtt.publish(TOPIC_SENSOR, payload, false)) {
    Serial.println("[MQTT ERRO] falha ao publicar leitura (reenvio no ciclo de 30 s)");
    return false;
  }

  leiturasPublicadas = leiturasRecebidas;   // marca esta leitura como entregue
  Serial.printf("[MQTT TX] %s -> %s\n", TOPIC_SENSOR, payload);
  return true;
}

// Há leitura recebida via LoRa ainda não entregue ao broker?
bool leituraSensorPendente() {
  return sensor.valido && leiturasPublicadas != leiturasRecebidas;
}

// Reenvia a última leitura pendente (ex.: broker fora do ar no instante em que
// o pacote LoRa chegou). Em operação normal não republica nada — evita
// duplicar pontos no Telegraf/InfluxDB.
void publicarSensorPendente() {
  if (!mqtt.connected() || !leituraSensorPendente()) return;
  publicarSensor();
}

void publicarStatus(const char *status, bool retained = true) {
  if (!mqtt.connected()) return;
  mqtt.publish(TOPIC_STATUS, status, retained);
}

// Tabela de campos manuais aceitos em "CMD|MODO:MANUAL|V1:1|...": substitui
// 4 blocos idênticos de extrair/comparar/aplicar (novo campo = 1 linha aqui).
struct CampoBooleano {
  const char *chave;
  bool *destino;
};

// Protótipo: a avaliação da proteção de NH3 vive na seção "PROTEÇÃO DE NH3"
// (mais abaixo), mas o parser de comando precisa reavaliar V1 antes de aplicar.
bool recalcularVentilacao();

const CampoBooleano CAMPOS_MANUAIS[] = {
  // V1 aponta para a INTENÇÃO do operador, não direto para o relé: a proteção
  // de NH3 (sempre armada) entra depois e pode ligar V1 por cima dela.
  {"V1:", &v1Comandado},
  // V2/ASP/NEB são reserva de expansão (sem hardware instalado hoje): o
  // protocolo continua aceitando, memorizando e publicando os três campos.
  {"V2:", &estado.vent2},
  {"ASP:", &estado.asper},
  {"NEB:", &estado.nebul},
};

// Troca o modo de operação; devolve true se o modo realmente mudou.
bool definirModo(ModoOperacao novoModo) {
  if (modo == novoModo) return false;
  modo = novoModo;
  return true;
}

// Aplica um campo "CHAVE:valor" se ele existir no payload; devolve true se o
// estado da saída mudou.
bool aplicarCampoManual(const char *payload, const CampoBooleano &campo) {
  int valor;
  if (!extrairInteiro(payload, campo.chave, valor)) return false;

  const bool novo = valor != 0;
  if (novo == *campo.destino) return false;

  *campo.destino = novo;
  return true;
}

// Contrato: tópico .../comando com payload pipe-delimited "CMD|..." (ADR-0004).
// Em MODO:MANUAL os campos V1/V2/ASP/NEB são aplicados; em MODO:AUTO apenas o
// modo muda (a histerese NH3 embarcada assume os relés).
bool processarComando(const char *payload) {
  if (payload == nullptr || strncmp(payload, "CMD|", 4) != 0) return false;

  bool mudou = false;

  if (strstr(payload, "MODO:AUTO") != nullptr) {
    if (definirModo(MODO_AUTOMATICO)) mudou = true;
  } else if (strstr(payload, "MODO:MANUAL") != nullptr) {
    if (definirModo(MODO_MANUAL)) mudou = true;
  }

  // Em modo manual, aceita estados individuais (só os campos presentes).
  if (modo == MODO_MANUAL) {
    for (const CampoBooleano &campo : CAMPOS_MANUAIS) {
      if (aplicarCampoManual(payload, campo)) mudou = true;
    }
  }

  if (mudou) {
    // A proteção de NH3 tem a última palavra sobre V1: um comando (ou a troca
    // de modo) não pode desligar V1 protegido — ver ADR-0004.
    recalcularVentilacao();
    aplicarEstado();
  }

  return mudou;
}

void callbackMQTT(char *topic, byte *payload, unsigned int length) {
  if (strcmp(topic, TOPIC_COMMAND) != 0) return;
  if (payload == nullptr || length == 0) return;

  char mensagem[CMD_BUFFER_BYTES];
  const size_t tamanho = min(static_cast<size_t>(length), sizeof(mensagem) - 1);
  memcpy(mensagem, payload, tamanho);
  mensagem[tamanho] = '\0';

  Serial.printf("[MQTT RX] %s -> %s\n", topic, mensagem);

  if (processarComando(mensagem)) {
    publicarEstado();
  } else {
    Serial.println("[MQTT RX] comando ignorado (esperado \"CMD|...\")");
  }
}

void conectarMQTT() {
  if (WiFi.status() != WL_CONNECTED || mqtt.connected()) return;

  const uint32_t agora = millis();
  if (agora - ultimoMqttRetry < MQTT_RETRY_MS) return;
  ultimoMqttRetry = agora;

  char clientId[48];
  const uint64_t chipId = ESP.getEfuseMac();
  snprintf(
    clientId,
    sizeof(clientId),
    "%s%04X%08X",
    MQTT_CLIENT_PREFIX,
    static_cast<uint16_t>(chipId >> 32),
    static_cast<uint32_t>(chipId)
  );

  Serial.printf("[MQTT] Conectando a %s:%u...\n", MQTT_HOST, MQTT_PORT);

  // Last Will retained em aviario/no1/status: o broker publica "offline"
  // sozinho se este nó cair sem conseguir se desconectar.
  const bool conectado = strlen(MQTT_USER) > 0
    ? mqtt.connect(clientId, MQTT_USER, MQTT_PASSWORD, TOPIC_STATUS, 1, true,
                   MQTT_LAST_WILL)
    : mqtt.connect(clientId, TOPIC_STATUS, 1, true, MQTT_LAST_WILL);

  if (!conectado) {
    Serial.printf("[MQTT] Falha, estado=%d\n", mqtt.state());
    return;
  }

  Serial.println("[MQTT] Conectado");
  mqtt.subscribe(TOPIC_COMMAND);
  publicarStatus("online");
  publicarEstado();
  publicarSensorPendente();   // leitura que ficou pendente durante a queda
}

// ================================ WI-FI ======================================

void iniciarWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.persistent(false);
  // Nó alimentado pela rede elétrica: desligar o modem-sleep deixa o enlace
  // mais responsivo e reduz perda de pacotes MQTT (o padrão economiza energia).
  WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.printf("[WiFi] Conectando a %s\n", WIFI_SSID);
}

void manterWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  const uint32_t agora = millis();
  if (agora - ultimoWifiRetry < WIFI_RETRY_MS) return;
  ultimoWifiRetry = agora;

  Serial.println("[WiFi] Reconectando...");
  WiFi.disconnect(false, false);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

// =========================== PROTEÇÃO DE NH3 (V1) =============================
// Failsafe do nó: V1 é o único atuador instalado hoje e a única defesa contra
// acúmulo de amônia no galpão (V2/ASP/NEB são reserva de expansão — ADR-0004).
// Por isso a proteção NÃO é exclusiva do MODO:AUTO — o campo MODO nunca a
// desabilita; ele só define QUEM decide V2/ASP/NEB.
//
//   MODO:MANUAL → V1 = comando do operador OU proteção (a proteção liga por
//                 cima do comando; nunca desliga um V1 que o operador ligou)
//   MODO:AUTO   → V1 = proteção (histerese; comando manual de V1 é ignorado)
//   Sem medição confiável (sensor offline ou NH3 ausente no pacote) → proteção
//   armada: na dúvida sobre gás tóxico, ventilar é o estado seguro.

// Avalia a histerese da amônia (com memória entre avaliações) e devolve o
// estado atual da proteção.
bool avaliarProtecaoNH3() {
  if (!sensorOnline() || isnan(sensor.nh3)) {
    protecaoNH3Ativa = true;   // fail-safe: sem medição válida, ventila
    return protecaoNH3Ativa;
  }

  // Ligado só desliga abaixo de NH3_DESLIGA_PPM; desligado só liga a partir de
  // NH3_LIGA_PPM (a faixa intermediária preserva o estado, sem oscilar relé).
  protecaoNH3Ativa = protecaoNH3Ativa ? (sensor.nh3 >= NH3_DESLIGA_PPM)
                                      : (sensor.nh3 >= NH3_LIGA_PPM);
  return protecaoNH3Ativa;
}

// Recalcula o estado efetivo de V1 (e de V2, quando esse hardware existir) a
// partir de modo + comando + proteção. Devolve true se alguma saída mudou.
bool recalcularVentilacao() {
  const bool proteger = avaliarProtecaoNH3();
  const bool v1Desejado = proteger || (modo == MODO_MANUAL && v1Comandado);

  bool mudou = false;
  if (v1Desejado != estado.vent1) {
    estado.vent1 = v1Desejado;
    mudou = true;
  }

  if (AUTO_USAR_VENT2 && modo == MODO_AUTOMATICO && estado.vent2 != v1Desejado) {
    estado.vent2 = v1Desejado;   // reserva: só quando V2 existir de fato
    mudou = true;
  }

  return mudou;
}

// Reavalia a proteção e aplica/publica quando o estado muda. Chamada a cada
// iteração do loop (é o que arma o fail-safe quando o sensor para de responder)
// e a cada pacote recebido do sensor.
void executarProtecaoNH3() {
  if (!recalcularVentilacao()) return;

  aplicarEstado();
  publicarEstado();
  Serial.printf(
    "[PROTECAO] protecao:%d -> V1:%d "
    "(V1 comandado:%d, modo:%s, sensor_online:%d, NH3=%.2f ppm)\n",
    protecaoNH3Ativa ? 1 : 0,
    estado.vent1 ? 1 : 0,
    v1Comandado ? 1 : 0,
    textoModo(),
    sensorOnline() ? 1 : 0,
    sensor.nh3
  );
}

// ================================ LoRa =======================================

// Contador de falhas seguidas do rádio: ao estourar LORA_ERROS_MAX o nó marca
// o rádio como indisponível e manterLoRa() tenta reinicializá-lo — este
// hardware já deu solda fria/jumper no módulo LoRa (docs/HARDWARE.md).
void registrarErroLoRa() {
  if (errosLoRaConsecutivos < 0xFF) errosLoRaConsecutivos++;

  if (errosLoRaConsecutivos >= LORA_ERROS_MAX && loraDisponivel) {
    loraDisponivel = false;
    Serial.printf(
      "[LoRa] %u erros seguidos — rádio marcado indisponível (reinit em %lu s)\n",
      static_cast<unsigned>(errosLoRaConsecutivos),
      LORA_RETRY_MS / 1000UL
    );
  }
}

void iniciarRecepcaoLoRa() {
  if (!loraDisponivel) return;

  const int state = radio.startReceive();
  if (state != RADIOLIB_ERR_NONE) {
    Serial.printf("[LoRa] Erro startReceive: %d\n", state);
    registrarErroLoRa();
  }
}

// Configura o rádio. Pode ser chamada de novo em runtime (ver manterLoRa).
bool iniciarLoRa() {
  const int state = radio.begin(
    LORA_FREQ,
    LORA_BW,
    LORA_SF,
    LORA_CR,
    LORA_SYNC_WORD
  );

  if (state != RADIOLIB_ERR_NONE) {
    Serial.printf("[LoRa] Erro de inicialização: %d\n", state);
    loraDisponivel = false;
    return false;
  }

  radio.setPacketReceivedAction(sinalizarPacoteLoRa);
  loraDisponivel = true;
  errosLoRaConsecutivos = 0;
  iniciarRecepcaoLoRa();
  Serial.println("[LoRa] Inicializado");
  return true;
}

// Rádio indisponível (falhou no boot ou acumulou erros)? Tenta subir de novo a
// cada LORA_RETRY_MS, em vez de ficar surdo até alguém reiniciar o nó.
void manterLoRa() {
  if (loraDisponivel) return;

  const uint32_t agora = millis();
  if (agora - ultimaTentativaLoRa < LORA_RETRY_MS) return;
  ultimaTentativaLoRa = agora;

  Serial.println("[LoRa] Tentando reinicializar o rádio...");
  iniciarLoRa();
}

// ─────────────────────────────────────────────────────────────────────────────
// Processa pacote do sensor ATtiny85.
// Formato REAL enviado pelo firmware: "T:25.5|U:60|P:101325|A:12.3"
//   T → temperatura °C (float, já em escala real)
//   U → umidade %RH (inteiro, mas aceito como float por conveniência)
//   P → pressão em Pa (inteiro)
//   A → amônia ppm (float)
// Não existe campo de bateria neste firmware — sensor.bateria foi removido.
// ─────────────────────────────────────────────────────────────────────────────
bool processarPacoteSensor(const char *payload) {
  if (strncmp(payload, PREFIX_SENSOR, sizeof(PREFIX_SENSOR) - 1) != 0) return false;

  DadosSensor novos = sensor;
  bool encontrou = false;

  encontrou |= extrairFloat(payload, "T:", novos.temperatura);
  encontrou |= extrairFloat(payload, "U:", novos.umidade);
  encontrou |= extrairFloat(payload, "P:", novos.pressao_pa);
  encontrou |= extrairFloat(payload, "A:", novos.nh3);

  if (!encontrou) return false;

  novos.rssi = radio.getRSSI();
  novos.snr = radio.getSNR();
  novos.recebidoEm = millis();
  novos.valido = true;
  sensor = novos;
  leiturasRecebidas++;   // habilita o reenvio caso a publicação abaixo falhe

  Serial.printf(
    "[SENSOR] NH3=%.2f ppm T=%.2f C UR=%.2f %% P=%.0f Pa "
    "RSSI=%.1f dBm SNR=%.1f dB\n",
    sensor.nh3,
    sensor.temperatura,
    sensor.umidade,
    sensor.pressao_pa,
    sensor.rssi,
    sensor.snr
  );

  publicarSensor();
  executarProtecaoNH3();   // reavalia a proteção de V1 com a leitura nova
  return true;
}

void processarRecepcaoLoRa() {
  if (!pacoteLoRaRecebido || !loraDisponivel) return;

  pacoteLoRaRecebido = false;

  const size_t tamanho = radio.getPacketLength();
  if (tamanho == 0 || tamanho > LORA_PACOTE_MAX_BYTES) {
    Serial.printf("[LoRa] Tamanho inválido: %u\n", static_cast<unsigned>(tamanho));
    registrarErroLoRa();
    iniciarRecepcaoLoRa();
    return;
  }

  uint8_t buffer[LORA_BUFFER_BYTES];
  const int state = radio.readData(buffer, tamanho);

  if (state != RADIOLIB_ERR_NONE) {
    if (state == RADIOLIB_ERR_CRC_MISMATCH) {
      Serial.println("[LoRa] Erro de CRC");
    } else {
      Serial.printf("[LoRa] Erro de leitura: %d\n", state);
    }

    registrarErroLoRa();
    iniciarRecepcaoLoRa();
    return;
  }

  errosLoRaConsecutivos = 0;   // rádio respondendo normalmente
  buffer[tamanho] = '\0';

  Serial.printf(
    "[LoRa RX] %s | RSSI=%.1f dBm | SNR=%.1f dB\n",
    reinterpret_cast<char *>(buffer),
    radio.getRSSI(),
    radio.getSNR()
  );

  const char *mensagem = reinterpret_cast<char *>(buffer);

  if (!processarPacoteSensor(mensagem)) {
    // Mantém compatibilidade com comandos LoRa no formato CMD| (diagnóstico).
    if (processarComando(mensagem)) {
      publicarEstado();
    } else {
      Serial.println("[LoRa] Pacote com formato desconhecido");
    }
  }

  iniciarRecepcaoLoRa();
}

#if LORA_ECHO_DIAGNOSTICO
// Envio opcional de estado por LoRa (diagnóstico de rádio) — ligado apenas com
// -DLORA_ECHO_DIAGNOSTICO=1: o nó único não tem mais quem retransmitir ou
// comandar via LoRa (ADR-0004).
void enviarEstadoLoRa() {
  if (!loraDisponivel) return;

  char payload[80];
  snprintf(
    payload,
    sizeof(payload),
    "EST|MODO:%s|V1:%d|V2:%d|ASP:%d|NEB:%d",
    textoModo(),
    estado.vent1 ? 1 : 0,
    estado.vent2 ? 1 : 0,
    estado.asper ? 1 : 0,
    estado.nebul ? 1 : 0
  );

  const int state = radio.transmit(payload);
  if (state == RADIOLIB_ERR_NONE) {
    Serial.printf("[LoRa TX] %s\n", payload);
  } else {
    Serial.printf("[LoRa TX] Erro: %d\n", state);
  }

  iniciarRecepcaoLoRa();
}
#endif  // LORA_ECHO_DIAGNOSTICO

// ================================ LCD ========================================
// O cache guarda o que já está no visor: o LCD só é reescrito quando o texto
// muda (ou a cada LCD_REDRAW_MS, para ressincronizar caso o visor perca
// estado). Cada caractere é uma transação I²C própria (~300 µs a 100 kHz), e
// reescrever as 2 linhas a cada iteração do loop custava mais que todo o resto
// do loop junto.

char lcdCache[2][LCD_COLS + 1] = {{0}, {0}};

// Valor do sensor pronto para o LCD: "--" quando o campo veio ausente do
// pacote (NaN) — evita exibir "nan" no visor.
void formatarValorLCD(float valor, char *destino, size_t tamanho, uint8_t casas) {
  if (isnan(valor)) {
    snprintf(destino, tamanho, "--");
  } else {
    snprintf(destino, tamanho, "%.*f", casas, valor);
  }
}

// Monta as 2 linhas da página atual do LCD (sem escrever no hardware).
void montarPaginaLCD(char *linha1, char *linha2) {
  if (paginaLCD == 0) {
    if (!sensorOnline()) {
      snprintf(linha1, LCD_COLS + 1, "Sensor: OFFLINE");
      snprintf(linha2, LCD_COLS + 1, "Aguardando LoRa");
      return;
    }

    char textoNH3[8];
    char textoTemperatura[8];
    char textoUmidade[8];

    formatarValorLCD(sensor.nh3, textoNH3, sizeof(textoNH3), 1);
    formatarValorLCD(sensor.temperatura, textoTemperatura, sizeof(textoTemperatura), 0);
    formatarValorLCD(sensor.umidade, textoUmidade, sizeof(textoUmidade), 0);

    snprintf(linha1, LCD_COLS + 1, "NH3:%5s ppm", textoNH3);
    snprintf(
      linha2,
      LCD_COLS + 1,
      "T:%sC U:%s%%",
      textoTemperatura,
      textoUmidade
    );
    return;
  }

  if (paginaLCD == 1) {
    snprintf(
      linha1,
      LCD_COLS + 1,
      "V1:%s%s V2:%s",
      estado.vent1 ? "ON" : "OFF",
      protecaoNH3Ativa ? "*" : "",   // * = V1 ligado pela proteção de NH3
      estado.vent2 ? "ON" : "OFF"
    );
    snprintf(
      linha2,
      LCD_COLS + 1,
      "A:%s N:%s %s",
      estado.asper ? "ON" : "OFF",
      estado.nebul ? "ON" : "OFF",
      modo == MODO_AUTOMATICO ? "AU" : "MA"
    );
    return;
  }

  snprintf(
    linha1,
    LCD_COLS + 1,
    "WiFi:%s",
    WiFi.status() == WL_CONNECTED ? "OK" : "OFF"
  );
  snprintf(
    linha2,
    LCD_COLS + 1,
    "MQTT:%s L:%s",
    mqtt.connected() ? "OK" : "OFF",
    loraDisponivel ? "OK" : "ER"
  );
}

void atualizarLCD() {
  const uint32_t agora = millis();

  if (agora - ultimaTrocaLCD >= LCD_PAGE_MS) {
    ultimaTrocaLCD = agora;
    paginaLCD = (paginaLCD + 1) % LCD_PAGINAS;
  }

  // Avalia o visor 1×/s (LCD_REFRESH_MS) em vez de a cada iteração do loop.
  if (agora - ultimaAvaliacaoLCD < LCD_REFRESH_MS) return;
  ultimaAvaliacaoLCD = agora;

  char linha1[LCD_COLS + 1];
  char linha2[LCD_COLS + 1];
  montarPaginaLCD(linha1, linha2);

  const bool textoMudou = strcmp(linha1, lcdCache[0]) != 0 ||
                          strcmp(linha2, lcdCache[1]) != 0;
  const bool redesenhoForcado = (agora - ultimoRedesenhoLCD) >= LCD_REDRAW_MS;
  if (!textoMudou && !redesenhoForcado) return;

  escreverLinhaLCD(0, linha1);
  escreverLinhaLCD(1, linha2);

  snprintf(lcdCache[0], sizeof(lcdCache[0]), "%s", linha1);
  snprintf(lcdCache[1], sizeof(lcdCache[1]), "%s", linha2);

  if (redesenhoForcado) {
    ultimoRedesenhoLCD = agora;
  }
}

// ================================ SETUP ======================================

void setup() {
  Serial.begin(115200);
  delay(300);   // dá tempo do USB-serial enumerar (não perde os logs do boot)

  Wire.begin(I2C_SDA, I2C_SCL);

  // begin() já escreve 0xFF (todos os relés desligados) e devolve false quando
  // o expansor não responde no endereço esperado.
  if (!relayExp.begin()) {
    Serial.printf(
      "[I2C] PCF8574 (0x%02X) não respondeu — relés não serão acionados\n",
      PCF8574_ADDR
    );
  }
  desligarTodos();

  lcd.init();
  lcd.backlight();
  escreverLinhaLCD(0, "AEREM Gateway");
  escreverLinhaLCD(1, "Inicializando...");

  SPI.begin(18, 19, 23, LORA_NSS);   // SCK, MISO, MOSI, SS
  iniciarLoRa();                     // se falhar, manterLoRa() tenta de novo

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(callbackMQTT);
  mqtt.setBufferSize(MQTT_BUFFER_BYTES);
  mqtt.setKeepAlive(MQTT_KEEPALIVE_S);
  mqtt.setSocketTimeout(MQTT_SOCKET_TIMEOUT_S);   // o padrão de 15 s travava o loop

  iniciarWiFi();

  const uint32_t agora = millis();
  ultimaTrocaLCD = agora;
  ultimaPublicacaoEstado = agora;
  ultimoRedesenhoLCD = agora - LCD_REDRAW_MS;   // 1º atualizarLCD() já desenha
}

// ================================= LOOP ======================================

// Heartbeat de 30 s: publicação do estado dos atuadores + reenvio da última
// leitura do sensor que não pôde ser entregue ao broker.
void publicarPeriodicamente() {
  const uint32_t agora = millis();
  if (agora - ultimaPublicacaoEstado < STATE_PUBLISH_MS) return;

  ultimaPublicacaoEstado = agora;
  publicarEstado();
  publicarSensorPendente();

#if LORA_ECHO_DIAGNOSTICO
  // Eco LoRa de estado só para diagnóstico de rádio (nó único, ADR-0004).
  enviarEstadoLoRa();
#endif
}

void loop() {
  manterWiFi();

  if (WiFi.status() == WL_CONNECTED) {
    conectarMQTT();
  }

  if (mqtt.connected()) {
    mqtt.loop();
  }

  manterLoRa();
  processarRecepcaoLoRa();
  executarProtecaoNH3();   // armado em qualquer modo (proteção de V1)
  atualizarLCD();
  publicarPeriodicamente();

  // 2 ms: cede tempo para as tasks de Wi-Fi/TCP do core e evita busy-loop.
  delay(2);
}
