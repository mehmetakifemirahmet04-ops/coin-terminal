const TelegramBot = require('node-telegram-bot-api');
const analyzer = require('./analyzer');
const { createCanvas } = require('canvas');
const express = require('express');

const token = '9200212432:AAEwwcpcrxrTUYadcrW2YWWwShUQn1vyYaM';
const bot = new TelegramBot(token, { polling: true });

const MARKET = 'future'; // Vadeli piyasada analiz yap

// Alarm sistemi
const userAlerts = new Map(); // chatId -> { coins: [], enabled: false, interval: 5 (minutes) }
const alertIntervals = new Map(); // chatId -> intervalId

// Kullanıcı state yönetimi (seçili coin, zaman dilimi)
const userStates = new Map(); // chatId -> { selectedCoin, selectedTf }

// Dummy HTTP server for Render port requirement
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
  res.send('🤖 Coin Analiz Bot çalışıyor!');
});

app.listen(PORT, () => {
  console.log(`HTTP server port ${PORT} üzerinde çalışıyor (Render için)`);
});

// Grafik çizme fonksiyonu
async function drawChart(candles, ema20, ema50, ema200, supports, resistances, symbol) {
  const width = 800;
  const height = 400;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Arka plan
  ctx.fillStyle = '#131722';
  ctx.fillRect(0, 0, width, height);

  if (!candles || candles.length === 0) return canvas.toBuffer();

  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const maxPrice = Math.max(...highs, ...ema20, ...ema50, ...ema200);
  const minPrice = Math.min(...lows, ...ema20, ...ema50, ...ema200);
  const priceRange = maxPrice - minPrice;

  const scaleY = (price) => height - 40 - ((price - minPrice) / priceRange) * (height - 80);
  const scaleTime = (i) => 20 + (i / (candles.length - 1)) * (width - 40);

  // Destek/Direnç çizgileri
  ctx.lineWidth = 1;
  supports.slice(0, 3).forEach(s => {
    const y = scaleY(s.price || s);
    ctx.strokeStyle = '#089981';
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(20, y);
    ctx.lineTo(width - 20, y);
    ctx.stroke();
  });
  resistances.slice(0, 3).forEach(r => {
    const y = scaleY(r.price || r);
    ctx.strokeStyle = '#f23645';
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(20, y);
    ctx.lineTo(width - 20, y);
    ctx.stroke();
  });
  ctx.setLineDash([]);

  // EMA çizgileri
  ctx.lineWidth = 1.5;
  [ema20, ema50, ema200].forEach((ema, idx) => {
    const colors = ['#2962ff', '#f0b90b', '#787b86'];
    ctx.strokeStyle = colors[idx];
    ctx.beginPath();
    ema.forEach((val, i) => {
      const x = scaleTime(i);
      const y = scaleY(val);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });

  // Mumlar
  const candleWidth = (width - 40) / candles.length * 0.7;
  candles.forEach((c, i) => {
    const x = scaleTime(i);
    const openY = scaleY(c.open);
    const closeY = scaleY(c.close);
    const highY = scaleY(c.high);
    const lowY = scaleY(c.low);

    const isGreen = c.close >= c.open;
    ctx.fillStyle = isGreen ? '#089981' : '#f23645';
    ctx.strokeStyle = isGreen ? '#089981' : '#f23645';

    // Wick
    ctx.beginPath();
    ctx.moveTo(x, highY);
    ctx.lineTo(x, lowY);
    ctx.stroke();

    // Body
    const bodyTop = Math.min(openY, closeY);
    const bodyHeight = Math.abs(closeY - openY);
    ctx.fillRect(x - candleWidth / 2, bodyTop, candleWidth, Math.max(bodyHeight, 1));
  });

  // Başlık
  ctx.fillStyle = '#d1d4dc';
  ctx.font = 'bold 16px Arial';
  ctx.fillText(symbol, 20, 25);

  return canvas.toBuffer();
}

// Coin eşleşmeleri (kısa isim -> tam sembol)
const COIN_MAP = {
  'btc': 'BTC/USDT',
  'eth': 'ETH/USDT',
  'sol': 'SOL/USDT',
  'bnb': 'BNB/USDT',
  'xrp': 'XRP/USDT',
  'ada': 'ADA/USDT',
  'doge': 'DOGE/USDT',
  'avax': 'AVAX/USDT',
  'dot': 'DOT/USDT',
  'matic': 'MATIC/USDT',
  'link': 'LINK/USDT',
  'ltc': 'LTC/USDT',
  'uni': 'UNI/USDT',
  'atom': 'ATOM/USDT',
  'etc': 'ETC/USDT',
  'xlm': 'XLM/USDT',
  'algo': 'ALGO/USDT',
  'vet': 'VET/USDT',
  'fil': 'FIL/USDT',
  'near': 'NEAR/USDT',
  'ape': 'APE/USDT',
  'sand': 'SAND/USDT',
  'man': 'MANA/USDT',
  'axs': 'AXS/USDT',
  'ftm': 'FTM/USDT',
  'rose': 'ROSE/USDT',
  'gmt': 'GMT/USDT',
  'hbar': 'HBAR/USDT',
  'icp': 'ICP/USDT',
  'flow': 'FLOW/USDT',
  'qnt': 'QNT/USDT',
  'eos': 'EOS/USDT',
  'waves': 'WAVES/USDT',
  'xtz': 'XTZ/USDT',
  'kava': 'KAVA/USDT',
  'comp': 'COMP/USDT',
  'aave': 'AAVE/USDT',
  'maker': 'MKR/USDT',
  'sushi': 'SUSHI/USDT',
  'crv': 'CRV/USDT',
  'snx': 'SNX/USDT',
  'yfi': 'YFI/USDT',
  '1inch': '1INCH/USDT',
  'enj': 'ENJ/USDT',
  'theta': 'THETA/USDT',
  'kas': 'KAS/USDT',
  'stx': 'STX/USDT',
  'gala': 'GALA/USDT',
  'imx': 'IMX/USDT',
  'min': 'MINA/USDT',
  'celo': 'CELO/USDT',
  'hel': 'HFT/USDT',
  'sui': 'SUI/USDT',
  'sei': 'SEI/USDT',
  'tia': 'TIA/USDT',
  'bonk': 'BONK/USDT',
  'pepe': 'PEPE/USDT',
  'shib': 'SHIB/USDT',
  'floki': 'FLOKI/USDT',
  'wif': 'WIF/USDT',
  'bome': 'BOME/USDT',
  'orfi': 'ORFI/USDT',
  'rndr': 'RNDR/USDT',
  'fetc': 'FET/USDT',
  'ocean': 'OCEAN/USDT',
  'ark': 'ARK/USDT',
  'lunc': 'LUNC/USDT',
  'tru': 'TRU/USDT',
  'jupiter': 'JUP/USDT',
  'pyth': 'PYTH/USDT',
  'jto': 'JTO/USDT',
  'ray': 'RAY/USDT',
  'whif': 'WIF/USDT',
  'bga': 'BGA/USDT',
  'mog': 'MOG/USDT',
  'mil': 'MIL/USDT',
  'pop': 'POP/USDT',
  'taco': 'TACO/USDT',
  'deg': 'DEG/USDT',
  'higg': 'HIGG/USDT',
  'base': 'BASE/USDT',
  'evaa': 'EVAA/USDT',
  'ake': 'AKE/USDT',
  'soph': 'SOPH/USDT',
  'init': 'INIT/USDT',
  'koru': 'KORU/USDT',
  'spcx': 'SPCX/USDT',
  'mu': 'MU/USDT',
  '1000pepe': '1000PEPE/USDT',
  'inj': 'INJ/USDT',
  'soxs': 'SOXS/USDT'
};

// Başlangıç mesajı
bot.onText(/\/start/i, (msg) => {
  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: '🔍 TARA', callback_data: 'scan' },
        { text: '📋 LİSTE', callback_data: 'list' }
      ],
      [
        { text: '🔔 ALARM', callback_data: 'alarm_toggle' }
      ],
      [
        { text: 'BTC', callback_data: 'analyze_BTC' },
        { text: 'ETH', callback_data: 'analyze_ETH' },
        { text: 'SOL', callback_data: 'analyze_SOL' }
      ],
      [
        { text: 'BNB', callback_data: 'analyze_BNB' },
        { text: 'XRP', callback_data: 'analyze_XRP' },
        { text: 'ADA', callback_data: 'analyze_ADA' }
      ]
    ]
  };

  const replyKeyboard = {
    keyboard: [
      ['🔍 TARA', '📋 LİSTE', '🔔 ALARM'],
      ['BTC', 'ETH', 'SOL'],
      ['BNB', 'XRP', 'ADA'],
      ['15m', '1h', '4h', '1d']
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  };

  bot.sendMessage(msg.chat.id, `
🤖 *Coin Analiz Bot*

Kullanım:
/btc - BTC detaylı analizini göster
/eth - ETH detaylı analizini göster
/tara - Piyasa tarayıcı (ilk 40 coin)
/liste - Desteklenen coinleri göster
/alarm - Otomatik alarm aç/kapa

Bot vadeli piyasada (Binance Futures) analiz yapar.
  `, { parse_mode: 'Markdown', reply_markup: inlineKeyboard });

  bot.sendMessage(msg.chat.id, '⌨️ Klavye butonları aktif:', { reply_markup: replyKeyboard });
});

