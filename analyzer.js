const ccxt = require('ccxt');

// ============================================================
// TEKNİK İNDİKATÖRLER
// ============================================================

function ema(values, period) {
  const k = 2 / (period + 1);
  let e = values[0];
  const out = [e];
  for (let i = 1; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
    out.push(e);
  }
  return out;
}

function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  let avgG = gain / period, avgL = loss / period;
  out[period] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgG = (avgG * (period - 1) + Math.max(d, 0)) / period;
    avgL = (avgL * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  }
  return out;
}

function macd(closes, fast = 12, slow = 26, signal = 9) {
  const ef = ema(closes, fast);
  const es = ema(closes, slow);
  const line = closes.map((_, i) => ef[i] - es[i]);
  const sig = ema(line, signal);
  const hist = line.map((v, i) => v - sig[i]);
  return { line, signal: sig, histogram: hist };
}

function atr(candles, period = 14) {
  const out = new Array(candles.length).fill(null);
  const tr = [null];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i] || 0;
  out[period] = sum / period;
  for (let i = period + 1; i < candles.length; i++) {
    out[i] = (out[i - 1] * (period - 1) + tr[i]) / period;
  }
  return out;
}

function bollinger(closes, period = 20, mult = 2) {
  const mid = sma(closes, period);
  const upper = new Array(closes.length).fill(null);
  const lower = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    let v = 0;
    for (let j = i - period + 1; j <= i; j++) v += (closes[j] - mid[i]) ** 2;
    const sd = Math.sqrt(v / period);
    upper[i] = mid[i] + mult * sd;
    lower[i] = mid[i] - mult * sd;
  }
  return { mid, upper, lower };
}

function stochastic(candles, kPeriod = 14, dPeriod = 3) {
  const k = new Array(candles.length).fill(null);
  for (let i = kPeriod - 1; i < candles.length; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      hh = Math.max(hh, candles[j].high);
      ll = Math.min(ll, candles[j].low);
    }
    k[i] = hh === ll ? 50 : ((candles[i].close - ll) / (hh - ll)) * 100;
  }
  const d = sma(k.map(v => v === null ? 0 : v), dPeriod);
  // d'nin ilk değerlerini null yap (sma 0'larla hesapladı)
  for (let i = 0; i < candles.length; i++) {
    if (k[i] === null) d[i] = null;
  }
  return { k, d };
}

function adx(candles, period = 14) {
  const n = candles.length;
  const plusDM = [0], minusDM = [0], tr = [0];
  for (let i = 1; i < n; i++) {
    const up = candles[i].high - candles[i - 1].high;
    const dn = candles[i - 1].low - candles[i].low;
    plusDM.push(up > dn && up > 0 ? up : 0);
    minusDM.push(dn > up && dn > 0 ? dn : 0);
    const p = candles[i - 1];
    tr.push(Math.max(candles[i].high - candles[i].low,
      Math.abs(candles[i].high - p.close), Math.abs(candles[i].low - p.close)));
  }
  const smooth = (arr) => {
    const out = new Array(n).fill(null);
    let s = 0;
    for (let i = 1; i <= period; i++) s += arr[i];
    out[period] = s;
    for (let i = period + 1; i < n; i++) out[i] = out[i - 1] - out[i - 1] / period + arr[i];
    return out;
  };
  const sTR = smooth(tr), sP = smooth(plusDM), sM = smooth(minusDM);
  const pdi = new Array(n).fill(null), mdi = new Array(n).fill(null), dx = new Array(n).fill(null), adxArr = new Array(n).fill(null);
  for (let i = period; i < n; i++) {
    pdi[i] = sTR[i] ? 100 * sP[i] / sTR[i] : 0;
    mdi[i] = sTR[i] ? 100 * sM[i] / sTR[i] : 0;
    const sum = pdi[i] + mdi[i];
    dx[i] = sum ? 100 * Math.abs(pdi[i] - mdi[i]) / sum : 0;
  }
  // ADX = DX'in Welles Wilder yumuşatması
  let first = null;
  for (let i = period; i < n; i++) if (dx[i] !== null) { first = i; break; }
  if (first !== null) {
    let s = 0;
    for (let i = first; i < first + period; i++) s += dx[i] || 0;
    adxArr[first + period - 1] = s / period;
    for (let i = first + period; i < n; i++) {
      adxArr[i] = (adxArr[i - 1] * (period - 1) + dx[i]) / period;
    }
  }
  return { adx: adxArr, plusDI: pdi, minusDI: mdi };
}

// ============================================================
// DESTEK / DİRENÇ (swing high/low kümeleme)
// ============================================================

function findSwingPoints(candles, left = 3, right = 3) {
  const highs = [], lows = [];
  for (let i = left; i < candles.length - right; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
    }
    if (isHigh) highs.push({ index: i, price: candles[i].high });
    if (isLow) lows.push({ index: i, price: candles[i].low });
  }
  return { highs, lows };
}

