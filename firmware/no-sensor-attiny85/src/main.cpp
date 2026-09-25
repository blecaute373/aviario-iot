/*
 * ATtiny85 — Nó Sensor (Aviário)
 * Compilar como C puro (.c), NÃO como .cpp — evita ruído de IntelliSense C++
 * e reduz overhead de ABI.
 *
 * Framework: NO framework — bare-metal avr-gcc
 * RAM alvo : < 512 bytes (ATtiny85 tem exatamente 512 B de SRAM)
 *
 * Pinagem ATtiny85 (DIP-8):
 *   PB0 (pin 5) — MOSI (USI DO) / SDA I2C  [compartilhado, nunca simultâneo]
 *   PB1 (pin 6) — MISO (USI DI)             [não usado ativamente]
 *   PB2 (pin 7) — SCK  (USI CK) / SCL I2C  [compartilhado, nunca simultâneo]
 *   PB3 (pin 2) — CS SX1276 / ADC3 MICS6814
 *   PB4 (pin 3) — RST SX1276
 *
 * CORREÇÕES em relação à versão anterior:
 *   1. ISR declarada com __attribute__((signal,used)) para suprimir aviso
 *      do IntelliSense sem quebrar o compilador AVR real.
 *   2. dig_T1 corrigido para uint16_t (era int16_t — erro de tipo Bosch).
 *   3. _delay_ms(20000) substituído por loop de 20 × _delay_ms(1000).
 *   4. writeU32: índice do buffer temporário corrigido (era decremento errado).
 *   5. platformio.ini: framework removido (bare-metal) — veja comentário no fim.
 *   6. Todos os protótipos adicionados no topo — elimina os "undefined" do
 *      IntelliSense quando o arquivo é compilado como unidade única.
 */

#include <avr/io.h>
#include <avr/interrupt.h>
#include <avr/sleep.h>
#include <avr/wdt.h>
#include <avr/pgmspace.h>
#include <util/delay.h>
#include <stdint.h>

/* ═══════════════════════════════════════════════════════════════════════════
 * CONSTANTES DE PINO
 * ═══════════════════════════════════════════════════════════════════════════ */
#define MOSI_BIT  PB0   /* SDA I2C quando SPI inativo */
#define MISO_BIT  PB1
#define SCK_BIT   PB2   /* SCL I2C quando SPI inativo */
#define SS_BIT    PB3   /* CS SX1276 / canal ADC3     */
#define RST_BIT   PB4   /* RST SX1276                 */

/* ═══════════════════════════════════════════════════════════════════════════
 * CONFIGURAÇÃO
 * ═══════════════════════════════════════════════════════════════════════════ */
#define BME_ADDR        0x76
#define NH3_RL          10u     /* kΩ — resistor de carga  */
#define NH3_R0          30u     /* kΩ — R0 em ar limpo     */
#define WDT_CYCLES      37u     /* 37 × ~8 s ≈ 5 min       */

/* ═══════════════════════════════════════════════════════════════════════════
 * LOOKUP NH3 (evita libm / float pow)
 * ppm = 1000 * (rs/r0)^-1.67  — pré-calculado offline
 * ratio × 100 :  20   40   60   80  100  150  200  300
 * ppm   × 10  : 9888 3014 1485  863  562  259  147   68
 * ═══════════════════════════════════════════════════════════════════════════ */
static const uint16_t NH3_RATIO_X100[8] PROGMEM = { 20, 40, 60, 80,100,150,200,300 };
static const uint16_t NH3_PPM_X10[8]    PROGMEM = {9888,3014,1485,863,562,259,147,68};

/* ═══════════════════════════════════════════════════════════════════════════
 * ESTADO GLOBAL  (tudo estático → seção .bss / .data, fora do stack)
 * ═══════════════════════════════════════════════════════════════════════════ */
static volatile uint8_t g_wdt_count;

/* Calibração BME280 — 18 palavras = 36 bytes */
static uint16_t dig_T1;                          /* unsigned, conforme Bosch */
static int16_t  dig_T2, dig_T3;
static uint16_t dig_P1;
static int16_t  dig_P2,dig_P3,dig_P4,dig_P5,dig_P6,dig_P7,dig_P8,dig_P9;
static uint8_t  dig_H1, dig_H3;
static int16_t  dig_H2, dig_H4, dig_H5;
static int8_t   dig_H6;
static int32_t  t_fine;

