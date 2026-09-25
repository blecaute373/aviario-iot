#!/bin/bash
# =============================================================================
# setup_servidor.sh
# Instala e configura: InfluxDB 2.x, Telegraf, Grafana
# Sistema: Ubuntu 22.04 / Debian 12
# =============================================================================

set -e  # para na primeira linha com erro

# ── Variáveis — edite antes de rodar ─────────────────────────────────────────
INFLUX_USER="admin"
INFLUX_PASS="SuaSenhaForte123"   # mínimo 8 caracteres
INFLUX_ORG="aviario"
INFLUX_BUCKET="aviario"
INFLUX_RETENTION="365d"          # quanto tempo guardar os dados

GRAFANA_ADMIN_PASS="GrafanaSenha123"

MQTT_BROKER_IP="192.168.0.3"     # IP do broker Mosquitto (gateway local)

# =============================================================================
# 1. DEPENDÊNCIAS
# =============================================================================
echo ">>> Atualizando sistema..."
apt-get update -qq
apt-get install -y curl wget gnupg apt-transport-https software-properties-common

# =============================================================================
# 2. INFLUXDB 2.x
# =============================================================================
echo ">>> Instalando InfluxDB 2.x..."
wget -q https://repos.influxdata.com/influxdata-archive_compat.key
gpg --dearmor < influxdata-archive_compat.key > /etc/apt/trusted.gpg.d/influxdata-archive_compat.gpg
echo "deb [signed-by=/etc/apt/trusted.gpg.d/influxdata-archive_compat.gpg] https://repos.influxdata.com/debian stable main" \
  > /etc/apt/sources.list.d/influxdata.list

apt-get update -qq
apt-get install -y influxdb2 influxdb2-cli

systemctl enable influxdb
systemctl start influxdb

sleep 3  # aguarda o serviço subir

echo ">>> Configurando InfluxDB..."
influx setup \
  --username  "$INFLUX_USER" \
  --password  "$INFLUX_PASS" \
  --org       "$INFLUX_ORG" \
  --bucket    "$INFLUX_BUCKET" \
  --retention "$INFLUX_RETENTION" \
  --force

# Captura o token gerado
INFLUX_TOKEN=$(influx auth list --json | python3 -c \
  "import sys,json; auths=json.load(sys.stdin); print(auths[0]['token'])")

echo ""
echo ">>> TOKEN INFLUXDB (salve em local seguro):"
echo "$INFLUX_TOKEN"
echo ""

# =============================================================================
# 3. TELEGRAF
# =============================================================================
echo ">>> Instalando Telegraf..."
apt-get install -y telegraf

# Usa o telegraf.conf do projeto (copie para o servidor primeiro)
# ou gera um mínimo inline:
cat > /etc/telegraf/telegraf.d/aviario.conf << EOF
[agent]
  interval       = "10s"
  flush_interval = "10s"
  hostname       = "aviario-server"

[[outputs.influxdb_v2]]
  urls         = ["http://localhost:8086"]
  token        = "${INFLUX_TOKEN}"
  organization = "${INFLUX_ORG}"
  bucket       = "${INFLUX_BUCKET}"

[[inputs.mqtt_consumer]]
  servers     = ["tcp://${MQTT_BROKER_IP}:1883"]
  topics      = ["aviario/no1/sensores"]
  qos         = 0
  data_format = "json"
  name_override = "sensores"
  [inputs.mqtt_consumer.tags]
    no    = "1"
    local = "galpao"

[[inputs.mqtt_consumer]]
  servers     = ["tcp://${MQTT_BROKER_IP}:1883"]
  topics      = ["aviario/no1/atuadores/estado"]
  qos         = 0
  data_format = "json"
  name_override = "atuadores"
  [inputs.mqtt_consumer.tags]
    no    = "1"
    local = "galpao"
EOF

systemctl enable telegraf
systemctl restart telegraf

# =============================================================================
# 4. GRAFANA
# =============================================================================
echo ">>> Instalando Grafana..."
wget -q -O /etc/apt/keyrings/grafana.gpg \
  https://apt.grafana.com/gpg.key
echo "deb [signed-by=/etc/apt/keyrings/grafana.gpg] https://apt.grafana.com stable main" \
  > /etc/apt/sources.list.d/grafana.list

apt-get update -qq
apt-get install -y grafana

systemctl enable grafana-server
systemctl start grafana-server

sleep 3

# Configura senha do admin via API
curl -s -X PUT \
  -H "Content-Type: application/json" \
  -d "{\"password\":\"${GRAFANA_ADMIN_PASS}\"}" \
  http://admin:admin@localhost:3000/api/user/password > /dev/null

# Adiciona datasource InfluxDB no Grafana via API
curl -s -X POST \
  -H "Content-Type: application/json" \
  -u "admin:${GRAFANA_ADMIN_PASS}" \
  http://localhost:3000/api/datasources \
  -d "{
    \"name\":      \"InfluxDB-Aviario\",
    \"type\":      \"influxdb\",
    \"url\":       \"http://localhost:8086\",
    \"access\":    \"proxy\",
    \"jsonData\": {
      \"version\":      \"Flux\",
      \"organization\":  \"${INFLUX_ORG}\",
      \"defaultBucket\": \"${INFLUX_BUCKET}\",
      \"tlsSkipVerify\": true
    },
    \"secureJsonData\": {
      \"token\": \"${INFLUX_TOKEN}\"
    }
  }" > /dev/null

echo ""
echo "============================================================"
echo "  INSTALAÇÃO CONCLUÍDA"
echo "============================================================"
echo "  InfluxDB  → http://SEU_IP:8086"
echo "             usuário: ${INFLUX_USER}"
echo "             senha:   ${INFLUX_PASS}"
echo ""
echo "  Grafana   → http://SEU_IP:3000"
echo "             usuário: admin"
echo "             senha:   ${GRAFANA_ADMIN_PASS}"
echo ""
echo "  Token InfluxDB salvo em: /etc/telegraf/telegraf.d/aviario.conf"
echo "============================================================"
echo ""
echo "  Próximo passo: importe o dashboard"
echo "  Grafana → Dashboards → Import → cole o JSON do arquivo"
echo "  aviario_dashboard.json"
echo "============================================================"