function clusterLevels(points, currentPrice, tolerancePct = 0.4, maxLevels = 8) {
  if (!points.length) return [];
  const sorted = [...points].sort((a, b) => a.price - b.price);
  const clusters = [];
  for (const p of sorted) {
    const c = clusters[clusters.length - 1];
    if (c && Math.abs(p.price - c.price) / c.price * 100 <= tolerancePct) {
      c.points.push(p);
      c.price = c.points.reduce((s, x) => s + x.price, 0) / c.points.length;
      c.strength++;
    } else {
      clusters.push({ price: p.price, strength: 1, points: [p] });
    }
  }
  // strength'e göre sırala, mevcut fiyata yakınları öne al
  const lastIdx = points[0] ? Math.max(...points.map(p => p.index)) : 0;
  return clusters
    .map(c => ({
      price: c.price,
      strength: c.strength,
      touches: c.points.length,
      lastIndex: Math.max(...c.points.map(p => p.index)),
      distancePct: (c.price - currentPrice) / currentPrice * 100
    }))
    .sort((a, b) => Math.abs(a.distancePct) - Math.abs(b.distancePct))
    .slice(0, maxLevels);
}

// ============================================================
// ANALİZ MOTORU
// ============================================================

const TIMEFRAME_RANK = ['1m','3m','5m','15m','30m','1h','2h','4h','6h','8h','12h','1d','3d','1w'];

function higherTimeframe(tf) {
  const i = TIMEFRAME_RANK.indexOf(tf);
  if (i < 0) return '1d';
  // 2 kademe yukarı bak
  return TIMEFRAME_RANK[Math.min(i + 2, TIMEFRAME_RANK.length - 1)];
}

class CoinAnalyzer {
  constructor() {
    const opts = { enableRateLimit: true, options: { adjustForTimeDifference: true } };
    this.exchange = new ccxt.binance(opts);                                    // Spot
    this.exchangeFutures = new ccxt.binance({ ...opts, options: { ...opts.options, defaultType: 'future' } }); // Vadeli
  }

  // market: 'spot' | 'future'
  ex(market) { return market === 'future' ? this.exchangeFutures : this.exchange; }

  toPair(symbol, market = 'spot') {
    const base = symbol.toUpperCase().includes('/') ? symbol.toUpperCase() : `${symbol.toUpperCase()}/USDT`;
    return market === 'future' && !base.includes(':') ? `${base}:USDT` : base;
  }

