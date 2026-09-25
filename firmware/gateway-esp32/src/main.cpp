/*
 * ESP32 — Gateway (Aviário)
 *
 * Recebe pacotes LoRa de:
 *   - ATtiny85 (nó sensor)  → payload pipe-delimited: T:25.5|U:60|P:101325|A:12.3
 *   - ESP32 atuador         → payload JSON: {"v1":1,"v2":0,"asp":1,"neb":0}
 *
 * Publica no MQTT:
 *   aviario/no1/sensores    → JSON com os dados do ATtiny85
 *   aviario/no1/atuadores/estado → repassa o estado recebido do nó atuador
 *
 * Assina no MQTT:
 *   aviario/no1/atuadores/cmd → repassa o comando via LoRa para o nó atuador
 *
 * Pinagem LoRa SX1276:
 *   NSS  → GPIO 5
 *   MOSI → GPIO 23
 *   MISO → GPIO 19
 *   SCK  → GPIO 18
 *   RST  → GPIO 14
 *   DIO0 → GPIO 26
 *
 * Plataforma : ESP32 Arduino (espressif32)
 * Bibliotecas: RadioLib, PubSubClient, ArduinoJson
 */

#include <Arduino.h>
#include <SPI.h>
#include <WiFi.h>
#include <RadioLib.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// ── Configuração local (WiFi + broker) ───────────────────────────────────────
// Copie "config.h.example" para "config.h" (mesma pasta) e edite com os
// dados reais da sua rede. O config.h NÃO é versionado (ver .gitignore).
#include "config.h"

// ── MQTT ─────────────────────────────────────────────────────────────────────
#define MQTT_PORT    1883
#define MQTT_CLIENT  "aviario_gateway"

// Tópicos publicados (gateway → broker)
#define TOPIC_SENSORES      "aviario/no1/sensores"
#define TOPIC_ATUS_ESTADO   "aviario/no1/atuadores/estado"

// Tópicos assinados (broker → gateway → LoRa)
#define TOPIC_ATUS_CMD      "aviario/no1/atuadores/cmd"

// ── Pinos LoRa ────────────────────────────────────────────────────────────────
#define LORA_NSS   5
#define LORA_RST   14
#define LORA_DIO0  26

// ── LoRa config ──────────────────────────────────────────────────────────────
#define LORA_FREQ  915.0
#define LORA_BW    125.0
#define LORA_SF    7
#define LORA_CR    5
#define LORA_POWER 14

// ── Prefixos para identificar origem do pacote LoRa ──────────────────────────
// Sensor envia   "T:xx.x|U:xx|..."   → começa com 'T'
// Atuador envia  "{...}"             → começa com '{'
#define PREFIXO_SENSOR  'T'
#define PREFIXO_ATUADOR '{'

// ─────────────────────────────────────────────────────────────────────────────
// Objetos globais
// ─────────────────────────────────────────────────────────────────────────────
SX1276 radio = new Module(LORA_NSS, LORA_DIO0, LORA_RST);

WiFiClient   wifiClient;
PubSubClient mqtt(wifiClient);

// Flag para reenvio LoRa de comando recebido do MQTT
volatile bool  temCmdLoRa   = false;
char           bufCmdLoRa[128];

// ─────────────────────────────────────────────────────────────────────────────
// Parseia payload pipe-delimited do ATtiny85
// Formato: T:25.5|U:60|P:101325|A:12.3
// Retorna true se pelo menos T foi encontrado
// ─────────────────────────────────────────────────────────────────────────────
bool parseSensor(const char *payload, float &temp, uint8_t &hum, uint32_t &pres, float &nh3) {
    bool ok = false;
    char buf[64];
    strncpy(buf, payload, sizeof(buf) - 1);
    buf[sizeof(buf) - 1] = '\0';

    char *token = strtok(buf, "|");
    while (token != nullptr) {
        if (strncmp(token, "T:", 2) == 0) { temp = atof(token + 2); ok = true; }
        if (strncmp(token, "U:", 2) == 0) { hum  = (uint8_t)atoi(token + 2); }
        if (strncmp(token, "P:", 2) == 0) { pres = (uint32_t)atol(token + 2); }
        if (strncmp(token, "A:", 2) == 0) { nh3  = atof(token + 2); }
        token = strtok(nullptr, "|");
    }
    return ok;
}

// ─────────────────────────────────────────────────────────────────────────────
// Processa pacote do ATtiny85 → publica JSON em aviario/no1/sensores
// ─────────────────────────────────────────────────────────────────────────────
void processarSensor(const char *raw, int rssi, float snr) {
    float    temp = 0.0f;
    uint8_t  hum  = 0;
    uint32_t pres = 0;
    float    nh3  = 0.0f;

    if (!parseSensor(raw, temp, hum, pres, nh3)) {
        Serial.println("[Sensor] Payload inválido");
        return;
    }

    StaticJsonDocument<192> doc;
    doc["temperatura"] = serialized(String(temp, 1));
    doc["umidade"]     = hum;
    doc["pressao_pa"]  = pres;
    doc["nh3_ppm"]     = serialized(String(nh3, 1));
    doc["rssi"]        = rssi;
    doc["snr"]         = serialized(String(snr, 1));

    char out[192];
    serializeJson(doc, out);
    mqtt.publish(TOPIC_SENSORES, out);

    Serial.printf("[Sensor→MQTT] %s\n", out);
}