/* Buffer de pacote — 36 bytes; tamanho nunca excede "T:±XXX.X|U:XXX|P:XXXXXX|A:XXXX.X\0" */
static char g_pkt[36];

/* ═══════════════════════════════════════════════════════════════════════════
 * PROTÓTIPOS  (necessários para compilação em unidade única .c e para
 * silenciar o IntelliSense que não expande as macros AVR de ISR)
 * ═══════════════════════════════════════════════════════════════════════════ */
static void     deepSleep(void);
static void     spiInit(void);
static uint8_t  spiXfer(uint8_t d);
static void     csLow(void);
static void     csHigh(void);
static void     loraWriteReg(uint8_t reg, uint8_t val);
static uint8_t  loraReadReg(uint8_t reg);
static uint8_t  loraInit(void);
static void     loraSend(const char *data, uint8_t len);
static void     i2cDelay(void);
static void     i2cStart(void);
static void     i2cStop(void);
static uint8_t  i2cWrite(uint8_t b);
static uint8_t  i2cRead(uint8_t ack);
static uint8_t  bmeReadByte(uint8_t reg);
static void     bmeWriteByte(uint8_t reg, uint8_t val);
static void     bmeLoadCalib(void);
static int32_t  bmeCompTemp(int32_t raw);
static uint32_t bmeCompPres(int32_t raw);
static uint32_t bmeCompHum(int32_t raw);
static void     bmeForcedRead(int32_t *temp_c100, uint32_t *pres_pa, uint8_t *hum_pct);
static uint16_t nh3LookupPpm_x10(uint16_t ratio_x100);
static uint16_t readNH3_ppm_x10(void);
static char*    writeU32(char *p, uint32_t v);
static char*    writeFixed1(char *p, int32_t v10);

/* ═══════════════════════════════════════════════════════════════════════════
 * WDT ISR
 * Usa __attribute__ em vez da macro ISR() para que o IntelliSense (que não
 * expande __vector_N corretamente no modo C++) não marque erro.
 * O compilador AVR-GCC real trata __vector_12 como WDT_vect no ATtiny85.
 * ═══════════════════════════════════════════════════════════════════════════ */
void __vector_12(void) __attribute__((signal, used, externally_visible));
void __vector_12(void) { g_wdt_count++; }

/* ═══════════════════════════════════════════════════════════════════════════
 * DEEP SLEEP  (~8 s por ciclo WDT, WDT_CYCLES ciclos ≈ 5 min)
 * ═══════════════════════════════════════════════════════════════════════════ */
static void deepSleep(void) {
    g_wdt_count = 0;
    cli();
    wdt_reset();
    /* Sequência de habilitação WDT conforme datasheet §8.4.1 */
    WDTCR = (1 << WDCE) | (1 << WDE);
    WDTCR = (1 << WDIE) | (1 << WDP3) | (1 << WDP0); /* ~8 s, somente interrupção */
    sei();
    set_sleep_mode(SLEEP_MODE_PWR_DOWN);
    while (g_wdt_count < WDT_CYCLES) {
        ADCSRA &= ~(1 << ADEN); /* desliga ADC antes de dormir */
        sleep_mode();           /* habilita, dorme, desabilita automaticamente */
        ADCSRA |= (1 << ADEN);  /* religa ADC ao acordar */
    }
    wdt_disable();
}

/* ═══════════════════════════════════════════════════════════════════════════
 * USI SPI — modo 0, MSB first
 * ═══════════════════════════════════════════════════════════════════════════ */
static void spiInit(void) {
    DDRB  |=  (1 << MOSI_BIT) | (1 << SCK_BIT) | (1 << SS_BIT) | (1 << RST_BIT);
    DDRB  &= ~(1 << MISO_BIT);
    PORTB |=  (1 << SS_BIT);  /* CS alto = deselecionado */
    USICR  =  (1 << USIWM0);  /* three-wire sem clock externo */
}