  async fetchCandles(symbol, timeframe, limit = 500, market = 'spot') {
    const pair = this.toPair(symbol, market);
    try {
      const ohlcv = await this.ex(market).fetchOHLCV(pair, timeframe, undefined, limit);
      return ohlcv.map(c => ({ timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] }));
    } catch (e) {
      throw new Error(`"${pair}" için veri alınamadı: ${e.message}`);
    }
  }

  // Grafik için mum + EMA serileri
  async chartData(symbol, timeframe = '1h', limit = 300, market = 'spot') {
    const pair = this.toPair(symbol, market);
    const ohlcv = await this.ex(market).fetchOHLCV(pair, timeframe, undefined, limit + 60);
    const candles = ohlcv.map(c => ({ timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] }));
    const closes = candles.map(c => c.close);
    const e20 = ema(closes, 20), e50 = ema(closes, 50);
    const rsiArr = rsi(closes, 14);
    const macdArr = macd(closes);
    const slice = candles.slice(-limit);
    const off = candles.length - limit;
    const t = i => Math.floor(slice[i].timestamp / 1000);
    const series = (arr) => arr.slice(off).map((v, i) => v === null ? null : { time: t(i), value: v }).filter(Boolean);
    return {
      symbol: pair,
      timeframe,
      candles: slice.map(c => ({
        time: Math.floor(c.timestamp / 1000),
        open: c.open, high: c.high, low: c.low, close: c.close
      })),
      ema20: series(e20),
      ema50: series(e50),
      rsi: series(rsiArr),
      macd: series(macdArr.line),
      macdSignal: series(macdArr.signal),
      macdHist: series(macdArr.histogram),
      volume: slice.map(c => ({ time: Math.floor(c.timestamp / 1000), value: c.volume, color: c.close >= c.open ? 'rgba(8,153,129,.35)' : 'rgba(242,54,69,.35)' })),
      price: closes[closes.length - 1]
    };
  }

  async analyze(symbol, timeframe = '1h', market = 'spot') {
    // Vadeli çift yoksa spot'a düş
    let m = market;
    let candles, htfCandles;
    try {
      [candles, htfCandles] = await Promise.all([
        this.fetchCandles(symbol, timeframe, 500, m),
        this.fetchCandles(symbol, higherTimeframe(timeframe), 300, m).catch(() => null)
      ]);
    } catch (e) {
      if (m === 'future') {
        m = 'spot';
        [candles, htfCandles] = await Promise.all([
          this.fetchCandles(symbol, timeframe, 500, m),
          this.fetchCandles(symbol, higherTimeframe(timeframe), 300, m).catch(() => null)
        ]);
      } else throw e;
    }

    const closes = candles.map(c => c.close);
    const price = closes[closes.length - 1];
    const n = closes.length;
    const last = i => candles[i];

    // İndikatör serileri
    const e20 = ema(closes, 20), e50 = ema(closes, 50), e200 = ema(closes, 200);
    const rsiArr = rsi(closes, 14);
    const macdArr = macd(closes);
    const atrArr = atr(candles, 14);
    const bb = bollinger(closes, 20, 2);
    const stoch = stochastic(candles);
    const adxArr = adx(candles, 14);
    const volSma = sma(candles.map(c => c.volume), 20);

    const rsiV = rsiArr[n - 1];
    const rsiPrev = rsiArr[n - 5] || rsiV;
    const macdV = macdArr.line[n - 1], macdS = macdArr.signal[n - 1], macdH = macdArr.histogram[n - 1];
    const macdHPrev = macdArr.histogram[n - 3] || macdH;
    const atrV = atrArr[n - 1] || price * 0.02;
    const adxV = adxArr.adx[n - 1] || 0;
    const pdi = adxArr.plusDI[n - 1] || 0, mdi = adxArr.minusDI[n - 1] || 0;
    const stochK = stoch.k[n - 1] || 50, stochD = stoch.d[n - 1] || 50;
    const volRatio = volSma[n - 1] ? candles[n - 1].volume / volSma[n - 1] : 1;
    const bbPos = bb.upper[n - 1] && bb.lower[n - 1]
      ? (price - bb.lower[n - 1]) / (bb.upper[n - 1] - bb.lower[n - 1]) : 0.5;

    // HTF trend
    let htfTrend = 'NÖTR';
    if (htfCandles && htfCandles.length > 200) {
      const hc = htfCandles.map(c => c.close);
      const he20 = ema(hc, 20)[hc.length - 1];
      const he50 = ema(hc, 50)[hc.length - 1];
      const he200 = ema(hc, 200)[hc.length - 1];
      const hprice = hc[hc.length - 1];
      if (hprice > he20 && he20 > he50 && he50 > he200) htfTrend = 'YÜKSELİŞ';
      else if (hprice < he20 && he20 < he50 && he50 < he200) htfTrend = 'DÜŞÜŞ';
      else if (hprice > he50) htfTrend = 'YÜKSELİŞ EĞİLİMLİ';
      else htfTrend = 'DÜŞÜŞ EĞİLİMLİ';
    }

    // S/R seviyeleri
    const swings = findSwingPoints(candles, 3, 3);
    const resistances = clusterLevels(swings.highs.map(h => ({ ...h, index: h.index })), price, 0.5)
      .filter(l => l.price > price * 1.001);
    const supports = clusterLevels(swings.lows, price, 0.5)
      .filter(l => l.price < price * 0.999);
    const nearestResistance = resistances.sort((a, b) => a.price - b.price)[0]?.price || price * 1.05;
    const nearestSupport = supports.sort((a, b) => b.price - a.price)[0]?.price || price * 0.95;

    // EMA eğilimleri (son 5 mum)
    const e20Slope = (e20[n - 1] - e20[n - 6]) / e20[n - 6] * 100;
    const e50Slope = (e50[n - 1] - e50[n - 6]) / e50[n - 6] * 100;

    // ================= REJİM TESPİTİ =================
    // Trend rejimi: güçlü trendde trendle ters sinyal neredeyse her zaman kaybettirir
    const e100v = ema(closes, 100)[n - 1];
    const stackBull = e20[n-1] > e50[n-1] && e50[n-1] > e100v && e100v > e200[n-1];
    const stackBear = e20[n-1] < e50[n-1] && e50[n-1] < e100v && e100v < e200[n-1];
    const regime = adxV > 28
      ? (pdi > mdi ? 'GÜÇLÜ YÜKSELİŞ' : 'GÜÇLÜ DÜŞÜŞ')
      : stackBull ? 'YÜKSELİŞ' : stackBear ? 'DÜŞÜŞ' : 'RANGE';

    // Momentum yönü: RSI değişimi + MACD + fiyat momentumu + EMA20 pozisyonu
    const roc = (closes[n-1] - closes[n-11]) / closes[n-11] * 100;
    const momParts = [
      rsiV - rsiPrev > 1.5 ? 1 : rsiV - rsiPrev < -1.5 ? -1 : 0,
      macdH > 0 ? 1 : -1,
      roc > 0.3 ? 1 : roc < -0.3 ? -1 : 0,
      price > e20[n-1] ? 1 : -1
    ];
    const momScore = momParts.reduce((a, b) => a + b, 0);
    const momentumDir = momScore >= 2 ? 1 : momScore <= -2 ? -1 : 0;

    // ================= SKORLAMA =================
    let bull = 0, bear = 0;
    const reasons = [];
    const B = (pts, text) => { bull += pts; reasons.push(text); };
    const S = (pts, text) => { bear += pts; reasons.push(text); };

    // 1) TREND YAPISI (ağırlık ~35)
    if (e20[n-1] > e50[n-1] && e50[n-1] > e200[n-1]) B(15, 'EMA20 > EMA50 > EMA200 — güçlü yükseliş dizilimi');
    else if (e20[n-1] < e50[n-1] && e50[n-1] < e200[n-1]) S(15, 'EMA20 < EMA50 < EMA200 — güçlü düşüş dizilimi');
    else if (e20[n-1] > e50[n-1]) B(6, 'EMA20 > EMA50 — kısa vadeli yükseliş eğilimi');
    else S(6, 'EMA20 < EMA50 — kısa vadeli düşüş eğilimi');

    if (price > e20[n-1] && e20Slope > 0) B(6, `Fiyat EMA20 üzerinde ve EMA20 yükseliyor (%${e20Slope.toFixed(2)})`);
    else if (price < e20[n-1] && e20Slope < 0) S(6, `Fiyat EMA20 altında ve EMA20 düşüyor (%${e20Slope.toFixed(2)})`);

    if (e50Slope > 0.1) B(3, 'EMA50 yükseliş yönünde');
    else if (e50Slope < -0.1) S(3, 'EMA50 düşüş yönünde');

    if (htfTrend === 'YÜKSELİŞ' || htfTrend === 'YÜKSELİŞ EĞİLİMLİ') B(8, `Üst zaman dilimi (${higherTimeframe(timeframe)}) trendi: ${htfTrend}`);
    else if (htfTrend === 'DÜŞÜŞ' || htfTrend === 'DÜŞÜŞ EĞİLİMLİ') S(8, `Üst zaman dilimi (${higherTimeframe(timeframe)}) trendi: ${htfTrend}`);

    if (adxV > 28) {
      if (pdi > mdi) B(7, `ADX ${adxV.toFixed(0)} — güçlü trend, +DI baskın (trend yönünde kal)`);
      else S(7, `ADX ${adxV.toFixed(0)} — güçlü trend, -DI baskın (trend yönünde kal)`);
    } else {
      reasons.push(`ADX ${adxV.toFixed(0)} — trend gücü zayıf, range piyasası`);
    }

    // 2) MOMENTUM (ağırlık ~30)
    if (rsiV < 30) {
      if (regime.includes('DÜŞÜŞ') || regime.includes('DÜŞ')) B(2, `RSI ${rsiV.toFixed(0)} aşırı satım ama güçlü düşüş trendi — tepki alımı RİSKLİ`);
      else B(10, `RSI ${rsiV.toFixed(0)} — aşırı satım, dönüş potansiyeli`);
    } else if (rsiV < 45 && rsiV > rsiPrev) B(5, `RSI ${rsiV.toFixed(0)} ve yükseliyor`);
    else if (rsiV > 70) {
      if (regime.includes('YÜKSEL')) S(2, `RSI ${rsiV.toFixed(0)} aşırı alım ama güçlü yükseliş trendi — short RİSKLİ`);
      else S(10, `RSI ${rsiV.toFixed(0)} — aşırı alım, düzeltme riski`);
    } else if (rsiV > 55 && rsiV < rsiPrev) S(5, `RSI ${rsiV.toFixed(0)} ve düşüyor`);
    else reasons.push(`RSI ${rsiV.toFixed(0)} — nötr bölge`);

    if (macdH > 0 && macdH > macdHPrev) B(6, 'MACD histogramı pozitif ve güçleniyor');
    else if (macdH < 0 && macdH < macdHPrev) S(6, 'MACD histogramı negatif ve güçleniyor');
    else if (macdH > 0) B(2, 'MACD histogramı pozitif');
    else S(2, 'MACD histogramı negatif');

    if (stochK < 20 && stochK > stochD) B(4, 'Stokastik aşırı satımdan dönüyor');
    else if (stochK > 80 && stochK < stochD) S(4, 'Stokastik aşırı alımdan dönüyor');

    // 3) FİYAT AKSİYONU & HACİM (ağırlık ~20)
    const lastC = candles[n - 1], prevC = candles[n - 2];
    if (volRatio > 1.8) {
      if (lastC.close > lastC.open) B(8, `Yüksek hacim (${volRatio.toFixed(1)}x) + yeşil mum — güçlü alım baskısı`);
      else S(8, `Yüksek hacim (${volRatio.toFixed(1)}x) + kırmızı mum — güçlü satış baskısı`);
    } else if (volRatio < 0.6) {
      reasons.push(`Düşük hacim (${volRatio.toFixed(1)}x) — sinyal güvenilirliği düşük`);
    } else {
      reasons.push(`Hacim normal (${volRatio.toFixed(1)}x ortalama)`);
    }
    // Son 3 mumun yönü
    const c3 = candles[n-1].close > candles[n-3].close ? 1 : -1;
    if (volRatio > 1.2) {
      if (c3 > 0) B(3, 'Son 3 mum yukarı yönlü (hacimli)');
      else S(3, 'Son 3 mum aşağı yönlü (hacimli)');
    }

    // 4) BOLLINGER & S/R (ağırlık ~15)
    if (bbPos < 0.05) {
      if (regime.includes('DÜŞ')) B(2, 'Bollinger alt bandı ama düşüş trendi — dönüş teyidi zayıf');
      else B(6, 'Fiyat Bollinger alt bandında — potansiyel dönüş');
    } else if (bbPos > 0.95) {
      if (regime.includes('YÜKSEL')) S(2, 'Bollinger üst bandı ama yükseliş trendi — reddedilme teyidi zayıf');
      else S(6, 'Fiyat Bollinger üst bandında — potansiyel reddedilme');
    } else if (bbPos > 0.8) S(2, 'Fiyat Bollinger üst bölgesinde');
    else if (bbPos < 0.2) B(2, 'Fiyat Bollinger alt bölgesinde');

    const distToRes = (nearestResistance - price) / price * 100;
    const distToSup = (price - nearestSupport) / price * 100;
    if (distToRes < 0.5) S(5, `Direnç çok yakın (%${distToRes.toFixed(2)}) — direnç reddi olası`);
    if (distToSup < 0.5) B(5, `Destek çok yakın (%${distToSup.toFixed(2)}) — destek tepkisi olası`);
    if (distToRes > 3 && distToSup < 1) B(3, 'Destek yakın, direnç uzak — yukarı alan var');
    if (distToSup > 3 && distToRes < 1) S(3, 'Direnç yakın, destek uzak — aşağı alan var');

    // ================= SİNYAL KARARI =================
    // Trendle ters sinyal = tehlike. Güçlü trendde ancak momentum da ters dönmüşse ve skor çok yüksekse izin ver.
    const netScore = bull - bear;
    const counterTrend = (regime.includes('DÜŞÜŞ') && netScore > 0) || (regime.includes('YÜKSELİŞ') && netScore < 0);
    const momentumAgainst = (netScore > 0 && momentumDir < 0) || (netScore < 0 && momentumDir > 0);

    let direction = 'BEKLE';
    const threshold = counterTrend ? 45 : 30;
    if (netScore >= threshold && !momentumAgainst) direction = 'LONG';
    else if (netScore <= -threshold && !momentumAgainst) direction = 'SHORT';

    if (counterTrend && direction !== 'BEKLE') {
      reasons.unshift(`⚠️ DİKKAT: ${regime} rejiminde ${direction === 'LONG' ? 'AL' : 'SAT'} sinyali trendle TERS — sadece küçük pozisyonla girin`);
    } else if (momentumAgainst && Math.abs(netScore) >= 30) {
      reasons.push('Momentum henüz dönmedi — sinyal zayıf, BEKLE daha güvenli olabilir');
    }

    const confidence = Math.min(95, Math.round(50 + Math.abs(netScore) * 0.9));

    // ================= İŞLEM PLANI =================
    const plan = this.buildPlan(direction, price, atrV, nearestSupport, nearestResistance, resistances, supports, e20[n-1], e50[n-1]);

    return {
      symbol: this.toPair(symbol, m),
      market: m,
      timeframe,
      price,
      timestamp: new Date().toISOString(),
      direction,
      confidence,
      netScore,
      plan,
      indicators: {
        rsi: +rsiV.toFixed(1),
        macdHist: +macdH.toPrecision(4),
        atr: +atrV.toFixed(8),
        atrPct: +(atrV / price * 100).toFixed(2),
        adx: +adxV.toFixed(1),
        plusDI: +pdi.toFixed(1),
        minusDI: +mdi.toFixed(1),
        stochK: +stochK.toFixed(0),
        ema20: +e20[n-1].toFixed(8),
        ema50: +e50[n-1].toFixed(8),
        ema200: +e200[n-1].toFixed(8),
        ema20Slope: +e20Slope.toFixed(2),
        ema50Slope: +e50Slope.toFixed(2),
        volumeRatio: +volRatio.toFixed(2),
        bbPosition: +bbPos.toFixed(2),
        htfTrend,
        regime,
        momentumDir,
        nearestSupport: +nearestSupport.toFixed(8),
        nearestResistance: +nearestResistance.toFixed(8)
      },
      supports: supports.slice(0, 5).map(l => +l.price.toFixed(8)),
      resistances: resistances.slice(0, 5).map(l => +l.price.toFixed(8)),
      reasons,
      // grafik için son 200 mum + EMA serileri
      chart: {
        candles: candles.slice(-200).map(c => ({
          time: Math.floor(c.timestamp / 1000),
          open: c.open, high: c.high, low: c.low, close: c.close
        })),
        ema20: e20.slice(-200).map((v, i) => ({ time: Math.floor(candles[n - 200 + i].timestamp / 1000), value: v })),
        ema50: e50.slice(-200).map((v, i) => ({ time: Math.floor(candles[n - 200 + i].timestamp / 1000), value: v }))
      }
    };
  }

  // Hafif trend taraması — çoklu coin tarayıcı için (2 TF: 4h + 1d)
  async scanTrend(symbol, market = 'spot') {
    const m = market;
    try {
      const [c4h, c1d] = await Promise.all([
        this.fetchCandles(symbol, '4h', 220, m),
        this.fetchCandles(symbol, '1d', 160, m).catch(() => null)
      ]);
      const closes = c4h.map(c => c.close);
      const price = closes[closes.length - 1];
      const e20 = ema(closes, 20), e50 = ema(closes, 50), e200 = ema(closes, 200);
      const rsiArr = rsi(closes, 14);
      const n = closes.length;

      const e20v = e20[n-1], e50v = e50[n-1], e200v = e200[n-1];
      const e50Slope = (e50v - e50[n-6]) / e50[n-6] * 100;
      const rsiV = rsiArr[n-1] || 50;

      // HTF (1d) eğilimi
      let htf = 0;
      if (c1d && c1d.length > 60) {
        const hc = c1d.map(c => c.close);
        const he20 = ema(hc, 20)[hc.length - 1];
        const he50 = ema(hc, 50)[hc.length - 1];
        const hp = hc[hc.length - 1];
        if (hp > he20 && he20 > he50) htf = 1;
        else if (hp < he20 && he20 < he50) htf = -1;
      }

      // Trend skoru: -100..+100
      let score = 0;
      if (price > e50v) score += 25; else score -= 25;
      if (e20v > e50v) score += 20; else score -= 20;
      if (e50v > e200v) score += 20; else score -= 20;
      score += Math.max(-15, Math.min(15, e50Slope * 30));
      score += htf * 15;
      // RSI aşırı bölgelerde hafif düzeltme (trend içinde bile)
      if (rsiV > 75) score -= 8;
      if (rsiV < 25) score += 8;

      const label = score >= 30 ? 'YÜKSELİŞ' : score <= -30 ? 'DÜŞÜŞ' : 'NÖTR';
      const base = symbol.toUpperCase().split('/')[0].replace(':USDT', '');
      return {
        symbol: base + '/USDT',
        base,
        market: m,
        price,
        rsi: +rsiV.toFixed(1),
        score: Math.round(score),
        label
      };
    } catch (e) {
      return null;
    }
  }

  // Özel tarayıcı: tek coin için tüm gösterge değerleri (parametrik)
  async screenCoin(symbol, timeframe = '4h', market = 'spot', params = {}, htf = 'none') {
    try {
      const P = {
        rsi: params.rsi || 14,
        macdF: params.macdF || 12, macdSlow: params.macdSlow || 26, macdSig: params.macdSig || 9,
        stochK: params.stochK || 14, stochD: params.stochD || 3,
        adx: params.adx || 14,
        emaF: params.emaF || 20, emaM: params.emaM || 50, emaS: params.emaS || 200,
        bbP: params.bbP || 20, bbM: params.bbM || 2,
        atr: params.atr || 14,
        mom: params.mom || 10
      };

      const candles = await this.fetchCandles(symbol, timeframe, 250, market);
      const closes = candles.map(c => c.close);
      const n = closes.length;
      const eF = ema(closes, P.emaF), eM = ema(closes, P.emaM), eS = ema(closes, P.emaS);
      const eFv = eF[n - 1], eMv = eM[n - 1], eSv = eS[n - 1];
      const eMslope = (eMv - eM[n - 6]) / eM[n - 6] * 100;
      const rsiArr = rsi(closes, P.rsi);
      const macdArr = macd(closes, P.macdF, P.macdSlow, P.macdSig);
      const stoch = stochastic(candles, P.stochK, P.stochD);
      const adxArr = adx(candles, P.adx);
      const atrArr = atr(candles, P.atr);
      const bb = bollinger(closes, P.bbP, P.bbM);
      const volSma = sma(candles.map(c => c.volume), 20);
      const price = closes[n - 1];
      const base = symbol.toUpperCase().split('/')[0].replace(':USDT', '');
      const rsiV = rsiArr[n - 1] || 50;
      const atrV = atrArr[n - 1] || price * 0.02;
      const bbPos = bb.upper[n - 1] && bb.lower[n - 1]
        ? (price - bb.lower[n - 1]) / (bb.upper[n - 1] - bb.lower[n - 1]) : 0.5;
      const plusDI = adxArr.plusDI[n - 1] || 0, minusDI = adxArr.minusDI[n - 1] || 0;

      // Ek metrikler
      const momPct = (closes[n - 1] - closes[n - 1 - P.mom]) / closes[n - 1 - P.mom] * 100;
      const win = candles.slice(-P.mom * 3);
      const hi = Math.max(...win.map(c => c.high));
      const lo = Math.min(...win.map(c => c.low));
      const rangePos = hi === lo ? 50 : (price - lo) / (hi - lo) * 100;
      let consecUp = 0, consecDn = 0;
      for (let i = n - 1; i >= 0; i--) {
        if (candles[i].close > candles[i].open) { if (consecDn > 0) break; consecUp++; }
        else if (candles[i].close < candles[i].open) { if (consecUp > 0) break; consecDn++; }
        else break;
      }
      const last20 = candles.slice(-20);
      let upVol = 0, dnVol = 0;
      last20.forEach(c => { if (c.close >= c.open) upVol += c.volume; else dnVol += c.volume; });
      const volBalance = upVol + dnVol === 0 ? 0.5 : upVol / (upVol + dnVol);
      const allHigh = Math.max(...candles.map(c => c.high));
      const allLow = Math.min(...candles.map(c => c.low));
      const distFromHigh = (price - allHigh) / allHigh * 100;

      // Trend skoru (-100..+100)
      let score = 0;
      if (price > eMv) score += 25; else score -= 25;
      if (eFv > eMv) score += 20; else score -= 20;
      if (eMv > eSv) score += 20; else score -= 20;
      score += Math.max(-15, Math.min(15, eMslope * 30));
      if (rsiV > 75) score -= 8;
      if (rsiV < 25) score += 8;

      // Üst TF trendi (opsiyonel)
      let htfBullish = null, htfBearish = null, htfPriceAboveEma50 = null;
      if (htf !== 'none') {
        try {
          const hc = await this.fetchCandles(symbol, htf, 120, market);
          const hcloses = hc.map(c => c.close);
          const hn = hcloses.length;
          const he20 = ema(hcloses, 20)[hn - 1];
          const he50 = ema(hcloses, 50)[hn - 1];
          const hp = hcloses[hn - 1];
          htfPriceAboveEma50 = hp > he50;
          htfBullish = hp > he20 && he20 > he50;
          htfBearish = hp < he20 && he20 < he50;
        } catch (e) { /* htf opsiyonel */ }
      }

      return {
        base,
        pair: this.toPair(symbol, market),
        timeframe,
        market,
        price,
        score: Math.round(score),
        rsi: +(rsiV.toFixed(1)),
        rsiRising: rsiArr[n - 1] > (rsiArr[n - 4] || rsiV),
        rsiFalling: rsiArr[n - 1] < (rsiArr[n - 4] || rsiV),
        macdHist: +((macdArr.histogram[n - 1] || 0).toPrecision(4)),
        macdLine: +((macdArr.line[n - 1] || 0).toPrecision(4)),
        macdRising: (macdArr.histogram[n - 1] || 0) > (macdArr.histogram[n - 3] || 0),
        macdFalling: (macdArr.histogram[n - 1] || 0) < (macdArr.histogram[n - 3] || 0),
        stochK: +((stoch.k[n - 1] || 0).toFixed(0)),
        stochD: +((stoch.d[n - 1] || 0).toFixed(0)),
        stochCrossUp: (stoch.k[n - 1] || 0) > (stoch.d[n - 1] || 0) && (stoch.k[n - 2] || 0) <= (stoch.d[n - 2] || 0),
        adx: +((adxArr.adx[n - 1] || 0).toFixed(1)),
        plusDI: +plusDI.toFixed(1),
        minusDI: +minusDI.toFixed(1),
        bbPos: +bbPos.toFixed(2),
        atrPct: +(atrV / price * 100).toFixed(2),
        volumeRatio: +(volSma[n - 1] ? candles[n - 1].volume / volSma[n - 1] : 1).toFixed(2),
        momPct: +momPct.toFixed(2),
        rangePos: +rangePos.toFixed(0),
        consecUp: Math.min(consecUp, 10),
        consecDn: Math.min(consecDn, 10),
        volBalance: +volBalance.toFixed(2),
        newHigh: price >= allHigh * 0.999,
        newLow: price <= allLow * 1.001,
        distFromHigh: +distFromHigh.toFixed(2),
        aboveEmaF: price > eFv,
        belowEmaF: price < eFv,
        aboveEmaM: price > eMv,
        belowEmaM: price < eMv,
        emaFastOverMid: eFv > eMv,
        emaFastUnderMid: eFv < eMv,
        emaMidOverSlow: eMv > eSv,
        emaMidUnderSlow: eMv < eSv,
        diBull: plusDI > minusDI,
        diBear: minusDI > plusDI,
        pctFromEmaF: +(((price - eFv) / eFv) * 100).toFixed(2),
        pctFromEmaM: +(((price - eMv) / eMv) * 100).toFixed(2),
        htfBullish,
        htfBearish,
        htfPriceAboveEma50
      };
    } catch (e) {
      return null;
    }
  }

  buildPlan(direction, price, atr, support, resistance, resistances, supports, ema20, ema50) {
    const atrPct = atr / price;
    // Minimum stop: %0.4, maksimum: %4 (volatiliteye göre ATR bazlı)
    const slDist = Math.max(atr * 1.5, price * 0.004);
    const maxSlDist = price * 0.04;

    if (direction === 'BEKLE') {
      return {
        action: 'BEKLE — Net sinyal yetersiz. Fiyat destek/direnç bölgesine gelene kadar izleyin.',
        entry: null, stopLoss: null, targets: [], riskReward: null
      };
    }

    const isLong = direction === 'LONG';
    const sign = isLong ? 1 : -1;

    // Giriş: trend yönünde geri çekilme (pullback) seviyesi — güncel fiyat DEĞİL, limit emir seviyesi
    let entry = price;
    let entryType = 'Piyasa';
    const maxPullback = atr * 1.5;
    const candidates = [];
    if (isLong) {
      supports.forEach(s => { if (s.price < price && price - s.price <= maxPullback) candidates.push(s.price); });
      if (ema20 < price && price - ema20 <= maxPullback) candidates.push(ema20);
      if (candidates.length) { entry = Math.max(...candidates); entryType = 'Limit (Geri Çekilme)'; }
    } else {
      resistances.forEach(r => { if (r.price > price && r.price - price <= maxPullback) candidates.push(r.price); });
      if (ema20 > price && ema20 - price <= maxPullback) candidates.push(ema20);
      if (candidates.length) { entry = Math.min(...candidates); entryType = 'Limit (Geri Çekilme)'; }
    }
    // Giriş bölgesi: ±0.15 ATR
    const zoneW = atr * 0.15;
    const entryZone = [+ (entry - zoneW).toFixed(8), +(entry + zoneW).toFixed(8)];

    // Stop-Loss: ATR bazlı ama yapı seviyesinin de ötesinde olsun
    let slByAtr = entry - sign * slDist;
    let stopLoss;
    if (isLong) {
      const belowSupports = supports.filter(s => s.price < entry - atr * 0.5).map(s => s.price);
      const structSl = belowSupports.length ? Math.min(...belowSupports) - atr * 0.3 : slByAtr;
      stopLoss = Math.max(structSl, slByAtr);
      if (entry - stopLoss > maxSlDist) stopLoss = entry - maxSlDist;
      if (entry - stopLoss < price * 0.001) stopLoss = entry - price * 0.001;
    } else {
      const aboveRes = resistances.filter(r => r.price > entry + atr * 0.5).map(r => r.price);
      const structSl = aboveRes.length ? Math.max(...aboveRes) + atr * 0.3 : slByAtr;
      stopLoss = Math.min(structSl, slByAtr);
      if (stopLoss - entry > maxSlDist) stopLoss = entry + maxSlDist;
      if (stopLoss - entry < price * 0.001) stopLoss = entry + price * 0.001;
    }

    const risk = Math.abs(entry - stopLoss);

    // Hedefler: 1.5R, 2.5R, 3.5R — yapısal seviyelerle desteklenir, her biri farklı seviye
    const structPrices = (isLong
      ? resistances.map(r => r.price).sort((a, b) => a - b)
      : supports.map(s => s.price).sort((a, b) => b - a));
    const usedStructs = new Set();
    const targets = [];

    [1.5, 2.5, 3.5].forEach((r, i) => {
      const tpByR = entry + sign * risk * r;
      // tpByR'e en yakın, henüz kullanılmamış ve yön doğrultusunda olan yapısal seviye
      let best = null, bestDiff = Infinity;
      for (const l of structPrices) {
        if (usedStructs.has(l)) continue;
        const beyond = isLong ? l > entry + risk : l < entry - risk;
        if (!beyond) continue;
        const diff = Math.abs(l - tpByR);
        if (diff < bestDiff) { bestDiff = diff; best = l; }
      }
      let tp = tpByR, type = 'R-Çarpanı';
      if (best !== null && bestDiff <= risk * 1.0) {
        tp = best;
        type = 'Yapısal Seviye';
        usedStructs.add(best);
      }
      targets.push({
        name: `TP${i + 1}`,
        price: +tp.toFixed(8),
        rr: +(Math.abs(tp - entry) / risk).toFixed(1),
        type
      });
    });

    // Kısmi çıkış önerisi
    const suggestion = `${entryType === 'Limit (Geri Çekilme)'
      ? `Fiyat ${entryType === 'Limit (Geri Çekilme)' && isLong ? 'destek/EMA20 bölgesine' : 'direnç/EMA20 bölgesine'} geri çekilirse ${entryZone[0].toPrecision(6)} - ${entryZone[1].toPrecision(6)} aralığına LİMİT AL emri koy.`
      : `Giriş ${entry.toPrecision(6)} civarı (piyasa emri).`} Stop ${stopLoss.toPrecision(6)} (%${(risk / entry * 100).toFixed(2)} risk). TP1'de %50 kapat, stop'u girişe çek (break-even), TP2'de %30, TP3'te kalan %20.`;

    return {
      action: direction === 'LONG' ? 'AL (Long)' : 'SAT (Short)',
      entry: +entry.toFixed(8),
      entryType,
      entryZone,
      stopLoss: +stopLoss.toFixed(8),
      riskPct: +(risk / entry * 100).toFixed(2),
      targets,
      riskReward: targets[1].rr,
      suggestion
    };
  }
}

module.exports = new CoinAnalyzer();
