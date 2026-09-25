/*
 * ESP32 — Nó Atuador (Aviário)
 * Recebe comando via LoRa (SX1276) do Gateway/MQTT
 * Controla 4 relés: Ventilador1, Ventilador2, Aspersor, Nebulizador
 *
 * Fluxo:
 *   Gateway publica em aviario/no1/atuadores/cmd
 *   Payload: JSON { "v1":1, "v2":0, "asp":1, "neb":0 }
 *   Este nó recebe via LoRa e atua nos relés
 *   Publica o estado atual em aviario/no1/atuadores/estado
 *
 * Pinagem LoRa SX1276 (ajuste se necessário):
 *   NSS  → GPIO 5
 *   MOSI → GPIO 23
 *   MISO → GPIO 19
 *   SCK  → GPIO 18
 *   RST  → GPIO 14
 *   DIO0 → GPIO 26
 *
 * Relés (LOW = acionado para módulo de relé ativo-baixo):
 *   Ventilador 1 → GPIO 25
 *   Ventilador 2 → GPIO 33
 *   Aspersor     → GPIO 32
 *   Nebulizador  → GPIO 27
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
#define MQTT_CLIENT  "aviario_atuador_no1"

#define TOPIC_CMD    "aviario/no1/atuadores/cmd"    // assina — recebe comandos
#define TOPIC_ESTADO "aviario/no1/atuadores/estado" // publica — estado atual

// ── Pinos LoRa ────────────────────────────────────────────────────────────────
#define LORA_NSS   5
#define LORA_RST   14
#define LORA_DIO0  26

// ── Pinos Relés ──────────────────────────────────────────────────────────────
// Módulo de relé ativo-baixo: LOW = liga, HIGH = desliga
#define PIN_VENT1  25
#define PIN_VENT2  33
#define PIN_ASPER  32
#define PIN_NEBUL  27

#define RELAY_ON   LOW
#define RELAY_OFF  HIGH

// ── LoRa config (deve ser igual ao ATtiny85 e ao Gateway) ────────────────────
#define LORA_FREQ  915.0
#define LORA_BW    125.0
#define LORA_SF    7
#define LORA_CR    5

// ── Intervalos ───────────────────────────────────────────────────────────────
#define PUBLISH_INTERVAL_MS 10000UL  // publica estado a cada 10 s

// ─────────────────────────────────────────────────────────────────────────────
// Objetos globais
// ─────────────────────────────────────────────────────────────────────────────
SX1276 radio = new Module(LORA_NSS, LORA_DIO0, LORA_RST);

WiFiClient   wifiClient;
PubSubClient mqtt(wifiClient);

// ── Estado dos atuadores ─────────────────────────────────────────────────────
struct AtuadorState {
    bool vent1  = false;
    bool vent2  = false;
    bool asper  = false;
    bool nebul  = false;
} estado;

// ── Controle de tempo ────────────────────────────────────────────────────────
unsigned long lastPublish = 0;

// ─────────────────────────────────────────────────────────────────────────────
// Aplica estado dos relés aos pinos
// ─────────────────────────────────────────────────────────────────────────────
void aplicarEstado() {
    digitalWrite(PIN_VENT1, estado.vent1 ? RELAY_ON : RELAY_OFF);
    digitalWrite(PIN_VENT2, estado.vent2 ? RELAY_ON : RELAY_OFF);
    digitalWrite(PIN_ASPER, estado.asper ? RELAY_ON : RELAY_OFF);
    digitalWrite(PIN_NEBUL, estado.nebul ? RELAY_ON : RELAY_OFF);
}

// ─────────────────────────────────────────────────────────────────────────────
// Publica estado atual no MQTT
// ─────────────────────────────────────────────────────────────────────────────
void publicarEstado() {
    StaticJsonDocument<128> doc;
    doc["v1"]  = estado.vent1 ? 1 : 0;
    doc["v2"]  = estado.vent2 ? 1 : 0;
    doc["asp"] = estado.asper ? 1 : 0;
    doc["neb"] = estado.nebul ? 1 : 0;

    char buf[128];
    serializeJson(doc, buf);
    mqtt.publish(TOPIC_ESTADO, buf, true); // retained = true
}

// ─────────────────────────────────────────────────────────────────────────────
// Callback MQTT — recebe comando do gateway
// Payload esperado: { "v1":1, "v2":0, "asp":1, "neb":0 }
// ─────────────────────────────────────────────────────────────────────────────
void mqttCallback(char *topic, byte *payload, unsigned int length) {
    if (strcmp(topic, TOPIC_CMD) != 0) return;

    StaticJsonDocument<128> doc;
    DeserializationError err = deserializeJson(doc, payload, length);
    if (err) return;

    bool mudou = false;

    if (doc.containsKey("v1"))  { bool v = doc["v1"].as<int>() != 0; if (v != estado.vent1) { estado.vent1 = v; mudou = true; } }
    if (doc.containsKey("v2"))  { bool v = doc["v2"].as<int>() != 0; if (v != estado.vent2) { estado.vent2 = v; mudou = true; } }
    if (doc.containsKey("asp")) { bool v = doc["asp"].as<int>() != 0; if (v != estado.asper) { estado.asper = v; mudou = true; } }
    if (doc.containsKey("neb")) { bool v = doc["neb"].as<int>() != 0; if (v != estado.nebul) { estado.nebul = v; mudou = true; } }

    if (mudou) {
        aplicarEstado();
        publicarEstado();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Conexão WiFi
// ─────────────────────────────────────────────────────────────────────────────
void conectarWiFi() {
    if (WiFi.status() == WL_CONNECTED) return;
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    uint8_t tentativas = 0;
    while (WiFi.status() != WL_CONNECTED && tentativas < 20) {
        delay(500);
        tentativas++;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconexão MQTT
// ─────────────────────────────────────────────────────────────────────────────
void reconectarMQTT() {
    if (mqtt.connected()) return;
    uint8_t tentativas = 0;
    while (!mqtt.connected() && tentativas < 5) {
        if (mqtt.connect(MQTT_CLIENT)) {
            mqtt.subscribe(TOPIC_CMD);
            publicarEstado(); // anuncia estado atual ao reconectar
        }
        tentativas++;
        delay(1000);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Verifica se há pacote LoRa (enviado pelo Gateway com comando)
// O Gateway pode opcionalmente retransmitir o comando via LoRa para
// acionamento mesmo sem WiFi.
// ─────────────────────────────────────────────────────────────────────────────
void verificarLoRa() {
    uint8_t buf[64];
    size_t  len = sizeof(buf);

    int state = radio.receive(buf, len);
    if (state != RADIOLIB_ERR_NONE) return;

    buf[len] = '\0';

    StaticJsonDocument<128> doc;
    DeserializationError err = deserializeJson(doc, (char *)buf);
    if (err) return;

    bool mudou = false;
    if (doc.containsKey("v1"))  { bool v = doc["v1"].as<int>() != 0; if (v != estado.vent1) { estado.vent1 = v; mudou = true; } }
    if (doc.containsKey("v2"))  { bool v = doc["v2"].as<int>() != 0; if (v != estado.vent2) { estado.vent2 = v; mudou = true; } }
    if (doc.containsKey("asp")) { bool v = doc["asp"].as<int>() != 0; if (v != estado.asper) { estado.asper = v; mudou = true; } }
    if (doc.containsKey("neb")) { bool v = doc["neb"].as<int>() != 0; if (v != estado.nebul) { estado.nebul = v; mudou = true; } }

    if (mudou) {
        aplicarEstado();
        publicarEstado();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// setup
// ─────────────────────────────────────────────────────────────────────────────
void setup() {
    Serial.begin(115200);

    // ── Relés — inicializa desligados ─────────────────────────────────────
    pinMode(PIN_VENT1, OUTPUT); digitalWrite(PIN_VENT1, RELAY_OFF);
    pinMode(PIN_VENT2, OUTPUT); digitalWrite(PIN_VENT2, RELAY_OFF);
    pinMode(PIN_ASPER, OUTPUT); digitalWrite(PIN_ASPER, RELAY_OFF);
    pinMode(PIN_NEBUL, OUTPUT); digitalWrite(PIN_NEBUL, RELAY_OFF);

    // ── WiFi ─────────────────────────────────────────────────────────────
    conectarWiFi();

    // ── MQTT ─────────────────────────────────────────────────────────────
    mqtt.setServer(MQTT_BROKER, MQTT_PORT);
    mqtt.setCallback(mqttCallback);
    reconectarMQTT();

    // ── LoRa ─────────────────────────────────────────────────────────────
    int state = radio.begin(LORA_FREQ, LORA_BW, LORA_SF, LORA_CR);
    if (state == RADIOLIB_ERR_NONE) {
        radio.startReceive(); // modo escuta contínua
        Serial.println("[LoRa] OK");
    } else {
        Serial.printf("[LoRa] Erro: %d\n", state);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// loop
// ─────────────────────────────────────────────────────────────────────────────
void loop() {
    // Reconexões
    if (WiFi.status() != WL_CONNECTED) conectarWiFi();
    if (!mqtt.connected()) reconectarMQTT();

    mqtt.loop();

    // Verifica pacote LoRa (fallback sem WiFi)
    verificarLoRa();

    // Publica estado periodicamente (heartbeat)
    unsigned long agora = millis();
    if (agora - lastPublish >= PUBLISH_INTERVAL_MS) {
        lastPublish = agora;
        if (mqtt.connected()) publicarEstado();
    }
}
