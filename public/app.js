// ===== STATE =====
let allCoins = [];
let currentData = null;
let chartSymbol = null;
let chartTf = '1h';
let market = 'future'; // kullanıcı vadeli işlem yapıyor
let liveTimer = null;
let autoTimer = null;
let prevSignal = null;
let lastLivePrice = null;
let candleSeries = null;
let charts = [];

const $ = id => document.getElementById(id);
const coinSearch = $('coinSearch');
const dropdown = $('coinDropdown');

// ===== COİN LİSTESİ =====
async function loadCoins() {
  try {
    const res = await fetch(`/api/coins?market=${market}`);
    const json = await res.json();
    if (json.success) {
      allCoins = json.data;
      renderDropdown(allCoins.slice(0, 30));
    }
  } catch (e) { console.error('Coin listesi alınamadı', e); }
}

function renderDropdown(list) {
  dropdown.innerHTML = list.map(c => `
    <div class="coin-item" data-sym="${c.symbol}">
      <span class="c-sym">${c.symbol}</span>
      <span class="c-vol">$${fmtVol(c.volume24h)}</span>
      <span class="c-chg ${c.change24h >= 0 ? 'up' : 'down'}">${c.change24h >= 0 ? '+' : ''}${c.change24h?.toFixed(1)}%</span>
    </div>`).join('') || '<div class="coin-item"><span class="c-sym">Sonuç yok</span></div>';
  dropdown.querySelectorAll('.coin-item[data-sym]').forEach(el => {
    el.addEventListener('click', () => {
      coinSearch.value = el.dataset.sym;
      dropdown.style.display = 'none';
      runAnalysis();
    });
  });
}

function fmtVol(v) {
  if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(0) + 'M';
  return (v / 1e3).toFixed(0) + 'K';
}

coinSearch.addEventListener('input', () => {
  const q = coinSearch.value.trim().toUpperCase();
  if (!q) { dropdown.style.display = 'none'; return; }
  const filtered = allCoins.filter(c => c.symbol.includes(q)).slice(0, 30);
  renderDropdown(filtered);
  dropdown.style.display = 'block';
});
coinSearch.addEventListener('focus', () => {
  if (allCoins.length) { renderDropdown(allCoins.slice(0, 30)); dropdown.style.display = 'block'; }
});
document.addEventListener('click', e => {
  if (!e.target.closest('.search-wrap')) dropdown.style.display = 'none';
});
coinSearch.addEventListener('keydown', e => {
  if (e.key === 'Enter') { dropdown.style.display = 'none'; runAnalysis(); }
});

$('analyzeBtn').addEventListener('click', runAnalysis);

// Spot / Vadeli geçişi
document.querySelectorAll('#marketToggle button').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('#marketToggle button').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    market = b.dataset.market;
    loadCoins();
    if (currentData) runAnalysis(); // mod değişince yeniden analiz et
    runScan();
  });
});

