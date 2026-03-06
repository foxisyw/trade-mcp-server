/**
 * analyze.js — analyze.py 的 JavaScript 移植版
 * 接收 candles 数组（oldest-first），返回与 analyze.py 完全相同格式的文本输出
 *
 * @param {Array<{ts, o, h, l, c, vol}>} candles   最旧到最新
 * @param {string} [inst]  仅用于标题，如 'BTC-USDT'
 * @param {string} [bar]   仅用于标题，如 '15m'
 * @returns {{ raw: string, bull: number, bear: number } | null}
 */

// ─── 指标计算 ─────────────────────────────────────────────

function ema(values, period) {
  const k      = 2 / (period + 1);
  const result = new Array(values.length).fill(null);
  if (values.length < period) return result;

  // 第一个 EMA 用简单均值
  result[period - 1] = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    result[i] = values[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

function sma(values, period) {
  const result = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j];
    result[i] = sum / period;
  }
  return result;
}

function calculateRsi(closes, period = 14) {
  if (closes.length < period + 1) return null;

  const gains  = [];
  const losses = [];
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(Math.max(diff, 0));
    losses.push(Math.max(-diff, 0));
  }

  // Wilder 平滑（与 Python 版一致）
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function calculateMacd(closes, fast = 12, slow = 26, signal = 9) {
  if (closes.length < slow + signal) return [null, null, null];

  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);

  const macdLine = emaFast.map((v, i) =>
    v !== null && emaSlow[i] !== null ? v - emaSlow[i] : null
  );

  const validMacd = macdLine.filter(v => v !== null);
  if (validMacd.length < signal) return [null, null, null];

  // 对齐 signal line 的起始位置
  const signalStart    = macdLine.findIndex(v => v !== null);
  const signalLineVals = ema(validMacd, signal);

  // 拼接：signalStart 个 null + (signal-1) 个 null + 有效值
  const signalLine = [
    ...new Array(signalStart + signal - 1).fill(null),
    ...signalLineVals.slice(signal - 1),
  ].slice(0, closes.length);

  const lastMacd   = [...macdLine].reverse().find(v => v !== null) ?? null;
  const lastSignal = [...signalLine].reverse().find(v => v !== null) ?? null;
  const lastHist   = lastMacd !== null && lastSignal !== null
    ? lastMacd - lastSignal : null;

  return [lastMacd, lastSignal, lastHist];
}

function calculateMa(closes, period) {
  const vals = sma(closes, period);
  return [...vals].reverse().find(v => v !== null) ?? null;
}

function calculateBb(closes, period = 20, mult = 2.0) {
  if (closes.length < period) return [null, null, null];
  const window = closes.slice(-period);
  const mid     = window.reduce((a, b) => a + b, 0) / period;
  const variance = window.reduce((s, x) => s + (x - mid) ** 2, 0) / period;
  const std     = Math.sqrt(variance);
  return [mid + mult * std, mid, mid - mult * std];
}

// ─── 信号解读 ────────────────────────────────────────────

function rsiLabel(rsi) {
  if (rsi >= 70) return ['空', `RSI ${rsi.toFixed(1)}，超买区间，注意回调风险`];
  if (rsi >= 60) return ['多', `RSI ${rsi.toFixed(1)}，偏强，仍有上行空间`];
  if (rsi >= 40) return ['中', `RSI ${rsi.toFixed(1)}，中性区间`];
  if (rsi >= 30) return ['空', `RSI ${rsi.toFixed(1)}，偏弱`];
  return            ['多', `RSI ${rsi.toFixed(1)}，超卖区间，关注反弹机会`];
}

function macdLabel(hist, prevHist) {
  let cross = '';
  if (prevHist !== null && prevHist !== undefined) {
    if (prevHist < 0 && hist > 0) cross = '金叉 ↑';
    else if (prevHist > 0 && hist < 0) cross = '死叉 ↓';
  }
  const direction = hist > 0 ? '↑ 动能增强' : '↓ 动能减弱';
  const tag       = hist > 0 ? '多' : '空';
  const sign      = hist >= 0 ? '+' : '';
  let label = `柱状图 ${sign}${hist.toFixed(2)}，${direction}`;
  if (cross) label += `，${cross}`;
  return [tag, label];
}

function bbLabel(price, upper, mid, lower) {
  const bandWidth = upper - lower;
  const position  = bandWidth > 0 ? (price - lower) / bandWidth : 0.5;
  const pct       = (position * 100).toFixed(0);
  if (price > upper) return ['空', `价格突破上轨（位置 ${pct}%），超买注意`];
  if (price > mid)   return ['多', `价格在中轨上方（位置 ${pct}%）`];
  if (price > lower) return ['空', `价格在中轨下方（位置 ${pct}%）`];
  return                    ['多', `价格跌破下轨（位置 ${pct}%），关注反弹`];
}

function maLabel(price, ma20, ma50, ma200) {
  const mas   = [ma20, ma50, ma200].filter(ma => ma !== null);
  const above = mas.filter(ma => price > ma).length;
  const total = mas.length;
  if (above === total) return ['多', '价格在 MA20/50/200 全线上方，多头排列'];
  if (above === 0)     return ['空', '价格在 MA20/50/200 全线下方，空头排列'];
  return                      ['中', `价格部分均线上方（${above}/${total}），趋势混合`];
}