// Alarm komutları
bot.onText(/\/alarm/i, (msg) => {
  const chatId = msg.chat.id;
  const alert = userAlerts.get(chatId) || { coins: ['BTC', 'ETH', 'SOL'], enabled: false, interval: 5 };

  const status = alert.enabled ? '🟢 AÇIK' : '🔴 KAPALI';
  const coinsText = alert.coins.join(', ');

  bot.sendMessage(chatId, `
🔔 *Alarm Durumu*

Durum: ${status}
Coinler: ${coinsText}
Kontrol aralığı: ${alert.interval} dakika

Komutlar:
/alarm aç - Alarmı başlat
/alarm kapat - Alarmı durdur
/alarm ekle BTC,ETH,SOL - Coin ekle
/alarm sil BTC - Coin çıkar
/alarm aralık 10 - Kontrol aralığı (dakika)
  `, { parse_mode: 'Markdown' });
});

bot.onText(/\/alarm\s+aç/i, (msg) => {
  const chatId = msg.chat.id;
  const alert = userAlerts.get(chatId) || { coins: ['BTC', 'ETH', 'SOL'], enabled: false, interval: 5 };
  alert.enabled = true;
  userAlerts.set(chatId, alert);

  startAlertCheck(chatId);
  bot.sendMessage(chatId, '🔔 Alarm AÇIK! Her ' + alert.interval + ' dakikada bir kontrol edilecek.');
});

