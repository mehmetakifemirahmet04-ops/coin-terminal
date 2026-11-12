const express = require('express');
const path = require('path');
const analyzer = require('./analyzer');

const app = express();
const port = process.env.PORT || 3001;

app.use(express.json());
app.use(express.static('public'));

// Analiz edilen zaman dilimleri ve ağırlıkları (yüksek TF daha ağır basar)
const TIMEFRAMES = ['15m', '1h', '4h', '1d', '1w'];
const TF_WEIGHT = { '15m': 1, '1h': 2, '4h': 3, '1d': 4, '1w': 5 };

// Coin listesi cache (5 dk)
let coinsCache = { data: null, ts: 0 };

async function getTopCoins(market = 'spot') {
  if (coinsCache.data && coinsCache.market === market && Date.now() - coinsCache.ts < 5 * 60 * 1000) return coinsCache.data;
  const STABLES = new Set(['USDC','FDUSD','TUSD','USDP','DAI','USD1','USDE','USDD','BUSD','EUR','AEUR','XUSD','USDS','USDT']);
  const ex = analyzer.ex(market);
  const tickers = await ex.fetchTickers();
  const suffix = market === 'future' ? '/USDT:USDT' : '/USDT';
  const coins = Object.values(tickers)
    .filter(t => t.symbol && t.symbol.endsWith(suffix) && t.quoteVolume > 1_000_000)
    .map(t => ({
      symbol: t.symbol.split('/')[0],
      pair: t.symbol,
      price: t.last,
      change24h: t.percentage,
      volume24h: t.quoteVolume
    }))
    .filter(c => !STABLES.has(c.symbol))
    .sort((a, b) => b.volume24h - a.volume24h)
    .slice(0, 300);
  coinsCache = { data: coins, ts: Date.now(), market };
  return coins;
}

// Ana analiz: tüm zaman dilimlerini paralel analiz et
app.get('/api/analyze', async (req, res) => {
  try {
    const symbol = req.query.symbol;
    const market = req.query.market === 'future' ? 'future' : 'spot';
    if (!symbol) return res.status(400).json({ success: false, message: 'symbol parametresi gerekli' });

    const results = await Promise.all(
      TIMEFRAMES.map(tf =>
        analyzer.analyze(symbol, tf, market)
          .then(d => ({ tf, ok: true, data: d }))
          .catch(e => ({ tf, ok: false, error: e.message }))
      )
    );

    const analyses = {};
    results.forEach(r => { if (r.ok) analyses[r.tf] = r.data; });
    const price = results.find(r => r.ok)?.data.price;

    // Ağırlıklı genel oy
    let score = 0, weightSum = 0, confSum = 0, confW = 0;
    const votes = { LONG: 0, SHORT: 0, BEKLE: 0 };
    TIMEFRAMES.forEach(tf => {
      const a = analyses[tf];
      if (!a) return;
      const w = TF_WEIGHT[tf];
      const dirScore = a.direction === 'LONG' ? 1 : a.direction === 'SHORT' ? -1 : 0;
      score += dirScore * w * (a.confidence / 100);
      weightSum += w;
      votes[a.direction] = (votes[a.direction] || 0) + 1;
      if (a.direction !== 'BEKLE') {
        confSum += a.confidence * w;
        confW += w;
      }
    });

    const normalized = weightSum ? score / weightSum : 0;
    const overallDirection = normalized >= 0.15 ? 'LONG' : normalized <= -0.15 ? 'SHORT' : 'BEKLE';
    const overallConfidence = confW ? Math.round(confSum / confW) : 50;

    // İşlem planı: genel yönle uyumlu en yüksek TF'nin planını kullan
    const tfOrder = [...TIMEFRAMES].reverse(); // 1w → 15m
    let planSource = null;
    for (const tf of tfOrder) {
      const a = analyses[tf];
      if (a && a.direction === overallDirection && a.plan && a.plan.entry) { planSource = a; break; }
    }
    if (!planSource) {
      // yön BEKLE veya plan yoksa en yüksek TF analizi
      for (const tf of tfOrder) {
        const a = analyses[tf];
        if (a && a.plan) { planSource = a; break; }
      }
    }

    res.json({
      success: true,
      data: {
        symbol: analyzer.toPair(symbol.toUpperCase().includes('/') ? symbol.toUpperCase() : symbol.toUpperCase() + '/USDT', market),
        market: results.find(r => r.ok)?.data.market || market,
        price,
        timestamp: new Date().toISOString(),
        analyses,
        overall: {
          direction: overallDirection,
          confidence: overallConfidence,
          score: +normalized.toFixed(2),
          votes,
          planTf: planSource ? TIMEFRAMES.find(tf => analyses[tf] === planSource) : null,
          plan: planSource ? planSource.plan : null
        }
      }
    });
  } catch (error) {
    console.error('Analiz hatası:', error.message);
    res.status(400).json({ success: false, message: error.message });
  }
});