// ─── 格式化工具 ──────────────────────────────────────────

/** 千分位逗号 + 固定小数位（模拟 Python {:,.2f}） */
function fmt(n, decimals = 2) {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** 右对齐到 width 位（用空格填充） */
function padLeft(str, width) {
  return String(str).padStart(width, ' ');
}

// ─── 主函数 ──────────────────────────────────────────────

/**
 * @param {Array<{ts, o, h, l, c, vol}>} candles  oldest-first
 * @param {string} [inst]
 * @param {string} [bar]
 * @returns {{ raw: string, bull: number, bear: number } | null}
 */
function analyze(candles, inst = '', bar = '') {
  if (!candles || candles.length < 30) return null;

  const closes = candles.map(c => c.c);
  const price  = closes[closes.length - 1];
  const lastTs = candles[candles.length - 1].ts;
  const d      = new Date(lastTs);
  const timeStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;

  // ── 计算指标 ──
  const rsi                     = calculateRsi(closes);
  const [macd, sig, hist]       = calculateMacd(closes);
  let prevHist = null;
  if (closes.length >= 27) {
    const [, , ph] = calculateMacd(closes.slice(0, -1));
    prevHist = ph;
  }
  const ma20              = calculateMa(closes, 20);
  const ma50              = calculateMa(closes, 50);
  const ma200             = calculateMa(closes, 200);
  const [bbUpper, bbMid, bbLower] = calculateBb(closes);

  const title = inst ? `${inst} ` : '';
  const SEP   = '='.repeat(54);
  const lines = [];

  lines.push('');
  lines.push(SEP);
  lines.push(`  ${title}技术分析  (${timeStr})`);
  lines.push(SEP);
  lines.push(`  当前价格: ${fmt(price)}`);
  lines.push('');

  // 均线
  lines.push('── 均线 ─────────────────────────────────────────────');
  for (const [label, val] of [['MA20 ', ma20], ['MA50 ', ma50], ['MA200', ma200]]) {
    if (val !== null) {
      const diff  = price - val;
      const arrow = diff > 0 ? '▲' : '▼';
      const pct   = (diff / val * 100 >= 0 ? '+' : '') + (diff / val * 100).toFixed(1) + '%';
      lines.push(`  ${label}  ${padLeft(fmt(val), 12)}   ${arrow} ${fmt(Math.abs(diff))} (${pct})`);
    }
  }
  lines.push('');

  // RSI
  lines.push('── RSI (14) ──────────────────────────────────────────');
  if (rsi !== null) {
    const barLen = Math.min(Math.floor(rsi / 5), 20);
    const barStr = '█'.repeat(barLen) + '░'.repeat(20 - barLen);
    lines.push(`  ${barStr}  ${rsi.toFixed(1)}`);
  }
  lines.push('');

  // MACD
  lines.push('── MACD (12/26/9) ────────────────────────────────────');
  if (macd !== null) {
    lines.push(`  MACD    ${padLeft(macd.toFixed(3), 10)}`);
    lines.push(`  Signal  ${padLeft(sig.toFixed(3), 10)}`);
    const histSign = hist >= 0 ? '+' : '';
    lines.push(`  Hist    ${padLeft(histSign + hist.toFixed(3), 10)}  ${hist > 0 ? '▲' : '▼'}`);
  }
  lines.push('');

  // 布林带
  lines.push('── 布林带 (20, 2σ) ───────────────────────────────────');
  if (bbUpper !== null) {
    const bandPct = ((price - bbLower) / (bbUpper - bbLower) * 100).toFixed(0);
    lines.push(`  上轨  ${padLeft(fmt(bbUpper), 12)}`);
    lines.push(`  中轨  ${padLeft(fmt(bbMid), 12)}   ← 当前位置 ${bandPct}%`);
    lines.push(`  下轨  ${padLeft(fmt(bbLower), 12)}`);
  }
  lines.push('');

  // 信号汇总
  const signals = [];
  if (ma20 !== null && ma50 !== null && ma200 !== null) {
    const [tag, msg] = maLabel(price, ma20, ma50, ma200);
    signals.push([tag, `趋势    ${msg}`]);
  }
  if (hist !== null) {
    const [tag, msg] = macdLabel(hist, prevHist);
    signals.push([tag, `动能    ${msg}`]);
  }
  if (rsi !== null) {
    const [tag, msg] = rsiLabel(rsi);
    signals.push([tag, `RSI     ${msg}`]);
  }
  if (bbUpper !== null) {
    const [tag, msg] = bbLabel(price, bbUpper, bbMid, bbLower);
    signals.push([tag, `布林带  ${msg}`]);
  }

  const tagMap = { '多': '✅', '空': '🔴', '中': '⚠️ ' };
  lines.push('── 信号汇总 ──────────────────────────────────────────');
  for (const [tag, msg] of signals) {
    lines.push(`  ${tagMap[tag] || '  '} ${msg}`);
  }

  const bull = signals.filter(([t]) => t === '多').length;
  const bear = signals.filter(([t]) => t === '空').length;
  lines.push('');
  lines.push(`  多头信号 ${bull} / 空头信号 ${bear} / 共 ${signals.length} 项`);
  lines.push(SEP);
  lines.push('');

  return { raw: lines.join('\n'), bull, bear };
}

module.exports = { analyze };