bot.onText(/\/alarm\s+kapat/i, (msg) => {
  const chatId = msg.chat.id;
  const alert = userAlerts.get(chatId) || { coins: ['BTC', 'ETH', 'SOL'], enabled: false, interval: 5 };
  alert.enabled = false;
  userAlerts.set(chatId, alert);

  stopAlertCheck(chatId);
  bot.sendMessage(chatId, '🔔 Alarm KAPALI!');
});

bot.onText(/\/alarm\s+ekle\s+(.+)/i, (msg, match) => {
  const chatId = msg.chat.id;
  const coins = match[1].toUpperCase().split(',').map(c => c.trim());
  const alert = userAlerts.get(chatId) || { coins: ['BTC', 'ETH', 'SOL'], enabled: false, interval: 5 };

  coins.forEach(c => {
    if (COIN_MAP[c.toLowerCase()] && !alert.coins.includes(c)) {
      alert.coins.push(c);
    }
  });

  userAlerts.set(chatId, alert);
  bot.sendMessage(chatId, `✅ Coinler eklendi: ${alert.coins.join(', ')}`);
});

bot.onText(/\/alarm\s+sil\s+(.+)/i, (msg, match) => {
  const chatId = msg.chat.id;
  const coin = match[1].toUpperCase();
  const alert = userAlerts.get(chatId) || { coins: ['BTC', 'ETH', 'SOL'], enabled: false, interval: 5 };

  alert.coins = alert.coins.filter(c => c !== coin);
  userAlerts.set(chatId, alert);
  bot.sendMessage(chatId, `✅ Coin silindi: ${coin}. Kalan: ${alert.coins.join(', ')}`);
});