// ─────────────────────────────────────────────────────────────────────────────
// Processa pacote do ESP32 atuador → repassa estado ao MQTT
// ─────────────────────────────────────────────────────────────────────────────
void processarAtuador(const char *raw) {
    // Valida JSON antes de repassar
    StaticJsonDocument<128> doc;
    DeserializationError err = deserializeJson(doc, raw);
    if (err) {
        Serial.println("[Atuador] JSON inválido");
        return;
    }

    mqtt.publish(TOPIC_ATUS_ESTADO, raw, true); // retained
    Serial.printf("[Atuador→MQTT] %s\n", raw);
}

// ─────────────────────────────────────────────────────────────────────────────
// Callback MQTT — recebe comando e agenda retransmissão via LoRa
// ─────────────────────────────────────────────────────────────────────────────
void mqttCallback(char *topic, byte *payload, unsigned int length) {
    if (strcmp(topic, TOPIC_ATUS_CMD) != 0) return;
    if (length >= sizeof(bufCmdLoRa)) return;

    memcpy(bufCmdLoRa, payload, length);
    bufCmdLoRa[length] = '\0';
    temCmdLoRa = true;

    Serial.printf("[MQTT→LoRa] cmd recebido: %s\n", bufCmdLoRa);
}

// ─────────────────────────────────────────────────────────────────────────────
// Envia comando via LoRa para o ESP32 atuador
// ─────────────────────────────────────────────────────────────────────────────
void enviarCmdLoRa(const char *cmd) {
    // Para de escutar para transmitir
    radio.standby();
    int state = radio.transmit((uint8_t *)cmd, strlen(cmd));
    if (state == RADIOLIB_ERR_NONE) {
        Serial.println("[LoRa TX] Comando enviado");
    } else {
        Serial.printf("[LoRa TX] Erro: %d\n", state);
    }
    // Volta a escutar
    radio.startReceive();
}

// ─────────────────────────────────────────────────────────────────────────────
// Conexão WiFi
// ─────────────────────────────────────────────────────────────────────────────
void conectarWiFi() {
    if (WiFi.status() == WL_CONNECTED) return;
    Serial.printf("[WiFi] Conectando a %s...\n", WIFI_SSID);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    uint8_t t = 0;
    while (WiFi.status() != WL_CONNECTED && t < 30) {
        delay(500);
        t++;
    }
    if (WiFi.status() == WL_CONNECTED) {
        Serial.printf("[WiFi] Conectado: %s\n", WiFi.localIP().toString().c_str());
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconexão MQTT
// ─────────────────────────────────────────────────────────────────────────────
void reconectarMQTT() {
    if (mqtt.connected()) return;
    uint8_t t = 0;
    while (!mqtt.connected() && t < 5) {
        Serial.println("[MQTT] Conectando...");
        if (mqtt.connect(MQTT_CLIENT)) {
            mqtt.subscribe(TOPIC_ATUS_CMD);
            Serial.println("[MQTT] Conectado");
        }
        t++;
        delay(1000);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Processa pacote LoRa recebido (não-bloqueante)
// ─────────────────────────────────────────────────────────────────────────────
void verificarLoRa() {
    uint8_t buf[128];
    size_t  len = sizeof(buf) - 1;

    int state = radio.receive(buf, len);
    if (state != RADIOLIB_ERR_NONE) return;

    buf[len] = '\0';
    int    rssi = radio.getRSSI();
    float  snr  = radio.getSNR();

    Serial.printf("[LoRa RX] RSSI:%d SNR:%.1f  %s\n", rssi, snr, (char *)buf);

    if (!mqtt.connected()) return;

    // Identifica origem pelo primeiro caractere
    if (buf[0] == PREFIXO_SENSOR) {
        processarSensor((char *)buf, rssi, snr);
    } else if (buf[0] == PREFIXO_ATUADOR) {
        processarAtuador((char *)buf);
    } else {
        Serial.println("[LoRa] Origem desconhecida — descartado");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// setup
// ─────────────────────────────────────────────────────────────────────────────
void setup() {
    Serial.begin(115200);

    conectarWiFi();

    mqtt.setServer(MQTT_BROKER, MQTT_PORT);
    mqtt.setCallback(mqttCallback);
    reconectarMQTT();

    int state = radio.begin(LORA_FREQ, LORA_BW, LORA_SF, LORA_CR,
                            RADIOLIB_SX127X_SYNC_WORD, LORA_POWER);
    if (state == RADIOLIB_ERR_NONE) {
        radio.startReceive();
        Serial.println("[LoRa] Gateway pronto, escutando...");
    } else {
        Serial.printf("[LoRa] Erro init: %d\n", state);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// loop
// ─────────────────────────────────────────────────────────────────────────────
void loop() {
    if (WiFi.status() != WL_CONNECTED) conectarWiFi();
    if (!mqtt.connected()) reconectarMQTT();

    mqtt.loop();

    // Pacote LoRa recebido?
    verificarLoRa();

    // Há comando MQTT a retransmitir via LoRa?
    if (temCmdLoRa) {
        temCmdLoRa = false;
        enviarCmdLoRa(bufCmdLoRa);
    }
}