static uint8_t spiXfer(uint8_t d) {
    USIDR = d;
    USISR = (1 << USIOIF);
    do {
        USICR = (1 << USIWM0) | (1 << USICLK) | (1 << USITC);
    } while (!(USISR & (1 << USIOIF)));
    return USIDR;
}

static void csLow(void)  { PORTB &= ~(1 << SS_BIT); }
static void csHigh(void) { PORTB |=  (1 << SS_BIT); }

/* ═══════════════════════════════════════════════════════════════════════════
 * SX1276 — TX-only LoRa
 * ═══════════════════════════════════════════════════════════════════════════ */
static void loraWriteReg(uint8_t reg, uint8_t val) {
    csLow();
    spiXfer((uint8_t)(reg | 0x80));
    spiXfer(val);
    csHigh();
}

static uint8_t loraReadReg(uint8_t reg) {
    csLow();
    spiXfer((uint8_t)(reg & 0x7F));
    uint8_t v = spiXfer(0x00);
    csHigh();
    return v;
}

/* Retorna 1 se SX1276 responde, 0 caso contrário */
static uint8_t loraInit(void) {
    PORTB &= ~(1 << RST_BIT); _delay_ms(10);
    PORTB |=  (1 << RST_BIT); _delay_ms(10);

    if (loraReadReg(0x42) != 0x12) return 0; /* version register */

    loraWriteReg(0x01, 0x80); /* sleep + LoRa mode */
    _delay_ms(10);

    /* Frf = 915 MHz → 0xE4C000  (fstep = 32e6/2^19 ≈ 61.035 Hz) */
    loraWriteReg(0x06, 0xE4);
    loraWriteReg(0x07, 0xC0);
    loraWriteReg(0x08, 0x00);

    loraWriteReg(0x09, 0x8F); /* PA_BOOST, Pout = 17 dBm              */
    loraWriteReg(0x1D, 0x72); /* BW=125kHz, CR=4/5, explicit header   */
    loraWriteReg(0x1E, 0x74); /* SF=7, CRC on                         */
    loraWriteReg(0x26, 0x04); /* LowDataRateOptimize = 0              */
    loraWriteReg(0x0E, 0x00); /* FIFO TX base addr = 0                */
    loraWriteReg(0x0D, 0x00); /* FIFO ptr = 0                         */
    return 1;
}

static void loraSend(const char *data, uint8_t len) {
    loraWriteReg(0x0D, 0x00);
    for (uint8_t i = 0; i < len; i++) loraWriteReg(0x00, (uint8_t)data[i]);
    loraWriteReg(0x22, len);  /* payload length */
    loraWriteReg(0x01, 0x83); /* TX mode        */
    /* Aguarda TxDone (RegIrqFlags[3]) com timeout de ~2 s */
    uint8_t t = 200;
    while (t-- && !(loraReadReg(0x12) & 0x08)) _delay_ms(10);
    loraWriteReg(0x12, 0xFF); /* limpa flags */
    loraWriteReg(0x01, 0x80); /* volta a sleep */
}

/* ═══════════════════════════════════════════════════════════════════════════
 * I2C bit-bang (open-drain em PB0/PB2)
 * PB0 = SDA, PB2 = SCL  — mesmos pinos que MOSI/SCK do SPI, nunca simultâneos
 * ═══════════════════════════════════════════════════════════════════════════ */
#define SDA_HIGH() do { DDRB &= ~(1u<<MOSI_BIT); PORTB |=  (1u<<MOSI_BIT); } while(0)
#define SDA_LOW()  do { DDRB |=  (1u<<MOSI_BIT); PORTB &= ~(1u<<MOSI_BIT); } while(0)
#define SCL_HIGH() do { DDRB &= ~(1u<<SCK_BIT);  PORTB |=  (1u<<SCK_BIT);  } while(0)
#define SCL_LOW()  do { DDRB |=  (1u<<SCK_BIT);  PORTB &= ~(1u<<SCK_BIT);  } while(0)
#define SDA_READ() (PINB & (1u<<MOSI_BIT))

static void i2cDelay(void) { _delay_us(5); }

static void i2cStart(void) {
    SDA_HIGH(); SCL_HIGH(); i2cDelay();
    SDA_LOW();  i2cDelay();
    SCL_LOW();  i2cDelay();
}