bot.onText(/\/alarm\s+aralık\s+(\d+)/i, (msg, match) => {
  const chatId = msg.chat.id;
  const interval = parseInt(match[1]);
  const alert = userAlerts.get(chatId) || { coins: ['BTC', 'ETH', 'SOL'], enabled: false, interval: 5 };

  if (interval < 1 || interval > 60) {
    bot.sendMessage(chatId, '❌ Aralık 1-60 dakika arasında olmalı.');
    return;
  }

  alert.interval = interval;
  userAlerts.set(chatId, alert);

  if (alert.enabled) {
    stopAlertCheck(chatId);
    startAlertCheck(chatId);
  }

  bot.sendMessage(chatId, `✅ Kontrol aralığı: ${interval} dakika`);
});

// Alarm kontrol fonksiyonu
async function checkAlerts(chatId) {
  const alert = userAlerts.get(chatId);
  if (!alert || !alert.enabled) return;

  // Sadece 4h timeframe'i kontrol et (rate limit için)
  const timeframes = ['4h'];

  for (const coin of alert.coins) {
    try {
      const symbol = COIN_MAP[coin.toLowerCase()];
      if (!symbol) continue;

      // Rate limit için bekleme
      await new Promise(resolve => setTimeout(resolve, 3000));

      const results = [];
      for (const tf of timeframes) {
        try {
          const result = await analyzer.analyze(symbol, tf, MARKET);
          if (result) results.push({ tf, result });
        } catch (e) {
          console.error(`${coin} ${tf} hatası:`, e);
        }
      }

      // 4h'de AL sinyali mi?
      const isLong = results.length > 0 && results[0].result.direction === 'LONG';

      if (isLong) {
        const mainResult = results[0].result;
        const price = mainResult.price.toFixed(8);
        const conf = mainResult.confidence;

        const message = `
🚨 *ALARM: ${coin.toUpperCase()}*

💰 Fiyat: $${price}
📊 4h zaman diliminde AL sinyali!
🎯 Güven: %${conf}

/${coin.toLowerCase()} ile detaylı analizi gör.
`;

        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      }
    } catch (e) {
      console.error(`Alarm kontrol hatası (${coin}):`, e);
    }
  }
}

function startAlertCheck(chatId) {
  const alert = userAlerts.get(chatId);
  if (!alert) return;

  const intervalMs = alert.interval * 60 * 1000;

  // Mevcut interval varsa durdur
  stopAlertCheck(chatId);

  const intervalId = setInterval(() => {
    checkAlerts(chatId);
  }, intervalMs);

  alertIntervals.set(chatId, intervalId);
}

function stopAlertCheck(chatId) {
  const intervalId = alertIntervals.get(chatId);
  if (intervalId) {
    clearInterval(intervalId);
    alertIntervals.delete(chatId);
  }
}

// Inline buton callback handler
bot.on('callback_query', async (query) => {
  try {
    const action = query.data;
    const chatId = query.message.chat.id;

    if (action === 'scan') {
      await bot.answerCallbackQuery(query.id);
      await handleScan(chatId);
    } else if (action === 'list') {
      await bot.answerCallbackQuery(query.id);
      await handleList(chatId);
    } else if (action === 'alarm_toggle') {
      await bot.answerCallbackQuery(query.id);
      const alert = userAlerts.get(chatId) || { coins: ['BTC', 'ETH', 'SOL'], enabled: false, interval: 5 };
      alert.enabled = !alert.enabled;
      userAlerts.set(chatId, alert);

      if (alert.enabled) {
        startAlertCheck(chatId);
        await bot.sendMessage(chatId, '🔔 Alarm AÇIK! Her ' + alert.interval + ' dakikada bir kontrol edilecek.');
      } else {
        stopAlertCheck(chatId);
        await bot.sendMessage(chatId, '🔔 Alarm KAPALI!');
      }
    } else if (action.startsWith('analyze_')) {
      await bot.answerCallbackQuery(query.id);
      const coin = action.replace('analyze_', '').toLowerCase();
      const state = userStates.get(chatId) || {};
      state.selectedCoin = coin;
      userStates.set(chatId, state);
      await handleAnalyze(chatId, coin);
    } else if (action.startsWith('tf_')) {
      await bot.answerCallbackQuery(query.id);
      const tf = action.replace('tf_', '');
      const state = userStates.get(chatId) || {};

      if (state.selectedCoin) {
        await bot.sendMessage(chatId, `⏳ ${state.selectedCoin.toUpperCase()} ${tf} için analiz yapılıyor...`);
        await handleAnalyze(chatId, state.selectedCoin, tf);
      } else {
        await bot.sendMessage(chatId, `⏳ Önce bir coin seçin (BTC, ETH, SOL...), sonra zaman dilimine basın.`);
      }
    }
  } catch (error) {
    console.error('Callback hatası:', error);
    await bot.answerCallbackQuery(query.id, { text: 'Hata oluştu', show_alert: true });
  }
});