// Hafif grafik endpoint'i (TF değiştirince)
app.get('/api/chart', async (req, res) => {
  try {
    const symbol = req.query.symbol;
    const timeframe = req.query.timeframe || '1h';
    const market = req.query.market === 'future' ? 'future' : 'spot';
    const data = await analyzer.chartData(symbol, timeframe, 300, market);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// En güncel (oluşmakta olan) mum — grafik canlı güncellemesi için
app.get('/api/candle', async (req, res) => {
  try {
    const symbol = req.query.symbol;
    const timeframe = req.query.timeframe || '1h';
    const market = req.query.market === 'future' ? 'future' : 'spot';
    if (!symbol) return res.status(400).json({ success: false, message: 'symbol gerekli' });
    const pair = analyzer.toPair(symbol, market);
    const ohlcv = await analyzer.ex(market).fetchOHLCV(pair, timeframe, undefined, 2);
    const c = ohlcv[ohlcv.length - 1];
    res.json({
      success: true,
      data: { time: Math.floor(c[0] / 1000), open: c[1], high: c[2], low: c[3], close: c[4] }
    });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

// Piyasa tarayıcı — coinleri yükseliş/düşüş/nötr diye ayırır
let scanCache = { data: null, ts: 0, market: null };
app.get('/api/scan', async (req, res) => {
  try {
    const market = req.query.market === 'future' ? 'future' : 'spot';
    const limit = Math.min(parseInt(req.query.limit || '40', 10), 60);

    if (scanCache.data && scanCache.market === market && Date.now() - scanCache.ts < 60 * 1000) {
      return res.json({ success: true, data: scanCache.data, cached: true });
    }

    const coins = (await getTopCoins(market)).slice(0, limit);
    const results = [];
    // Eşzamanlılık sınırı: 6'şar
    const CONC = 6;
    for (let i = 0; i < coins.length; i += CONC) {
      const batch = coins.slice(i, i + CONC);
      const out = await Promise.all(batch.map(c => analyzer.scanTrend(c.symbol, market)));
      results.push(...out.filter(Boolean));
    }

    const up = results.filter(r => r.label === 'YÜKSELİŞ').sort((a, b) => b.score - a.score);
    const down = results.filter(r => r.label === 'DÜŞÜŞ').sort((a, b) => a.score - b.score);
    const neutral = results.filter(r => r.label === 'NÖTR').sort((a, b) => Math.abs(b.score) - Math.abs(a.score));

    const data = {
      market,
      scanned: results.length,
      up, down, neutral,
      timestamp: new Date().toISOString()
    };
    scanCache = { data, ts: Date.now(), market };
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Sayısal göstergeler
const SCREEN_METRICS = {
  rsi: c => c.rsi,
  macd: c => c.macdHist,
  stoch: c => c.stochK,
  adx: c => c.adx,
  volume: c => c.volumeRatio,
  atrPct: c => c.atrPct,
  bbPos: c => c.bbPos,
  momPct: c => c.momPct,
  rangePos: c => c.rangePos,
  volBalance: c => c.volBalance,
  distFromHigh: c => c.distFromHigh,
  pctEmaF: c => c.pctFromEmaF,
  pctEmaM: c => c.pctFromEmaM,
  pctEma20: c => c.pctFromEmaF,
  pctEma50: c => c.pctFromEmaM,
  change24h: c => c.change24h || 0,
  score: c => c.score,
  consecUp: c => c.consecUp,
  consecDn: c => c.consecDn
};
// Boolean (doğru/yanlış) göstergeler
const SCREEN_BOOL = {
  aboveEmaF: 'Fiyat > Hızlı EMA',
  belowEmaF: 'Fiyat < Hızlı EMA',
  aboveEmaM: 'Fiyat > Orta EMA',
  belowEmaM: 'Fiyat < Orta EMA',
  emaFastOverMid: 'Hızlı EMA > Orta EMA',
  emaFastUnderMid: 'Hızlı EMA < Orta EMA',
  emaMidOverSlow: 'Orta EMA > Yavaş EMA',
  emaMidUnderSlow: 'Orta EMA < Yavaş EMA',
  diBull: '+DI > -DI (alıcılar baskın)',
  diBear: '-DI > +DI (satıcılar baskın)',
  rsiRising: 'RSI yükseliyor',
  rsiFalling: 'RSI düşüyor',
  macdRising: 'MACD histogramı güçleniyor',
  macdFalling: 'MACD histogramı zayıflıyor',
  stochCrossUp: 'Stokastik yukarı kesişim',
  newHigh: 'Yeni tepe bölgesinde',
  newLow: 'Yeni dip bölgesinde',
  htfBullish: 'Üst TF boğa dizilimi',
  htfBearish: 'Üst TF ayı dizilimi',
  htfPriceAboveEma50: 'Üst TF fiyat > EMA50'
};

function evalCondition(c, cond) {
  const ind = cond.indicator;
  if (SCREEN_BOOL[ind]) return c[ind] === true;
  const metric = SCREEN_METRICS[ind];
  if (!metric) return false;
  const v = metric(c);
  if (cond.cond === 'between') {
    const parts = String(cond.value || '').split(',').map(Number);
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      return v >= Math.min(parts[0], parts[1]) && v <= Math.max(parts[0], parts[1]);
    }
    return false;
  }
  const target = parseFloat(cond.value || '0');
  if (cond.cond === 'lt') return v < target;
  if (cond.cond === 'gt') return v > target;
  return false;
}

app.get('/api/screen', async (req, res) => {
  try {
    const market = req.query.market === 'future' ? 'future' : 'spot';
    const timeframe = req.query.timeframe || '4h';
    const limit = Math.min(parseInt(req.query.limit || '60', 10), 150);
    const sortBy = req.query.sort || 'volume';
    let params = {}, htf = 'none';
    try { params = JSON.parse(req.query.params || '{}'); } catch (e) { /* default */ }
    htf = ['1d', '1w', '4h'].includes(req.query.htf) ? req.query.htf : 'none';

    // Koşullar: conditions[] JSON veya eski tekil parametreler
    let conditions = [];
    if (req.query.conditions) {
      try { conditions = JSON.parse(req.query.conditions); } catch (e) { /* yoksay */ }
    }
    if (!conditions.length && req.query.indicator) {
      conditions = [{ indicator: req.query.indicator, cond: req.query.cond || 'lt', value: req.query.value || '0' }];
    }
    // Geçersiz koşulları temizle
    conditions = conditions.filter(c => SCREEN_BOOL[c.indicator] || SCREEN_METRICS[c.indicator]);

    const coins = (await getTopCoins(market)).slice(0, limit);
    const results = [];
    const CONC = 6;
    for (let i = 0; i < coins.length; i += CONC) {
      const batch = coins.slice(i, i + CONC);
      const out = await Promise.all(batch.map(c => analyzer.screenCoin(c.symbol, timeframe, market, params, htf)));
      results.push(...out.filter(Boolean));
    }

    // 24s değişim ve hacim bilgisini ticker'dan ekle
    const coinMap = new Map(coins.map(c => [c.symbol.split('/')[0], c]));
    results.forEach(r => {
      const t = coinMap.get(r.base);
      if (t) { r.change24h = t.change24h; r.volume24h = t.volume24h; }
    });

    let matches = conditions.length
      ? results.filter(c => conditions.every(cond => evalCondition(c, cond)))
      : results;

    // Sıralama
    if (sortBy === 'score') matches.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
    else if (sortBy === 'rsi') matches.sort((a, b) => a.rsi - b.rsi);
    else if (sortBy === 'volumeRatio') matches.sort((a, b) => b.volumeRatio - a.volumeRatio);
    else if (sortBy === 'change24h') matches.sort((a, b) => (b.change24h || 0) - (a.change24h || 0));
    // 'volume' = orijinal hacim sırası (değişiklik yok)

    res.json({
      success: true,
      data: {
        matches,
        scanned: results.length,
        conditions,
        params: { timeframe, market, sortBy, htf },
        timestamp: new Date().toISOString()
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Kripto haberleri — RSS kaynakları (CoinTelegraph + CoinDesk)
const Parser = require('rss-parser');
const rssParser = new Parser({ timeout: 15000 });
const NEWS_FEEDS = [
  { url: 'https://cointelegraph.com/rss', source: 'CoinTelegraph' },
  { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', source: 'CoinDesk' }
];

app.get('/api/news', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '30', 10), 60);
    const feeds = await Promise.all(NEWS_FEEDS.map(async f => {
      try {
        const parsed = await rssParser.parseURL(f.url);
        return (parsed.items || []).map(it => ({
          title: (it.title || '').replace(/<!\[CDATA\[|\]\]>/g, ''),
          url: it.link,
          source: f.source,
          image: it.enclosure?.url || null,
          body: (it.contentSnippet || it.content || '').replace(/<[^>]+>/g, '').slice(0, 300),
          published: it.isoDate ? new Date(it.isoDate).getTime() : Date.now()
        }));
      } catch (e) { return []; }
    }));
    const news = feeds.flat()
      .filter(n => n.title && n.url)
      .sort((a, b) => b.published - a.published)
      .slice(0, limit);
    res.json({ success: true, data: news });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Canlı fiyat (hafif endpoint — frontend 5sn'de bir çağırır)
app.get('/api/price', async (req, res) => {
  try {
    const symbol = req.query.symbol;
    const market = req.query.market === 'future' ? 'future' : 'spot';
    if (!symbol) return res.status(400).json({ success: false, message: 'symbol gerekli' });
    const pair = analyzer.toPair(symbol, market);
    const ticker = await analyzer.ex(market).fetchTicker(pair);
    res.json({ success: true, data: { symbol: pair, price: ticker.last, change24h: ticker.percentage, high24h: ticker.high, low24h: ticker.low } });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

// Coin listesi
app.get('/api/coins', async (req, res) => {
  try {
    const market = req.query.market === 'future' ? 'future' : 'spot';
    const coins = await getTopCoins(market);
    res.json({ success: true, data: coins });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/news', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'news.html'));
});

const os = require('os');

// Telefon/diğer cihazlardan erişim için tüm arayüzlerde dinle
app.listen(port, '0.0.0.0', () => {
  console.log(`\n📊 Coin Analiz Terminali → http://localhost:${port}`);
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`📱 Telefon için: http://${net.address}:${port}  (aynı WiFi'da olmalı)`);
      }
    }
  }
  console.log('');
});