// ===== ANALİZ =====
async function runAnalysis(silent = false) {
  const symbol = coinSearch.value.trim();
  if (!symbol) return;

  $('error').style.display = 'none';
  if (!silent) {
    $('result').style.display = 'none';
    $('loading').style.display = 'flex';
  }
  $('analyzeBtn').disabled = true;

  try {
    const res = await fetch(`/api/analyze?symbol=${encodeURIComponent(symbol)}&market=${market}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.message);
    currentData = json.data;
    const sigKey = `${json.data.overall.direction}:${json.data.overall.confidence}`;
    if (prevSignal && prevSignal !== sigKey) {
      const badge = $('directionBadge');
      badge.classList.remove('signal-flash');
      void badge.offsetWidth;
      badge.classList.add('signal-flash');
    }
    prevSignal = sigKey;
    renderAll();
    if (!silent) {
      $('result').style.display = 'block';
      loadChart(chartTf);
    }
    startLivePrice();
  } catch (e) {
    $('error').textContent = 'Hata: ' + e.message;
    $('error').style.display = 'block';
  } finally {
    if (!silent) $('loading').style.display = 'none';
    $('analyzeBtn').disabled = false;
  }
}

// ===== RENDER =====
const TF_LABELS = { '15m': '15 Dakika', '1h': '1 Saat', '4h': '4 Saat', '1d': '1 Gün', '1w': '1 Hafta' };
const TF_ORDER = ['15m', '1h', '4h', '1d', '1w'];

function sigClass(dir) {
  return dir === 'LONG' ? 'sig-long' : dir === 'SHORT' ? 'sig-short' : 'sig-wait';
}
function dirLabel(dir) {
  return dir === 'LONG' ? '🟢 AL' : dir === 'SHORT' ? '🔴 SAT' : '🟡 BEKLE';
}
function dirClass(dir) {
  return dir === 'LONG' ? 'badge-long' : dir === 'SHORT' ? 'badge-short' : 'badge-wait';
}
function trendClass(t) {
  return t.includes('YÜKSEL') ? 'cell-trend-up' : t.includes('DÜŞÜŞ') ? 'cell-trend-down' : 'cell-trend-neut';
}

function renderAll() {
  const d = currentData;
  const o = d.overall;

  $('resSymbol').textContent = d.symbol.replace(':USDT', '') + (d.market === 'future' ? ' · VADELİ' : ' · SPOT');
  $('resPrice').textContent = '$' + fmtPrice(d.price);
  $('voteChips').innerHTML = Object.entries(o.votes).map(([k, v]) =>
    `<span class="vote-chip chip-${k === 'LONG' ? 'long' : k === 'SHORT' ? 'short' : 'wait'}">${k === 'LONG' ? 'Yükseliş' : k === 'SHORT' ? 'Düşüş' : 'Nötr'} oyu: ${v} TF</span>`
  ).join('');

  const badge = $('directionBadge');
  badge.textContent = dirLabel(o.direction);
  badge.className = 'direction-badge ' + dirClass(o.direction);
  $('confFill').style.width = o.confidence + '%';
  $('confValue').textContent = o.confidence + '%';

  renderMatrix();
  renderPlan();
  renderIndicators();
  renderReasons();
}

function renderMatrix() {
  const d = currentData;
  $('tfMatrixBody').innerHTML = TF_ORDER.map(tf => {
    const a = d.analyses[tf];
    if (!a) return `<tr><td class="tf-name">${TF_LABELS[tf]}</td><td colspan="9" class="cell-neut">Veri alınamadı</td></tr>`;
    const i = a.indicators;
    const macdTxt = i.macdHist > 0 ? '▲' : '▼';
    const stochTxt = i.stochK > 80 ? 'Aşırı Alım' : i.stochK < 20 ? 'Aşırı Satım' : 'Nötr';
    const volTxt = i.volumeRatio > 1.5 ? 'Yüksek' : i.volumeRatio < 0.6 ? 'Düşük' : 'Normal';
    const regimeCls = i.regime && i.regime.includes('YÜKSEL') ? 'cell-trend-up' : i.regime && i.regime.includes('DÜŞ') ? 'cell-trend-down' : 'cell-neut';
    return `<tr>
      <td class="tf-name">${TF_LABELS[tf]}</td>
      <td class="${regimeCls}">${i.regime || '-'}</td>
      <td class="${i.rsi < 30 ? 'cell-good' : i.rsi > 70 ? 'cell-bad' : 'cell-neut'}">${i.rsi}</td>
      <td class="${i.macdHist > 0 ? 'cell-good' : 'cell-bad'}">${macdTxt} ${Math.abs(i.macdHist).toPrecision(2)}</td>
      <td class="${i.stochK < 20 ? 'cell-good' : i.stochK > 80 ? 'cell-bad' : 'cell-neut'}">${stochTxt} (${i.stochK})</td>
      <td class="${i.adx > 25 ? 'cell-good' : 'cell-neut'}">${i.adx}</td>
      <td class="${i.volumeRatio > 1.5 ? 'cell-good' : i.volumeRatio < 0.6 ? 'cell-neut' : ''}">${volTxt} (${i.volumeRatio}x)</td>
      <td class="${trendClass(i.htfTrend)}">${i.htfTrend}</td>
      <td><span class="sig-pill ${sigClass(a.direction)}">${dirLabel(a.direction)}</span></td>
      <td><div class="conf-mini"><div class="bar"><div class="fill ${a.direction === 'LONG' ? 'fill-long' : a.direction === 'SHORT' ? 'fill-short' : 'fill-wait'}" style="width:${a.confidence}%"></div></div><span>${a.confidence}%</span></div></td>
    </tr>`;
  }).join('');
}

function renderPlan() {
  const o = currentData.overall;
  $('planTfLabel').textContent = o.planTf ? `Plan kaynağı: ${TF_LABELS[o.planTf]} analizi` : '';
  const p = o.plan;
  const el = $('planContent');
  if (!p || !p.entry) {
    el.innerHTML = `<div class="plan-empty">🟡 Genel sinyal: BEKLE — zaman dilimleri arasında net uyum yok. Fiyatın destek/direnç bölgesine gelmesini izleyin.</div>`;
    return;
  }
  let html = `<div class="plan-grid">
    <div class="plan-item kind-entry"><div class="label">Giriş (${p.entryType})</div><div class="value entry-val">${fmtPrice(p.entry)}</div><div class="sub">Bölge: ${fmtPrice(p.entryZone?.[0])} – ${fmtPrice(p.entryZone?.[1])}</div></div>
    <div class="plan-item kind-sl"><div class="label">Stop-Loss</div><div class="value sl-val">${fmtPrice(p.stopLoss)}</div><div class="sub">%${p.riskPct} risk</div></div>
    <div class="plan-item kind-rr"><div class="label">Risk / Ödül</div><div class="value risk-val">1 : ${p.riskReward}</div><div class="sub">TP2 baz alınarak</div></div>`;
  p.targets.forEach(t => {
    html += `<div class="plan-item kind-tp"><div class="label">${t.name} — ${t.type}</div><div class="value tp-val">${fmtPrice(t.price)}</div><div class="sub">R:${t.rr}</div></div>`;
  });
  html += `</div><div class="plan-suggestion">💡 ${p.suggestion}</div>`;
  el.innerHTML = html;
}

function renderIndicators() {
  const tf = currentData.overall.planTf || '4h';
  const a = currentData.analyses[tf];
  $('indTfLabel').textContent = `Gösterge TF: ${TF_LABELS[tf]}`;
  if (!a) { $('indicatorsGrid').innerHTML = ''; return; }
  const i = a.indicators;
  const items = [
    ['Piyasa Rejimi', i.regime || '-', i.regime && i.regime.includes('YÜKSEL') ? ['Trend yukarı', 'hint-good'] : i.regime && i.regime.includes('DÜŞ') ? ['Trend aşağı', 'hint-bad'] : ['Yatay', 'hint-neutral']],
    ['Momentum Yönü', i.momentumDir > 0 ? 'Yukarı ↗' : i.momentumDir < 0 ? 'Aşağı ↘' : 'Nötr', i.momentumDir > 0 ? ['Alıcı momentumu', 'hint-good'] : i.momentumDir < 0 ? ['Satıcı momentumu', 'hint-bad'] : ['Kararsız', 'hint-neutral']],
    ['RSI (14)', i.rsi, i.rsi < 30 ? ['Aşırı satım', 'hint-good'] : i.rsi > 70 ? ['Aşırı alım', 'hint-bad'] : ['Nötr', 'hint-neutral']],
    ['MACD Histogram', i.macdHist, i.macdHist > 0 ? ['Pozitif', 'hint-good'] : ['Negatif', 'hint-bad']],
    ['ADX (Trend Gücü)', i.adx, i.adx > 25 ? ['Güçlü trend', 'hint-good'] : ['Zayıf trend', 'hint-neutral']],
    ['+DI / -DI', `${i.plusDI} / ${i.minusDI}`, i.plusDI > i.minusDI ? ['Alıcılar baskın', 'hint-good'] : ['Satıcılar baskın', 'hint-bad']],
    ['Stokastik %K', i.stochK, i.stochK < 20 ? ['Aşırı satım', 'hint-good'] : i.stochK > 80 ? ['Aşırı alım', 'hint-bad'] : ['Nötr', 'hint-neutral']],
    ['ATR (Volatilite)', i.atr, null, `Fiyatın %${i.atrPct}'i`],
    ['EMA 20', fmtPrice(i.ema20), i.ema20Slope > 0 ? [`↗ ${i.ema20Slope}%`, 'hint-good'] : [`↘ ${i.ema20Slope}%`, 'hint-bad']],
    ['EMA 50', fmtPrice(i.ema50), i.ema50Slope > 0 ? [`↗ ${i.ema50Slope}%`, 'hint-good'] : [`↘ ${i.ema50Slope}%`, 'hint-bad']],
    ['Hacim Oranı', i.volumeRatio + 'x', i.volumeRatio > 1.5 ? ['Yüksek hacim', 'hint-good'] : i.volumeRatio < 0.6 ? ['Düşük hacim', 'hint-neutral'] : ['Normal', 'hint-neutral']],
    ['Bollinger Konum', '%' + Math.round(i.bbPosition * 100), i.bbPosition < 0.1 ? ['Alt bant', 'hint-good'] : i.bbPosition > 0.9 ? ['Üst bant', 'hint-bad'] : ['Orta', 'hint-neutral']],
    ['Destek', fmtPrice(i.nearestSupport), null],
    ['Direnç', fmtPrice(i.nearestResistance), null]
  ];
  $('indicatorsGrid').innerHTML = items.map(([label, value, hint, sub]) => `
    <div class="ind-item">
      <div class="label">${label}</div>
      <div class="value">${value}</div>
      ${hint ? `<div class="hint ${hint[1]}">${hint[0]}</div>` : ''}
      ${sub ? `<div class="hint hint-neutral">${sub}</div>` : ''}
    </div>`).join('');
}

// ===== ANALİST DEĞERLENDİRMESİ — TF bazında katlanır bölümler =====
function renderReasons() {
  const d = currentData;
  const o = d.overall;

  // Üstte genel özet
  let html = `<details class="tf-block general-block" open>
    <summary>
      <span class="tf-block-title">📋 Genel Değerlendirme</span>
      <span class="sig-pill ${sigClass(o.direction)}">${dirLabel(o.direction)}</span>
      <span class="tf-block-conf">%${o.confidence} güven</span>
    </summary>
    <div class="tf-block-body">
      <p>Skor: <b>${o.score > 0 ? '+' : ''}${o.score}</b> (ağırlıklı, -1..+1 arası) — ${o.direction === 'BEKLE'
        ? 'Zaman dilimleri arasında net uyum yok; sinyal eşiği aşılmadı.'
        : o.direction === 'LONG'
        ? 'Çoğu zaman dilimi yükseliş yönünde sinyal veriyor; üst TF desteği mevcut.'
        : 'Çoğu zaman dilimi düşüş yönünde sinyal veriyor; üst TF baskısı mevcut.'}</p>
      ${o.plan && o.plan.suggestion ? `<p>💡 ${o.plan.suggestion}</p>` : ''}
    </div>
  </details>`;

  // Her TF ayrı katlanır blok
  TF_ORDER.forEach(tf => {
    const a = d.analyses[tf];
    if (!a) return;
    const isPlanTf = tf === o.planTf;
    html += `<details class="tf-block" ${isPlanTf ? 'open' : ''}>
      <summary>
        <span class="tf-block-title">${TF_LABELS[tf]}</span>
        <span class="sig-pill ${sigClass(a.direction)}">${dirLabel(a.direction)}</span>
        <span class="tf-block-conf">%${a.confidence}</span>
        ${isPlanTf ? '<span class="tf-block-tag">PLAN KAYNAĞI</span>' : ''}
      </summary>
      <div class="tf-block-body"><ul>${a.reasons.map(r => `<li>${r}</li>`).join('')}</ul></div>
    </details>`;
  });

  $('reasonsList').innerHTML = html;
}

// ===== CHART — çok panelli (fiyat+hacim / hacim / RSI / MACD) =====
async function loadChart(tf) {
  if (!currentData) return;
  chartTf = tf;
  document.querySelectorAll('#chartTfTabs button').forEach(b =>
    b.classList.toggle('active', b.dataset.tf === tf));

  const symbol = currentData.symbol.split('/')[0];
  try {
    const res = await fetch(`/api/chart?symbol=${encodeURIComponent(symbol)}&timeframe=${tf}&market=${market}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.message);
    drawChart(json.data);
  } catch (e) {
    console.error('Chart hatası:', e.message);
  }
}

document.querySelectorAll('#chartTfTabs button').forEach(b => {
  b.addEventListener('click', () => loadChart(b.dataset.tf));
});

function fmtPrice(v) {
  if (v == null) return '-';
  if (v >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (v >= 1) return v.toFixed(4);
  return v.toPrecision(4);
}

const chartOpts = {
  layout: { background: { color: '#131722' }, textColor: '#787b86', fontFamily: '-apple-system, Segoe UI, sans-serif' },
  grid: { vertLines: { color: 'rgba(42,46,57,.5)' }, horzLines: { color: 'rgba(42,46,57,.5)' } },
  timeScale: { borderColor: '#2a2e39', timeVisible: true, visible: false },
  rightPriceScale: { borderColor: '#2a2e39' },
  crosshair: { mode: 0 }
};

function makeChart(elId) {
  const el = $(elId);
  el.innerHTML = '';
  const c = LightweightCharts.createChart(el, JSON.parse(JSON.stringify(chartOpts)));
  charts.push(c);
  return c;
}

function syncCharts() {
  let syncing = false;
  charts.forEach((c, idx) => {
    c.timeScale().subscribeVisibleLogicalRangeChange(range => {
      if (syncing || !range) return;
      syncing = true;
      charts.forEach((o, j) => { if (j !== idx) o.timeScale().setVisibleLogicalRange(range); });
      syncing = false;
    });
  });
}

function drawChart(data) {
  charts.forEach(c => c.remove());
  charts = [];
  candleSeries = null;

  // ===== 1) FİYAT PANELİ (mum + EMA + hacim overlay + plan çizgileri) =====
  const chart = makeChart('chart');
  candleSeries = chart.addCandlestickSeries({
    upColor: '#089981', downColor: '#f23645',
    borderUpColor: '#089981', borderDownColor: '#f23645',
    wickUpColor: '#089981', wickDownColor: '#f23645'
  });
  candleSeries.setData(data.candles);

  const e20s = chart.addLineSeries({ color: '#2962ff', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
  e20s.setData(data.ema20);
  const e50s = chart.addLineSeries({ color: '#f0b90b', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
  e50s.setData(data.ema50);

  const volOverlay = chart.addHistogramSeries({
    priceScaleId: 'vol',
    priceFormat: { type: 'volume' },
    lastValueVisible: false,
    priceLineVisible: false
  });
  volOverlay.setData(data.volume);
  chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

  const p = currentData?.overall?.plan;
  if (p && p.entry) {
    candleSeries.createPriceLine({ price: p.entry, color: '#2962ff', lineWidth: 2, lineStyle: 0, axisLabelVisible: true, title: 'GİRİŞ' });
    candleSeries.createPriceLine({ price: p.stopLoss, color: '#f23645', lineWidth: 2, lineStyle: 0, axisLabelVisible: true, title: 'STOP' });
    p.targets.forEach(t => {
      candleSeries.createPriceLine({ price: t.price, color: '#089981', lineWidth: 1, lineStyle: 1, axisLabelVisible: true, title: t.name });
    });
  }
  chart.timeScale().fitContent();

  // ===== 2) HACİM PANELİ =====
  const volChart = makeChart('chartVol');
  const volSeries = volChart.addHistogramSeries({
    priceFormat: { type: 'volume' },
    lastValueVisible: false,
    priceLineVisible: false
  });
  volSeries.setData(data.volume);
  volChart.timeScale().fitContent();

  // ===== 3) RSI PANELİ =====
  const rsiChart = makeChart('chartRsi');
  const rsiSeries = rsiChart.addLineSeries({ color: '#a371f7', lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
  rsiSeries.setData(data.rsi);
  [70, 50, 30].forEach(lvl => {
    rsiSeries.createPriceLine({
      price: lvl,
      color: lvl === 50 ? 'rgba(120,123,134,.4)' : 'rgba(242,54,69,.5)',
      lineWidth: 1, lineStyle: 2,
      axisLabelVisible: true,
      title: lvl === 30 ? 'Aşırı Satım' : lvl === 70 ? 'Aşırı Alım' : ''
    });
  });
  rsiChart.priceScale('right').applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 } });
  rsiChart.timeScale().fitContent();

  // ===== 4) MACD PANELİ =====
  const macdChart = makeChart('chartMacd');
  const histSeries = macdChart.addHistogramSeries({
    priceLineVisible: false, lastValueVisible: false
  });
  histSeries.setData(data.macdHist.map(h => ({
    time: h.time, value: h.value,
    color: h.value >= 0 ? 'rgba(8,153,129,.6)' : 'rgba(242,54,69,.6)'
  })));
  const macdLine = macdChart.addLineSeries({ color: '#2962ff', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
  macdLine.setData(data.macd);
  const sigLine = macdChart.addLineSeries({ color: '#f0b90b', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
  sigLine.setData(data.macdSignal);
  macdChart.timeScale().fitContent();

  syncCharts();
}

// ===== CANLI FİYAT (her 5 sn) =====
function startLivePrice() {
  if (liveTimer) clearInterval(liveTimer);
  const symbol = currentData.symbol.split('/')[0];
  lastLivePrice = null;

  const tick = async () => {
    try {
      const res = await fetch(`/api/price?symbol=${encodeURIComponent(symbol)}&market=${market}`);
      const json = await res.json();
      if (!json.success) return;
      const p = json.data.price;
      const el = $('resPrice');
      el.textContent = '$' + fmtPrice(p);
      if (lastLivePrice !== null && p !== lastLivePrice) {
        el.classList.remove('flash-up', 'flash-down');
        void el.offsetWidth;
        el.classList.add(p > lastLivePrice ? 'flash-up' : 'flash-down');
        setTimeout(() => el.classList.remove('flash-up', 'flash-down'), 900);
      }
      lastLivePrice = p;
      updateLiveInfo(p);
      updateLiveCandle(symbol);
    } catch (e) { /* sessiz geç */ }
  };

  tick();
  liveTimer = setInterval(tick, 5000);
}

async function updateLiveCandle(symbol) {
  if (!candleSeries || !currentData) return;
  try {
    const res = await fetch(`/api/candle?symbol=${encodeURIComponent(symbol)}&timeframe=${chartTf}&market=${market}`);
    const json = await res.json();
    if (json.success) candleSeries.update(json.data);
  } catch (e) { /* sessiz geç */ }
}

function distPct(price, level) {
  return ((price - level) / level * 100).toFixed(2);
}

function updateLiveInfo(p) {
  const plan = currentData?.overall?.plan;
  const el = $('liveInfo');
  if (!plan || !plan.entry || !p) { el.textContent = ''; return; }
  const parts = [];
  parts.push(`Girişe uzaklık: <b class="${p.entry > p ? 'hint-bad' : 'hint-good'}">%${Math.abs(distPct(p, plan.entry))}</b> ${p.entry > p ? 'aşağıda' : 'yukarıda'}`);
  parts.push(`Stop'a uzaklık: <b>%${Math.abs(distPct(p, plan.stopLoss))}</b>`);
  if (plan.targets[0]) parts.push(`TP1'e uzaklık: <b>%${Math.abs(distPct(p, plan.targets[0].price))}</b>`);
  el.innerHTML = parts.join(' &nbsp;•&nbsp; ');
}

// ===== PİYASA TARAYICI =====
$('scanBtn').addEventListener('click', runScan);

async function runScan() {
  $('scanBtn').disabled = true;
  $('scanInfo').textContent = 'Taranıyor...';
  ['scanUp', 'scanNeutral', 'scanDown'].forEach(id => {
    $(id).innerHTML = '<div class="scan-loading">⏳ Analiz ediliyor...</div>';
  });
  try {
    const res = await fetch(`/api/scan?market=${market}&limit=40`);
    const json = await res.json();
    if (!json.success) throw new Error(json.message);
    renderScan(json.data);
    $('scanInfo').textContent = `${json.data.scanned} coin tarandı • ${new Date(json.data.timestamp).toLocaleTimeString('tr-TR')}`;
  } catch (e) {
    $('scanInfo').textContent = 'Hata: ' + e.message;
  } finally {
    $('scanBtn').disabled = false;
  }
}

function scanItemHtml(c) {
  return `<div class="scan-item" data-sym="${c.base}">
    <span class="scan-sym">${c.base}</span>
    <span class="scan-price">$${fmtPrice(c.price)}</span>
    <span class="scan-score ${c.score >= 0 ? 'pos' : 'neg'}">${c.score > 0 ? '+' : ''}${c.score}</span>
  </div>`;
}

function renderScan(data) {
  $('scanUp').innerHTML = data.up.length
    ? data.up.map(scanItemHtml).join('')
    : '<div class="scan-empty">Yükseliş eğilimli coin yok</div>';
  $('scanNeutral').innerHTML = data.neutral.length
    ? data.neutral.map(scanItemHtml).join('')
    : '<div class="scan-empty">Nötr coin yok</div>';
  $('scanDown').innerHTML = data.down.length
    ? data.down.map(scanItemHtml).join('')
    : '<div class="scan-empty">Düşüş eğilimli coin yok</div>';

  document.querySelectorAll('.scan-item').forEach(el => {
    el.addEventListener('click', () => {
      coinSearch.value = el.dataset.sym;
      runAnalysis();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

// ===== ÖZEL TARAYICI — çoklu koşul oluşturucu =====
const NUM_INDICATORS = {
  rsi: 'RSI',
  macd: 'MACD Histogram',
  stoch: 'Stokastik %K',
  adx: 'ADX (Trend Gücü)',
  volume: 'Hacim Oranı (20 ort.)',
  atrPct: 'ATR Volatilitesi (%)',
  bbPos: 'Bollinger Konumu (0-1)',
  momPct: 'Momentum % (N bar)',
  rangePos: 'Range Pozisyonu (0-100)',
  volBalance: 'Hacim Dengesi (0-1)',
  distFromHigh: 'Tepeden Sapma (%)',
  pctEmaF: 'Hızlı EMA\'dan Sapma (%)',
  pctEmaM: 'Orta EMA\'dan Sapma (%)',
  change24h: '24s Değişim (%)',
  score: 'Trend Skoru (-100..+100)',
  consecUp: 'Üst Üste Yeşil Mum',
  consecDn: 'Üst Üste Kırmızı Mum'
};
const BOOL_INDICATORS = {
  aboveEmaF: 'Fiyat > Hızlı EMA',
  belowEmaF: 'Fiyat < Hızlı EMA',
  aboveEmaM: 'Fiyat > Orta EMA',
  belowEmaM: 'Fiyat < Orta EMA',
  emaFastOverMid: 'Hızlı EMA > Orta EMA',
  emaFastUnderMid: 'Hızlı EMA < Orta EMA',
  emaMidOverSlow: 'Orta EMA > Yavaş EMA',
  emaMidUnderSlow: 'Orta EMA < Yavaş EMA',
  diBull: '+DI > -DI (Alıcılar Baskın)',
  diBear: '-DI > +DI (Satıcılar Baskın)',
  rsiRising: 'RSI Yükseliyor',
  rsiFalling: 'RSI Düşüyor',
  macdRising: 'MACD Histogramı Güçleniyor',
  macdFalling: 'MACD Histogramı Zayıflıyor',
  stochCrossUp: 'Stokastik Yukarı Kesişim',
  newHigh: 'Yeni Tepe Bölgesinde',
  newLow: 'Yeni Dip Bölgesinde',
  htfBullish: 'Üst TF: Boğa Dizilimi',
  htfBearish: 'Üst TF: Ayı Dizilimi',
  htfPriceAboveEma50: 'Üst TF: Fiyat > EMA50'
};

const PARAM_DEFS = [
  ['rsi', 'RSI Periyot', 14],
  ['macdF', 'MACD Hızlı', 12],
  ['macdSlow', 'MACD Yavaş', 26],
  ['macdSig', 'MACD Sinyal', 9],
  ['stochK', 'Stokastik %K', 14],
  ['stochD', 'Stokastik %D', 3],
  ['adx', 'ADX Periyot', 14],
  ['emaF', 'Hızlı EMA', 20],
  ['emaM', 'Orta EMA', 50],
  ['emaS', 'Yavaş EMA', 200],
  ['bbP', 'Bollinger Periyot', 20],
  ['bbM', 'Bollinger Çarpan', 2],
  ['atr', 'ATR Periyot', 14],
  ['mom', 'Momentum (bar)', 10]
];

const PRESETS = {
  oversold: [
    { indicator: 'rsi', cond: 'lt', value: '30' },
    { indicator: 'volume', cond: 'gt', value: '0.8' }
  ],
  pullback: [
    { indicator: 'aboveEmaM', cond: 'yes', value: '' },
    { indicator: 'emaFastOverMid', cond: 'yes', value: '' },
    { indicator: 'emaMidOverSlow', cond: 'yes', value: '' },
    { indicator: 'rsi', cond: 'between', value: '40,45' }
  ],
  breakout: [
    { indicator: 'macd', cond: 'gt', value: '0' },
    { indicator: 'volume', cond: 'gt', value: '1.5' },
    { indicator: 'rsi', cond: 'gt', value: '50' },
    { indicator: 'adx', cond: 'gt', value: '20' }
  ],
  bearish: [
    { indicator: 'belowEmaM', cond: 'yes', value: '' },
    { indicator: 'emaFastUnderMid', cond: 'yes', value: '' },
    { indicator: 'emaMidUnderSlow', cond: 'yes', value: '' },
    { indicator: 'macd', cond: 'lt', value: '0' },
    { indicator: 'rsi', cond: 'lt', value: '55' }
  ],
  capitulation: [
    { indicator: 'rsi', cond: 'lt', value: '25' },
    { indicator: 'volume', cond: 'gt', value: '2' },
    { indicator: 'bbPos', cond: 'lt', value: '0.1' }
  ],
  custom: []
};

let scrConditions = [{ indicator: 'rsi', cond: 'lt', value: '30' }];
let lastScreenData = null;

(function initParams() {
  $('paramsGrid').innerHTML = PARAM_DEFS.map(([k, label, def]) => `
    <div class="param-item">
      <label>${label}</label>
      <input type="number" data-param="${k}" value="${def}" step="1" min="1">
    </div>`).join('');
})();

function collectParams() {
  const p = {};
  document.querySelectorAll('#paramsGrid input').forEach(inp => {
    const v = parseFloat(inp.value);
    if (!isNaN(v) && v > 0) p[inp.dataset.param] = v;
  });
  return p;
}

// Kayıtlı stratejiler (localStorage)
function getSavedPresets() {
  try { return JSON.parse(localStorage.getItem('coinTerminal.presets') || '{}'); } catch (e) { return {}; }
}
function refreshPresetList() {
  const saved = getSavedPresets();
  $('scrLoadPreset').innerHTML = '<option value="">Kayıtlı strateji yükle...</option>' +
    Object.keys(saved).map(k => `<option value="${k}">${k}</option>`).join('');
}
$('scrSavePreset').addEventListener('click', () => {
  const name = prompt('Strateji adı:', 'Stratejim');
  if (!name) return;
  const saved = getSavedPresets();
  saved[name] = { conditions: scrConditions, params: collectParams() };
  localStorage.setItem('coinTerminal.presets', JSON.stringify(saved));
  refreshPresetList();
  $('scrInfo').textContent = `"${name}" kaydedildi`;
});
$('scrLoadPreset').addEventListener('change', e => {
  const name = e.target.value;
  if (!name) return;
  const saved = getSavedPresets()[name];
  if (!saved) return;
  scrConditions = saved.conditions.map(c => ({ ...c }));
  if (saved.params) {
    document.querySelectorAll('#paramsGrid input').forEach(inp => {
      if (saved.params[inp.dataset.param] !== undefined) inp.value = saved.params[inp.dataset.param];
    });
  }
  renderScrConditions();
  $('scrInfo').textContent = `"${name}" yüklendi`;
});
refreshPresetList();

function indicatorOptions() {
  const num = Object.entries(NUM_INDICATORS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  const bool = Object.entries(BOOL_INDICATORS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  return `<optgroup label="Sayısal (değer karşılaştırması)">${num}</optgroup><optgroup label="Doğruluk (evet/hayır)">${bool}</optgroup>`;
}

function isBoolInd(ind) { return !!BOOL_INDICATORS[ind]; }

function renderScrConditions() {
  const box = $('scrConditions');
  box.innerHTML = scrConditions.map((c, i) => `
    <div class="scr-cond-row">
      ${i > 0 ? '<span class="scr-cond-and">VE</span>' : '<span class="scr-cond-and" style="visibility:hidden">VE</span>'}
      <select class="scr-ind" data-i="${i}">${indicatorOptions()}</select>
      <select class="scr-cnd" data-i="${i}" ${isBoolInd(c.indicator) ? 'disabled' : ''}>
        <option value="lt" ${c.cond === 'lt' ? 'selected' : ''}>değerin altında</option>
        <option value="gt" ${c.cond === 'gt' ? 'selected' : ''}>değerin üstünde</option>
        <option value="between" ${c.cond === 'between' ? 'selected' : ''}>aralıkta (min,max)</option>
      </select>
      <input type="text" class="scr-val" data-i="${i}" value="${c.value}" ${isBoolInd(c.indicator) ? 'disabled' : ''} placeholder="${isBoolInd(c.indicator) ? '—' : '30 veya 30,70'}">
      <button class="scr-cond-del" data-i="${i}" title="Koşulu sil">×</button>
    </div>`).join('');
  // select'leri mevcut değere ayarla
  box.querySelectorAll('.scr-ind').forEach(sel => { sel.value = scrConditions[+sel.dataset.i].indicator; });

  box.querySelectorAll('.scr-ind').forEach(sel => sel.addEventListener('change', () => {
    const i = +sel.dataset.i;
    scrConditions[i].indicator = sel.value;
    renderScrConditions();
  }));
  box.querySelectorAll('.scr-cnd').forEach(sel => sel.addEventListener('change', () => {
    scrConditions[+sel.dataset.i].cond = sel.value;
  }));
  box.querySelectorAll('.scr-val').forEach(inp => inp.addEventListener('input', () => {
    scrConditions[+inp.dataset.i].value = inp.value;
  }));
  box.querySelectorAll('.scr-cond-del').forEach(btn => btn.addEventListener('click', () => {
    scrConditions.splice(+btn.dataset.i, 1);
    if (!scrConditions.length) scrConditions.push({ indicator: 'rsi', cond: 'lt', value: '30' });
    renderScrConditions();
  }));
}

$('scrAddCond').addEventListener('click', () => {
  scrConditions.push({ indicator: 'macd', cond: 'gt', value: '0' });
  renderScrConditions();
});

document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    scrConditions = PRESETS[btn.dataset.preset].map(c => ({ ...c }));
    renderScrConditions();
  });
});

$('scrBtn').addEventListener('click', runScreen);

async function runScreen() {
  $('scrBtn').disabled = true;
  $('scrInfo').textContent = 'Taranıyor...';
  try {
    const params = new URLSearchParams({
      market,
      timeframe: $('scrTf').value,
      limit: $('scrLimit').value,
      sort: $('scrSort').value,
      htf: $('scrHtf').value,
      conditions: JSON.stringify(scrConditions.filter(c => c.indicator)),
      params: JSON.stringify(collectParams())
    });
    const res = await fetch('/api/screen?' + params);
    const json = await res.json();
    if (!json.success) throw new Error(json.message);
    lastScreenData = json.data;
    renderScreen(json.data);
    $('scrInfo').textContent = `${json.data.matches.length} / ${json.data.scanned} coin eşleşti (${json.data.params.timeframe}${json.data.params.htf && json.data.params.htf !== 'none' ? ' + ÜstTF:' + json.data.params.htf : ''})`;
  } catch (e) {
    $('scrInfo').textContent = 'Hata: ' + e.message;
  } finally {
    $('scrBtn').disabled = false;
  }
}

function scoreClass(s) {
  return s >= 30 ? 'score-pos' : s <= -30 ? 'score-neg' : 'score-neut';
}

function renderScreen(data) {
  const wrap = $('scrResults');
  wrap.style.display = 'block';
  if (!data.matches.length) {
    $('scrBody').innerHTML = `<tr><td colspan="14" style="text-align:center;color:var(--muted);padding:24px">Eşleşen coin yok — koşulları gevşetmeyi dene</td></tr>`;
    return;
  }
  $('scrBody').innerHTML = data.matches.map(c => `<tr data-sym="${c.base}">
    <td class="coin-cell">${c.base}</td>
    <td>$${fmtPrice(c.price)}</td>
    <td class="${(c.change24h || 0) >= 0 ? 'cell-good' : 'cell-bad'}">${c.change24h != null ? (c.change24h >= 0 ? '+' : '') + c.change24h.toFixed(1) + '%' : '-'}</td>
    <td class="${scoreClass(c.score)}">${c.score > 0 ? '+' : ''}${c.score}</td>
    <td class="${c.rsi < 30 ? 'cell-good' : c.rsi > 70 ? 'cell-bad' : ''}">${c.rsi}</td>
    <td class="${c.macdHist > 0 ? 'cell-good' : 'cell-bad'}">${c.macdHist}</td>
    <td>${c.stochK}</td>
    <td class="${c.adx > 25 ? 'cell-good' : ''}">${c.adx}</td>
    <td>${c.plusDI}/${c.minusDI}</td>
    <td>${c.volumeRatio}x</td>
    <td>${c.atrPct}%</td>
    <td class="${c.momPct > 0 ? 'cell-good' : 'cell-bad'}">${c.momPct > 0 ? '+' : ''}${c.momPct}%</td>
    <td class="${c.bbPos < 0.1 ? 'cell-good' : c.bbPos > 0.9 ? 'cell-bad' : ''}">${Math.round(c.bbPos * 100)}%</td>
    <td class="${c.pctFromEmaF > 0 ? 'cell-good' : 'cell-bad'}">${c.pctFromEmaF > 0 ? '+' : ''}${c.pctFromEmaF}%</td>
  </tr>`).join('');
  $('scrBody').querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('click', () => {
      coinSearch.value = tr.dataset.sym;
      runAnalysis();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

// CSV dışa aktar
$('scrExport').addEventListener('click', () => {
  if (!lastScreenData || !lastScreenData.matches.length) {
    $('scrInfo').textContent = 'Önce tarama yap';
    return;
  }
  const cols = ['base','price','change24h','score','rsi','macdHist','stochK','adx','plusDI','minusDI','volumeRatio','atrPct','momPct','bbPos','pctFromEmaF'];
  const csv = [cols.join(','), ...lastScreenData.matches.map(c => cols.map(k => c[k] ?? '').join(','))].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `tarama_${Date.now()}.csv`;
  a.click();
});

// Otomatik sinyal yenileme
$('autoRefresh').addEventListener('change', e => {
  if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
  const ms = parseInt(e.target.value, 10);
  if (ms > 0) autoTimer = setInterval(() => runAnalysis(true), ms);
});

// PWA service worker kaydı
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// Başlat
renderScrConditions();
loadCoins();
runAnalysis();
runScan();