// Helper fonksiyonlar
async function handleScan(chatId) {
  await bot.sendMessage(chatId, `⏳ Piyasa taranıyor (ilk 40 coin)...`);

  try {
    const coins = Object.keys(COIN_MAP).slice(0, 40);
    const results = [];

    for (const coin of coins) {
      try {
        const symbol = COIN_MAP[coin];
        const trend = await analyzer.scanTrend(symbol, MARKET);
        if (trend) {
          results.push({ coin: coin.toUpperCase(), symbol, ...trend });
        }
      } catch (e) {
        console.error(`${coin} hatası:`, e);
      }
    }

    const bullish = results.filter(r => r.score > 15).sort((a, b) => b.score - a.score);
    const bearish = results.filter(r => r.score < -15).sort((a, b) => a.score - b.score);
    const neutral = results.filter(r => r.score >= -15 && r.score <= 15);

    let message = `📡 *Piyasa Tarayıcı*\n\n`;
    message += `🔵 *Yükseliş Eğilimli* (${bullish.length})\n\n`;
    bullish.slice(0, 10).forEach(r => {
      message += `${r.coin}: $${r.price.toFixed(8)} (Skor: +${r.score})\n`;
    });

    message += `\n🟡 *Nötr / Kararsız* (${neutral.length})\n\n`;
    neutral.slice(0, 10).forEach(r => {
      message += `${r.coin}: $${r.price.toFixed(8)} (Skor: ${r.score})\n`;
    });

    message += `\n🔴 *Düşüş Eğilimli* (${bearish.length})\n\n`;
    bearish.slice(0, 10).forEach(r => {
      message += `${r.coin}: $${r.price.toFixed(8)} (Skor: ${r.score})\n`;
    });

    message += `\n📊 ${results.length} coin tarandı ⏰ ${new Date().toLocaleTimeString('tr-TR')}`;

    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error('Tarama hatası:', error);
    await bot.sendMessage(chatId, `❌ Hata: ${error.message}`);
  }
}

async function handleList(chatId) {
  const major = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'AVAX', 'DOT', 'MATIC', 'LINK', 'LTC', 'UNI', 'ATOM', 'ETC', 'XLM', 'ALGO', 'VET', 'FIL', 'NEAR', 'APE', 'SAND', 'MANA', 'AXS', 'FTM', 'ROSE', 'GMT', 'HBAR', 'ICP', 'FLOW', 'QNT', 'EOS', 'WAVES', 'XTZ', 'KAVA', 'COMP', 'AAVE', 'MKR', 'SUSHI', 'CRV', 'SNX', 'YFI', '1INCH', 'ENJ', 'THETA', 'KAS', 'STX', 'GALA', 'IMX', 'MINA', 'CELO', 'HFT', 'SUI', 'SEI', 'TIA', 'BONK', 'PEPE', 'SHIB', 'FLOKI', 'WIF', 'BOME', 'ORFI', 'RNDR', 'FET', 'OCEAN', 'ARK', 'LUNC', 'TRU', 'JUP', 'PYTH', 'JTO', 'RAY'];
  const others = Object.keys(COIN_MAP).map(c => c.toUpperCase()).filter(c => !major.includes(c));

  let message = `📋 *Desteklenen Coinler:*\n\n`;
  message += `🔵 *Major Coinler:*\n${major.join(', ')}\n\n`;
  if (others.length) {
    message += `🟡 *Diğer Coinler:*\n${others.join(', ')}`;
  }

  await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
}