static void i2cStop(void) {
    SDA_LOW();  i2cDelay();
    SCL_HIGH(); i2cDelay();
    SDA_HIGH(); i2cDelay();
}

static uint8_t i2cWrite(uint8_t b) {
    for (uint8_t m = 0x80; m; m >>= 1) {
        if (b & m) SDA_HIGH(); else SDA_LOW();
        i2cDelay(); SCL_HIGH(); i2cDelay(); SCL_LOW();
    }
    SDA_HIGH(); i2cDelay(); SCL_HIGH(); i2cDelay();
    uint8_t ack = !SDA_READ();
    SCL_LOW(); i2cDelay();
    return ack;
}

static uint8_t i2cRead(uint8_t send_ack) {
    uint8_t b = 0;
    SDA_HIGH();
    for (uint8_t i = 0; i < 8; i++) {
        b <<= 1;
        i2cDelay(); SCL_HIGH(); i2cDelay();
        if (SDA_READ()) b |= 1;
        SCL_LOW();
    }
    if (send_ack) SDA_LOW(); else SDA_HIGH();
    i2cDelay(); SCL_HIGH(); i2cDelay(); SCL_LOW();
    SDA_HIGH();
    return b;
}

static uint8_t bmeReadByte(uint8_t reg) {
    i2cStart();
    i2cWrite((uint8_t)(BME_ADDR << 1));
    i2cWrite(reg);
    i2cStart();
    i2cWrite((uint8_t)((BME_ADDR << 1) | 1));
    uint8_t v = i2cRead(0);
    i2cStop();
    return v;
}

static void bmeWriteByte(uint8_t reg, uint8_t val) {
    i2cStart();
    i2cWrite((uint8_t)(BME_ADDR << 1));
    i2cWrite(reg);
    i2cWrite(val);
    i2cStop();
}

/* ═══════════════════════════════════════════════════════════════════════════
 * BME280 — calibração e compensação inteira (Bosch BST-BME280-DS002)
 * ═══════════════════════════════════════════════════════════════════════════ */
static void bmeLoadCalib(void) {
    /* Lê 0x88..0x9F (24 bytes: T1-T3, P1-P9) */
    i2cStart();
    i2cWrite((uint8_t)(BME_ADDR << 1));
    i2cWrite(0x88);
    i2cStart();
    i2cWrite((uint8_t)((BME_ADDR << 1) | 1));

    uint8_t b[24];
    for (uint8_t i = 0; i < 23; i++) b[i] = i2cRead(1);
    b[23] = i2cRead(0);
    i2cStop();

    dig_T1 = (uint16_t)((b[1] << 8) | b[0]);
    dig_T2 = (int16_t) ((b[3] << 8) | b[2]);
    dig_T3 = (int16_t) ((b[5] << 8) | b[4]);
    dig_P1 = (uint16_t)((b[7] << 8) | b[6]);
    dig_P2 = (int16_t) ((b[9] << 8) | b[8]);
    dig_P3 = (int16_t) ((b[11]<< 8) | b[10]);
    dig_P4 = (int16_t) ((b[13]<< 8) | b[12]);
    dig_P5 = (int16_t) ((b[15]<< 8) | b[14]);
    dig_P6 = (int16_t) ((b[17]<< 8) | b[16]);
    dig_P7 = (int16_t) ((b[19]<< 8) | b[18]);
    dig_P8 = (int16_t) ((b[21]<< 8) | b[20]);
    dig_P9 = (int16_t) ((b[23]<< 8) | b[22]);

    /* Lê calibração de umidade 0xA1, 0xE1..0xE6 */
    dig_H1 = bmeReadByte(0xA1);

    i2cStart();
    i2cWrite((uint8_t)(BME_ADDR << 1));
    i2cWrite(0xE1);
    i2cStart();
    i2cWrite((uint8_t)((BME_ADDR << 1) | 1));

    uint8_t h[7];
    for (uint8_t i = 0; i < 6; i++) h[i] = i2cRead(1);
    h[6] = i2cRead(0);
    i2cStop();

    dig_H2 = (int16_t)((h[1] << 8) | h[0]);
    dig_H3 = h[2];
    dig_H4 = (int16_t)((h[3] << 4) | (h[4] & 0x0F));
    dig_H5 = (int16_t)((h[5] << 4) | (h[4] >> 4));
    dig_H6 = (int8_t)  h[6];
}