async function handleAnalyze(chatId, coin, specificTf = null) {
  const symbol = COIN_MAP[coin];

  if (!symbol) {
    await bot.sendMessage(chatId, `❌ '${coin.toUpperCase()}' bulunamadı. /liste ile desteklenen coinleri gör.`);
    return;
  }

  await bot.sendMessage(chatId, `⏳ ${symbol.toUpperCase()} analiz ediliyor...`);

  try {
    const timeframes = specificTf ? [specificTf] : ['15m', '1h', '4h', '1d', '1w'];
    const results = [];

    for (const tf of timeframes) {
      try {
        const result = await analyzer.analyze(symbol, tf, MARKET);
        if (result) results.push({ tf, result });
      } catch (e) {
        console.error(`${tf} hatası:`, e);
      }
    }

    if (!results.length) {
      await bot.sendMessage(chatId, `❌ ${symbol.toUpperCase()} verisi alınamadı.`);
      return;
    }

    const mainResult = results.find(r => r.tf === '4h')?.result || results[0].result;
    const plan = mainResult.plan;
    const ind = mainResult.indicators;

    let header = `
📊 *${mainResult.symbol.toUpperCase()} Analizi*

💰 Fiyat: $${typeof mainResult.price === 'number' ? mainResult.price.toFixed(8) : mainResult.price}
📈 Market: ${MARKET === 'future' ? 'Vadeli' : 'Spot'}

━━━━━━━━━━━━━━━━
*GENEL SİNYAL*
━━━━━━━━━━━━━━━━
`;

    const bullishCount = results.filter(r => r.result.direction === 'LONG').length;
    const bearishCount = results.filter(r => r.result.direction === 'SHORT').length;
    const neutralCount = results.filter(r => r.result.direction === 'BEKLE').length;

    header += `🟢 Boğa: ${bullishCount} TF | 🔴 Ayı: ${bearishCount} TF | ⚪ Nötr: ${neutralCount} TF\n\n`;

    const overallDirection = bullishCount >= 3 ? '🟢 AL' : bearishCount >= 3 ? '🔴 SAT' : '⚪ BEKLE';
    const avgConfidence = Math.round(results.reduce((sum, r) => sum + r.result.confidence, 0) / results.length);
    header += `*Genel Sinyal:* ${overallDirection} (Güven: %${avgConfidence})\n\n`;

    header += `━━━━━━━━━━━━━━━━\n*İŞLEM PLANI (4h)*\n━━━━━━━━━━━━━━━━\n`;

    if (plan.entry) {
      const entryVal = typeof plan.entry === 'number' ? plan.entry.toFixed(8) : plan.entry;
      header += `🎯 Giriş: $${entryVal} (${plan.entryType})\n`;
      header += `   Bölge: $${plan.entryZone[0]} - $${plan.entryZone[1]}\n`;
    } else {
      header += `🎯 Giriş: -\n`;
    }

    if (plan.stopLoss) {
      const stopVal = typeof plan.stopLoss === 'number' ? plan.stopLoss.toFixed(8) : plan.stopLoss;
      const riskPct = ((plan.entry - plan.stopLoss) / plan.entry * 100).toFixed(2);
      header += `🛑 Stop: $${stopVal} (%${riskPct} risk)\n`;
    } else {
      header += `🛑 Stop: -\n`;
    }

    if (plan.targets && plan.targets.length) {
      header += `📈 Hedefler:\n`;
      plan.targets.forEach((t, i) => {
        const val = typeof t === 'object' && t.price ? t.price : (typeof t === 'number' ? t : 0);
        const rr = typeof t === 'object' && t.rr ? t.rr : 0;
        header += `  TP${i + 1}: $${val.toFixed(8)} (R:${rr})\n`;
      });
    } else {
      header += `📈 Hedefler: -\n`;
    }

    if (plan.riskReward) {
      header += `⚖️ Risk/Ödül: 1:${plan.riskReward.toFixed(1)}\n`;
    }

    await bot.sendMessage(chatId, header, { parse_mode: 'Markdown' });

    // Grafik çiz ve gönder
    try {
      const chartCandles = mainResult.chart?.candles || [];
      const ema20 = mainResult.chart?.ema20 || [];
      const ema50 = mainResult.chart?.ema50 || [];
      const ema200 = mainResult.chart?.ema200 || [];
      const chartBuffer = await drawChart(chartCandles, ema20, ema50, ema200, mainResult.supports, mainResult.resistances, mainResult.symbol);
      await bot.sendPhoto(chatId, chartBuffer, { caption: `📊 ${mainResult.symbol.toUpperCase()} Grafiği (4h)` });
    } catch (e) {
      console.error('Grafik hatası:', e);
    }

    let matrix = `
━━━━━━━━━━━━━━━━
*ZAMAN DİLİMİ MATRİSİ*
━━━━━━━━━━━━━━━━
`;

    const tfLabels = { '15m': '15 Dakika', '1h': '1 Saat', '4h': '4 Saat', '1d': '1 Gün', '1w': '1 Hafta' };

    results.forEach(({ tf, result }) => {
      const direction = result.direction === 'LONG' ? '🟢 AL' : result.direction === 'SHORT' ? '🔴 SAT' : '⚪ BEKLE';
      const ind = result.indicators;
      const rsiVal = typeof ind.rsi === 'number' ? ind.rsi.toFixed(1) : ind.rsi;
      const macdVal = typeof ind.macdHist === 'number' ? ind.macdHist.toPrecision(4) : ind.macdHist;
      const macdArrow = ind.macdHist > 0 ? '▲' : '▼';
      const stochVal = typeof ind.stochK === 'number' ? ind.stochK.toFixed(0) : ind.stochK;
      const stochText = ind.stochK > 80 ? 'Aşırı Alım' : ind.stochK < 20 ? 'Aşırı Satım' : 'Normal';
      const adxVal = typeof ind.adx === 'number' ? ind.adx.toFixed(1) : ind.adx;
      const volVal = typeof ind.volumeRatio === 'number' ? ind.volumeRatio.toFixed(2) : ind.volumeRatio;
      const volText = ind.volumeRatio > 1.5 ? 'Yüksek' : ind.volumeRatio < 0.6 ? 'Düşük' : 'Normal';
      const htfText = ind.htfTrend || '-';
      const trendText = ind.regime || '-';

      matrix += `\n*${tfLabels[tf] || tf.toUpperCase()}*\n`;
      matrix += `Trend: ${trendText} | RSI: ${rsiVal} | MACD: ${macdArrow} ${macdVal}\n`;
      matrix += `Stokastik: ${stochText} (${stochVal}) | ADX: ${adxVal} | Hacim: ${volText} (${volVal}x)\n`;
      matrix += `Üst TF: ${htfText} | Sinyal: ${direction} (%${result.confidence})\n`;
    });

    await bot.sendMessage(chatId, matrix, { parse_mode: 'Markdown' });

    let srMsg = `
━━━━━━━━━━━━━━━━
*DESTEK / DİRENÇ*
━━━━━━━━━━━━━━━━

🟢 Destekler:
${mainResult.supports.slice(0, 5).map((s, i) => {
  const val = typeof s === 'number' ? s.toFixed(8) : s;
  return `  ${i + 1}. $${val}`;
}).join('\n') || '  -'}

🔴 Dirençler:
${mainResult.resistances.slice(0, 5).map((r, i) => {
  const val = typeof r === 'number' ? r.toFixed(8) : r;
  return `  ${i + 1}. $${val}`;
}).join('\n') || '  -'}

📍 En Yakın Destek: $${typeof ind.nearestSupport === 'number' ? ind.nearestSupport.toFixed(8) : ind.nearestSupport}
📍 En Yakın Direnç: $${typeof ind.nearestResistance === 'number' ? ind.nearestResistance.toFixed(8) : ind.nearestResistance}
`;

    await bot.sendMessage(chatId, srMsg, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error('Analiz hatası:', error);
    await bot.sendMessage(chatId, `❌ Hata: ${error.message}`);
  }
}

// Liste komutu
bot.onText(/\/liste/i, async (msg) => {
  await handleList(msg.chat.id);
});

// Piyasa Tarayıcı komutu
bot.onText(/\/tara/i, async (msg) => {
  await handleScan(msg.chat.id);
});

// Coin analizi - sadece coin sembolleri, komutları hariç
bot.onText(/^\/([a-zA-Z0-9]+)$/i, async (msg, match) => {
  const text = match[1].toLowerCase();

  // Komutları işleme
  if (['start', 'liste', 'tara'].includes(text)) {
    return;
  }

  await handleAnalyze(msg.chat.id, text);
});

console.log('🤖 Telegram bot çalışıyor...');