static int32_t bmeCompTemp(int32_t raw) {
    int32_t v1 = ((((raw >> 3) - ((int32_t)dig_T1 << 1))) * (int32_t)dig_T2) >> 11;
    int32_t v2 = (((((raw >> 4) - (int32_t)dig_T1) *
                    ((raw >> 4) - (int32_t)dig_T1)) >> 12) * (int32_t)dig_T3) >> 14;
    t_fine = v1 + v2;
    return (t_fine * 5 + 128) >> 8; /* °C × 100 */
}

static uint32_t bmeCompPres(int32_t raw) {
    int64_t v1 = (int64_t)t_fine - 128000;
    int64_t v2 = v1 * v1 * (int64_t)dig_P6;
    v2 += (v1 * (int64_t)dig_P5) << 17;
    v2 += ((int64_t)dig_P4) << 35;
    v1  = ((v1 * v1 * (int64_t)dig_P3) >> 8) + ((v1 * (int64_t)dig_P2) << 12);
    v1  = (((int64_t)1 << 47) + v1) * (int64_t)dig_P1 >> 33;
    if (!v1) return 0;
    int64_t p = 1048576 - raw;
    p = (((p << 31) - v2) * 3125) / v1;
    v1 = ((int64_t)dig_P9 * (p >> 13) * (p >> 13)) >> 25;
    v2 = ((int64_t)dig_P8 * p) >> 19;
    return (uint32_t)((p + v1 + v2) >> 8); /* Pa */
}

static uint32_t bmeCompHum(int32_t raw) {
    int32_t v = t_fine - 76800;
    v = (((raw << 14) - ((int32_t)dig_H4 << 20) - ((int32_t)dig_H5 * v)) + 16384) >> 15;
    v = v * (((((((v * (int32_t)dig_H6) >> 10) *
                 (((v * (int32_t)dig_H3) >> 11) + 32768)) >> 10) + 2097152) *
               (int32_t)dig_H2 + 8192) >> 14);
    v -= ((((v >> 15) * (v >> 15)) >> 7) * (int32_t)dig_H1) >> 4;
    if (v < 0)         v = 0;
    if (v > 419430400) v = 419430400;
    return (uint32_t)(v >> 12); /* %RH × 1024 */
}

/* Leitura forçada — burst 0xF7..0xFE (8 bytes) */
static void bmeForcedRead(int32_t *temp_c100, uint32_t *pres_pa, uint8_t *hum_pct) {
    bmeWriteByte(0xF2, 0x01); /* osrs_h = ×1          */
    bmeWriteByte(0xF4, 0x25); /* osrs_t=×1, osrs_p=×1, forced */
    _delay_ms(10);

    i2cStart();
    i2cWrite((uint8_t)(BME_ADDR << 1));
    i2cWrite(0xF7);
    i2cStart();
    i2cWrite((uint8_t)((BME_ADDR << 1) | 1));

    uint8_t d[8];
    for (uint8_t i = 0; i < 7; i++) d[i] = i2cRead(1);
    d[7] = i2cRead(0);
    i2cStop();

    int32_t raw_p = ((int32_t)d[0] << 12) | ((int32_t)d[1] << 4) | (d[2] >> 4);
    int32_t raw_t = ((int32_t)d[3] << 12) | ((int32_t)d[4] << 4) | (d[5] >> 4);
    int32_t raw_h = ((int32_t)d[6] << 8)  |  d[7];

    *temp_c100 = bmeCompTemp(raw_t);
    *pres_pa   = bmeCompPres(raw_p);
    *hum_pct   = (uint8_t)(bmeCompHum(raw_h) >> 10); /* %RH inteiro */
}

/* ═══════════════════════════════════════════════════════════════════════════
 * NH3 — lookup linear sem float
 * ═══════════════════════════════════════════════════════════════════════════ */
static uint16_t nh3LookupPpm_x10(uint16_t ratio_x100) {
    const uint8_t N = 8;
    if (ratio_x100 <= pgm_read_word(&NH3_RATIO_X100[0]))
        return pgm_read_word(&NH3_PPM_X10[0]);
    if (ratio_x100 >= pgm_read_word(&NH3_RATIO_X100[N-1]))
        return pgm_read_word(&NH3_PPM_X10[N-1]);

    for (uint8_t i = 1; i < N; i++) {
        uint16_t r1 = pgm_read_word(&NH3_RATIO_X100[i-1]);
        uint16_t r2 = pgm_read_word(&NH3_RATIO_X100[i]);
        if (ratio_x100 <= r2) {
            uint16_t p1 = pgm_read_word(&NH3_PPM_X10[i-1]);
            uint16_t p2 = pgm_read_word(&NH3_PPM_X10[i]);
            /* interpolação linear inteira: p1 - (p1-p2)*(rx-r1)/(r2-r1) */
            return p1 - (uint16_t)((uint32_t)(p1 - p2) * (ratio_x100 - r1) / (r2 - r1));
        }
    }
    return pgm_read_word(&NH3_PPM_X10[N-1]);
}

static uint16_t readNH3_ppm_x10(void) {
    /*
     * CORREÇÃO: _delay_ms() aceita no máximo ~262 ms @ 8 MHz sem overflow
     * do argumento constante. Aquecimento de 20 s → 20 iterações de 1000 ms.
     * (avr-gcc avalia _delay_ms em tempo de compilação; argumento deve ser
     *  constante e ≤ 262143/F_CPU_MHz para evitar overflow de ciclos internos.)
     */
    for (uint8_t w = 0; w < 20; w++) _delay_ms(1000);

    uint16_t raw = 0;
    for (uint8_t i = 0; i < 8; i++) {
        ADMUX  = (1 << MUX1) | (1 << MUX0); /* ADC3, Vref = VCC */
        ADCSRA = (1 << ADEN) | (1 << ADSC) | (1 << ADPS2) | (1 << ADPS1); /* prescaler 64 */
        while (ADCSRA & (1 << ADSC));
        raw = (uint16_t)(raw + ADC);
        _delay_ms(10);
    }
    raw >>= 3; /* média de 8 amostras */

    /* Vout em mV (inteiro, Vcc=3300 mV, resolução 10 bits) */
    uint32_t vout_mv = ((uint32_t)raw * 3300u) / 1023u;
    if (vout_mv < 10) vout_mv = 10; /* evita divisão por zero */

    /*
     * Rs = RL × (Vcc − Vout) / Vout
     * Trabalhamos em unidades de 0,001 kΩ (= Ω) para manter resolução
     * sem float:  rs_ohm = NH3_RL [kΩ] × 1000 × (3300 − vout_mv) / vout_mv
     * ratio × 100 = (Rs / R0) × 100, com R0 em Ω = NH3_R0 × 1000
     */
    uint32_t rs_ohm  = (uint32_t)NH3_RL * 1000u * (3300u - vout_mv) / vout_mv;
    uint16_t ratio_x100 = (uint16_t)(rs_ohm * 100u / ((uint32_t)NH3_R0 * 1000u));

    return nh3LookupPpm_x10(ratio_x100);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Utilitários de formatação (sem printf → economiza ~800 bytes de flash)
 * ═══════════════════════════════════════════════════════════════════════════ */

/* CORREÇÃO: a versão original decrementava 'n' e depois indexava com 'n',
 * consumindo a posição 0 do buffer como lixo.
 * Solução: escrever ao contrário e inverter. */
static char* writeU32(char *p, uint32_t v) {
    if (v == 0) { *p++ = '0'; return p; }
    char  tmp[10];
    uint8_t n = 0;
    while (v) { tmp[n++] = (char)('0' + v % 10u); v /= 10u; }
    /* tmp está invertido — copiar de trás para frente */
    while (n) *p++ = tmp[--n];
    return p;
}

/* v10 é o valor × 10 (ex.: 235 → "23.5") */
static char* writeFixed1(char *p, int32_t v10) {
    if (v10 < 0) { *p++ = '-'; v10 = -v10; }
    p = writeU32(p, (uint32_t)(v10 / 10));
    *p++ = '.';
    *p++ = (char)('0' + v10 % 10);
    return p;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * MAIN
 * ═══════════════════════════════════════════════════════════════════════════ */
int main(void) {
    spiInit();

    for (;;) {
        /* ── 1. NH3 (ADC em PB3, sem conflito de barramento) ──────────── */
        uint16_t nh3_x10 = readNH3_ppm_x10();

        /* ── 2. BME280 (I2C bit-bang em PB0/PB2) ──────────────────────── */
        int32_t  temp_c100 = 0;
        uint32_t pres_pa   = 0;
        uint8_t  hum_pct   = 0;

        bmeLoadCalib();
        bmeForcedRead(&temp_c100, &pres_pa, &hum_pct);

        /* ── 3. Monta payload ASCII ────────────────────────────────────── */
        /* Formato: "T:23.5|U:65|P:101325|A:12.3"  (máx 31 chars + '\0') */
        char *p = g_pkt;
        *p++ = 'T'; *p++ = ':';
        p = writeFixed1(p, temp_c100 / 10); /* c×100 → c×10 */

        *p++ = '|'; *p++ = 'U'; *p++ = ':';
        p = writeU32(p, (uint32_t)hum_pct);

        *p++ = '|'; *p++ = 'P'; *p++ = ':';
        p = writeU32(p, pres_pa);

        *p++ = '|'; *p++ = 'A'; *p++ = ':';
        p = writeFixed1(p, (int32_t)nh3_x10);
        *p = '\0';

        /* ── 4. SX1276 TX (reconfigura pinos PB0/PB2 para USI SPI) ───── */
        spiInit();
        if (loraInit()) {
            loraSend(g_pkt, (uint8_t)(p - g_pkt));
        }

        /* ── 5. Deep sleep ~5 min ──────────────────────────────────────── */
        deepSleep();
    }
}

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * platformio.ini CORRETO para bare-metal (sem Arduino framework):
 *
 * [env:attiny85_sensor]
 * platform         = atmelavr@4.2.0
 * board            = attiny85
 * ; framework REMOVIDO — bare-metal puro
 * board_build.f_cpu = 8000000L
 * upload_protocol  = custom
 * upload_flags     =
 *     -C$PACKAGES_DIR/tool-avrdude/avrdude.conf
 *     -v -pattiny85 -cusbasp -Pusb
 *     -U lfuse:w:0xE2:m
 *     -U hfuse:w:0xDF:m
 *     -U efuse:w:0xFF:m
 * upload_command   = avrdude $UPLOAD_FLAGS -U flash:w:$SOURCE:i
 * build_flags      =
 *     -Os
 *     -ffunction-sections
 *     -fdata-sections
 *     -Wl,--gc-sections
 *     -fno-exceptions
 *     -fno-strict-aliasing
 *     -mmcu=attiny85
 *     -DF_CPU=8000000UL
 * ; Fonte em .c (NÃO .cpp) elimina overhead de C++ e erro de ISR no IntelliSense
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ESTIMATIVA DE USO DE RAM (ATtiny85: 512 bytes disponíveis):
 *   Calibração BME280  : 36 bytes  (.bss)
 *   t_fine             :  4 bytes  (.bss)
 *   g_pkt              : 36 bytes  (.bss)
 *   g_wdt_count        :  1 byte   (.bss)
 *   Stack (pior caso)  : ~80 bytes (main + bmeForcedRead → b[8] + bmeLoadCalib → b[24]+h[7])
 *   ────────────────────────────────
 *   TOTAL estimado     : ~157 bytes  (≪ 512 bytes) ✓
 *
 * ESTIMATIVA DE FLASH:
 *   ISR WDT             :  ~6 bytes
 *   deepSleep           :  ~50 bytes
 *   SPI/USI             :  ~60 bytes
 *   SX1276              : ~120 bytes
 *   I2C bit-bang        : ~140 bytes
 *   BME280 (calib+comp) : ~300 bytes
 *   NH3                 : ~120 bytes
 *   Formatação          :  ~80 bytes
 *   main                :  ~60 bytes
 *   Tabelas PROGMEM     :  ~32 bytes
 *   ────────────────────────────────
 *   TOTAL estimado      : ~968 bytes de flash  (ATtiny85 tem 8 KB) ✓
 */