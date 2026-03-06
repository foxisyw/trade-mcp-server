/**
 * Agent Skills Registry
 * Pre-computed analysis modules that inject additional context into agent prompts.
 * Each skill computes data from existing market context and returns formatted text.
 */

// ─── Skills Registry ─────────────────────────────────────────────────

const SKILLS_REGISTRY = {
  'fibonacci-levels': {
    id: 'fibonacci-levels',
    name: 'Fibonacci Retracement',
    nameZh: '斐波那契回撤',
    description: 'Compute Fibonacci retracement levels from recent swing high/low',
    descriptionZh: '根据近期波段高低点计算斐波那契回撤位',
    detailZh: '数据来源: OKX K线数据（近50根）\n计算方法: 从近期K线中识别波段高点和低点，计算0%、23.6%、38.2%、50%、61.8%、78.6%、100%七个回撤位，并标注当前价格最接近的回撤位。\n用途: 帮助技术分析师判断支撑/阻力位，为入场和止损点提供参考。',
    applicableAgents: ['technical', 'manager'],
    compute: computeFibonacci,
  },
  'candlestick-patterns': {
    id: 'candlestick-patterns',
    name: 'Candlestick Patterns',
    nameZh: 'K线形态识别',
    description: 'Detect common candlestick patterns (doji, engulfing, hammer, etc.)',
    descriptionZh: '检测常见K线形态（十字星、吞没、锤子线等）',
    detailZh: '数据来源: OKX K线数据（近10根）\n识别形态: 十字星(Doji)=多空犹豫、锤子线(Hammer)=潜在看涨反转、倒锤子(Inverted Hammer)=反转信号、看涨吞没(Bullish Engulfing)=强看涨、看跌吞没(Bearish Engulfing)=强看跌。\n用途: 实时检测K线形态变化，辅助判断短期趋势反转信号。',
    applicableAgents: ['technical', 'manager'],
    compute: computeCandlestickPatterns,
  },
  'volume-profile': {
    id: 'volume-profile',
    name: 'Volume Profile',
    nameZh: '成交量分布',
    description: 'Analyze volume distribution across price levels',
    descriptionZh: '分析各价格水平的成交量分布',
    detailZh: '数据来源: OKX K线数据（近50根的成交量）\n计算方法: 将价格区间分为8个桶，统计每个价格区间的成交量占比，识别POC（最大成交量区域）并以柱状图可视化。\n用途: POC是价格可能回归的"公允价格"区域。高成交量区=强支撑/阻力，低成交量区=价格可能快速穿越。',
    applicableAgents: ['technical', 'risk'],
    compute: computeVolumeProfile,
  },
  'orderflow-analysis': {
    id: 'orderflow-analysis',
    name: 'Order Flow Analysis',
    nameZh: '订单流分析',
    description: 'Analyze OI changes and long/short ratio trends',
    descriptionZh: '分析持仓量变化和多空比趋势',
    detailZh: '数据来源: OKX合约市场数据API（实时）\n分析内容:\n• 持仓量(OI): 市场未平仓合约总量，反映市场参与度\n• 多空比: 多头vs空头持仓比例，判断市场情绪（>1.5=强多头，<0.67=强空头）\n• 资金费率: 多空双方的持仓成本指标（正=做多成本高，负=做空成本高）\n用途: 判断市场参与者的实际押注方向，识别过度拥挤的交易。',
    applicableAgents: ['technical', 'risk', 'manager'],
    compute: computeOrderFlow,
  },
  'volatility-regime': {
    id: 'volatility-regime',
    name: 'Volatility Regime',
    nameZh: '波动率状态',
    description: 'Classify current volatility regime (low/normal/high/extreme)',
    descriptionZh: '判断当前波动率状态（低/正常/高/极端）',
    detailZh: '数据来源: OKX K线数据（近20根）\n计算方法:\n• 年化波动率: 基于收益率标准差推算\n• ATR(20): 真实波动范围均值，衡量绝对波动幅度\n• 波动率分级: 低(<30%年化)、正常(30-60%)、高(60-100%)、极端(>100%)\n用途: 波动率状态决定仓位管理策略 — 极端波动时应降低杠杆和缩小仓位，低波动可能预示即将突破。',
    applicableAgents: ['risk', 'manager'],
    compute: computeVolatilityRegime,
  },
  'fear-greed-index': {
    id: 'fear-greed-index',
    name: 'Fear & Greed Index',
    nameZh: '恐惧贪婪指数',
    description: 'Crypto market sentiment via Fear & Greed Index',
    descriptionZh: '加密市场情绪指标（恐惧/贪婪指数）',
    detailZh: '数据来源: Alternative.me Fear & Greed Index（公开免费API）\n指标范围: 0-100\n• 0-24: 极度恐惧 — 市场恐慌，可能是抄底机会\n• 25-49: 恐惧 — 投资者谨慎\n• 50-74: 贪婪 — 市场乐观，注意追高风险\n• 75-100: 极度贪婪 — 市场狂热，可能见顶\n用途: 作为逆向指标参考，当大多数人恐惧时可能是买入机会，反之亦然。提供市场整体情绪背景。',
    applicableAgents: ['macro', 'manager'],
    compute: computeFearGreedIndex,
  },
};

// ─── Skill Compute Functions ─────────────────────────────────────────

function computeFibonacci(ctx) {
  const candles = ctx.candles;
  if (!candles || candles.length < 20) return null;

  const recent = candles.slice(-50);
  let swingHigh = -Infinity, swingLow = Infinity;

  for (const c of recent) {
    const h = parseFloat(c.h || c[2]);
    const l = parseFloat(c.l || c[3]);
    if (h > swingHigh) swingHigh = h;
    if (l < swingLow) swingLow = l;
  }

  const diff = swingHigh - swingLow;
  if (diff <= 0) return null;

  const currentPrice = parseFloat(ctx.ticker?.last || 0);
  const levels = {
    '0.0%': swingHigh,
    '23.6%': swingHigh - diff * 0.236,
    '38.2%': swingHigh - diff * 0.382,
    '50.0%': swingHigh - diff * 0.5,
    '61.8%': swingHigh - diff * 0.618,
    '78.6%': swingHigh - diff * 0.786,
    '100.0%': swingLow,
  };

  // Find nearest level
  let nearest = null, nearestDist = Infinity;
  for (const [label, price] of Object.entries(levels)) {
    const dist = Math.abs(currentPrice - price);
    if (dist < nearestDist) { nearestDist = dist; nearest = label; }
  }

  const lines = [`波段高点: $${swingHigh.toFixed(2)}  |  波段低点: $${swingLow.toFixed(2)}`];
  for (const [label, price] of Object.entries(levels)) {
    const marker = label === nearest ? ' ← 当前最近' : '';
    lines.push(`  ${label}: $${price.toFixed(2)}${marker}`);
  }
  lines.push(`当前价格: $${currentPrice.toFixed(2)} (最近回撤位: ${nearest})`);

  return lines.join('\n');
}

function computeCandlestickPatterns(ctx) {
  const candles = ctx.candles;
  if (!candles || candles.length < 5) return null;

  const recent = candles.slice(-10);
  const patterns = [];

  for (let i = 0; i < recent.length; i++) {
    const c = recent[i];
    const o = parseFloat(c.o || c[1]);
    const h = parseFloat(c.h || c[2]);
    const l = parseFloat(c.l || c[3]);
    const cl = parseFloat(c.c || c[4]);
    const body = Math.abs(cl - o);
    const range = h - l;
    const ts = new Date(c.ts || c[0]).toISOString().slice(5, 16).replace('T', ' ');

    if (range === 0) continue;
    const bodyRatio = body / range;

    // Doji
    if (bodyRatio < 0.1) {
      patterns.push(`${ts}: 十字星(Doji) — 多空犹豫信号`);
    }
    // Hammer / Inverted Hammer
    else if (bodyRatio < 0.35) {
      const upperShadow = h - Math.max(o, cl);
      const lowerShadow = Math.min(o, cl) - l;
      if (lowerShadow > body * 2 && upperShadow < body * 0.5) {
        patterns.push(`${ts}: 锤子线(Hammer) — 潜在看涨反转`);
      } else if (upperShadow > body * 2 && lowerShadow < body * 0.5) {
        patterns.push(`${ts}: 倒锤子(Inverted Hammer) — 潜在反转信号`);
      }
    }

    // Engulfing (need previous candle)
    if (i > 0) {
      const prev = recent[i - 1];
      const po = parseFloat(prev.o || prev[1]);
      const pcl = parseFloat(prev.c || prev[4]);
      // Bullish engulfing
      if (pcl < po && cl > o && o <= pcl && cl >= po) {
        patterns.push(`${ts}: 看涨吞没(Bullish Engulfing) — 强看涨信号`);
      }
      // Bearish engulfing
      else if (pcl > po && cl < o && o >= pcl && cl <= po) {
        patterns.push(`${ts}: 看跌吞没(Bearish Engulfing) — 强看跌信号`);
      }
    }
  }

  if (!patterns.length) return '近10根K线未检测到明显形态';
  return patterns.join('\n');
}

function computeVolumeProfile(ctx) {
  const candles = ctx.candles;
  if (!candles || candles.length < 20) return null;

  const recent = candles.slice(-50);
  let high = -Infinity, low = Infinity;

  for (const c of recent) {
    const h = parseFloat(c.h || c[2]);
    const l = parseFloat(c.l || c[3]);
    if (h > high) high = h;
    if (l < low) low = l;
  }

  const buckets = 8;
  const step = (high - low) / buckets;
  if (step <= 0) return null;

  const profile = new Array(buckets).fill(0);
  let totalVol = 0;

  for (const c of recent) {
    const mid = (parseFloat(c.h || c[2]) + parseFloat(c.l || c[3])) / 2;
    const vol = parseFloat(c.vol || c[5]) || 0;
    const idx = Math.min(Math.floor((mid - low) / step), buckets - 1);
    profile[idx] += vol;
    totalVol += vol;
  }

  if (totalVol === 0) return null;

  // Find POC (Point of Control)
  let pocIdx = 0;
  for (let i = 1; i < buckets; i++) {
    if (profile[i] > profile[pocIdx]) pocIdx = i;
  }

  const currentPrice = parseFloat(ctx.ticker?.last || 0);
  const lines = ['价格区间  |  成交量占比  |  条形图'];

  for (let i = buckets - 1; i >= 0; i--) {
    const lo = low + step * i;
    const hi = lo + step;
    const pct = ((profile[i] / totalVol) * 100).toFixed(1);
    const bar = '█'.repeat(Math.round(profile[i] / totalVol * 30));
    const poc = i === pocIdx ? ' ◄POC' : '';
    const cur = (currentPrice >= lo && currentPrice < hi) ? ' ←当前' : '';
    lines.push(`$${lo.toFixed(0)}-${hi.toFixed(0)} | ${pct.padStart(5)}% | ${bar}${poc}${cur}`);
  }

  lines.push(`\nPOC (最大成交量区): $${(low + step * pocIdx).toFixed(2)} - $${(low + step * (pocIdx + 1)).toFixed(2)}`);
  return lines.join('\n');
}

function computeOrderFlow(ctx) {
  const md = ctx.marketData;
  if (!md) return null;

  const parts = [];

  if (md.openInterest) {
    const oiVal = md.openInterest.oiCcy || md.openInterest.oi;
    if (oiVal) parts.push(`持仓量(OI): ${parseFloat(oiVal).toLocaleString()}`);
  }

  if (md.longShortRatio) {
    const ls = md.longShortRatio;
    const ratio = parseFloat(ls.lsRatio || 0);
    const longPct = ((ls.longRatio || 0) * 100).toFixed(1);
    const shortPct = ((ls.shortRatio || 0) * 100).toFixed(1);
    let sentiment = '均衡';
    if (ratio > 1.5) sentiment = '强多头主导';
    else if (ratio > 1.2) sentiment = '偏多';
    else if (ratio < 0.67) sentiment = '强空头主导';
    else if (ratio < 0.83) sentiment = '偏空';
    parts.push(`多空比: ${ratio.toFixed(2)} (多${longPct}% / 空${shortPct}%) — ${sentiment}`);
  }

  if (md.fundingRate) {
    const fr = parseFloat(md.fundingRate.fundingRate || 0);
    const frPct = (fr * 100).toFixed(4);
    let frSentiment = '中性';
    if (fr > 0.01) frSentiment = '强做多成本';
    else if (fr > 0.005) frSentiment = '偏高做多成本';
    else if (fr < -0.01) frSentiment = '强做空成本';
    else if (fr < -0.005) frSentiment = '偏高做空成本';
    parts.push(`资金费率: ${frPct}% — ${frSentiment}`);

    if (md.fundingRate.nextFundingRate) {
      const nfr = (parseFloat(md.fundingRate.nextFundingRate) * 100).toFixed(4);
      parts.push(`下期预测费率: ${nfr}%`);
    }
  }

  if (!parts.length) return null;
  return parts.join('\n');
}

function computeVolatilityRegime(ctx) {
  const candles = ctx.candles;
  if (!candles || candles.length < 20) return null;

  const recent = candles.slice(-20);
  const returns = [];

  for (let i = 1; i < recent.length; i++) {
    const prev = parseFloat(recent[i - 1].c || recent[i - 1][4]);
    const curr = parseFloat(recent[i].c || recent[i][4]);
    if (prev > 0) returns.push((curr - prev) / prev);
  }

  if (!returns.length) return null;

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / returns.length;
  const stddev = Math.sqrt(variance);
  const annualized = (stddev * Math.sqrt(365 * 24 * 4) * 100); // ~15min candles

  // ATR calculation
  const atrs = [];
  for (let i = 1; i < recent.length; i++) {
    const h = parseFloat(recent[i].h || recent[i][2]);
    const l = parseFloat(recent[i].l || recent[i][3]);
    const pc = parseFloat(recent[i - 1].c || recent[i - 1][4]);
    atrs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const atr = atrs.reduce((a, b) => a + b, 0) / atrs.length;
  const currentPrice = parseFloat(ctx.ticker?.last || 0);
  const atrPct = currentPrice > 0 ? ((atr / currentPrice) * 100).toFixed(2) : '0';

  let regime, emoji;
  if (annualized < 30) { regime = '低波动'; emoji = '🟢'; }
  else if (annualized < 60) { regime = '正常波动'; emoji = '🟡'; }
  else if (annualized < 100) { regime = '高波动'; emoji = '🟠'; }
  else { regime = '极端波动'; emoji = '🔴'; }

  return `波动率状态: ${emoji} ${regime}
年化波动率: ${annualized.toFixed(1)}%
ATR(20): $${atr.toFixed(2)} (${atrPct}%)
近20根K线标准差: ${(stddev * 100).toFixed(3)}%
建议: ${regime === '极端波动' ? '降低杠杆、缩小仓位' :
        regime === '高波动' ? '谨慎加仓、设紧止损' :
        regime === '低波动' ? '可能即将突破，关注方向' :
        '正常交易条件'}`;
}

// ─── Fear & Greed Index (cached) ─────────────────────────────────────

let _fngCache = null;
let _fngCacheTs = 0;
const FNG_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

async function fetchFearGreedIndex() {
  const now = Date.now();
  if (_fngCache && (now - _fngCacheTs) < FNG_CACHE_TTL) return _fngCache;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const r = await fetch('https://api.alternative.me/fng/?limit=2&format=json', {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const j = await r.json();
    if (j && j.data && j.data.length > 0) {
      _fngCache = j.data;
      _fngCacheTs = now;
      return j.data;
    }
  } catch (e) {
    console.warn('[skills] Fear & Greed fetch error:', e.message);
  }
  return _fngCache; // return stale cache if available
}

function computeFearGreedIndex(ctx) {
  // This is a sync function — use pre-fetched cache
  if (!_fngCache || !_fngCache.length) return null;

  const current = _fngCache[0];
  const previous = _fngCache[1];
  const value = parseInt(current.value);
  const prevValue = previous ? parseInt(previous.value) : null;
  const classification = current.value_classification;

  let label, emoji;
  if (value <= 24) { label = '极度恐惧'; emoji = '😱'; }
  else if (value <= 49) { label = '恐惧'; emoji = '😨'; }
  else if (value <= 74) { label = '贪婪'; emoji = '😏'; }
  else { label = '极度贪婪'; emoji = '🤑'; }

  const trend = prevValue !== null
    ? (value > prevValue ? `↑ 上升 (前值: ${prevValue})` : value < prevValue ? `↓ 下降 (前值: ${prevValue})` : `→ 持平 (前值: ${prevValue})`)
    : '';

  return `${emoji} 恐惧贪婪指数: ${value}/100 — ${label} (${classification})
趋势: ${trend}
参考: 极度恐惧(<25)常是抄底机会，极度贪婪(>75)注意见顶风险`;
}

// ─── Skills Runner ───────────────────────────────────────────────────

/**
 * Run enabled skills for a specific agent and return formatted context text
 * @param {string} agentId
 * @param {string[]} enabledSkillIds - skill IDs enabled for this agent
 * @param {Object} ctx - { candles, ticker, marketData, ... }
 * @returns {string} formatted text to append to user message
 */
function runSkillsForAgent(agentId, enabledSkillIds, ctx) {
  if (!enabledSkillIds || !enabledSkillIds.length) return '';

  const outputs = [];
  for (const skillId of enabledSkillIds) {
    const skill = SKILLS_REGISTRY[skillId];
    if (!skill) continue;
    if (!skill.applicableAgents.includes(agentId)) continue;

    try {
      const result = skill.compute(ctx);
      if (result) {
        outputs.push(`### ${skill.nameZh} (${skill.name})\n${result}`);
      }
    } catch (e) {
      console.warn(`[skills] ${skillId} compute error:`, e.message);
    }
  }

  if (!outputs.length) return '';
  return '\n\n## 技能分析数据\n' + outputs.join('\n\n');
}

/**
 * Get additional system prompt instructions for skills
 * @param {string} agentId
 * @param {string[]} enabledSkillIds
 * @returns {string} text to append to system prompt
 */
function getSkillInstructions(agentId, enabledSkillIds) {
  if (!enabledSkillIds || !enabledSkillIds.length) return '';

  const activeSkills = enabledSkillIds
    .map(id => SKILLS_REGISTRY[id])
    .filter(s => s && s.applicableAgents.includes(agentId));

  if (!activeSkills.length) return '';

  const names = activeSkills.map(s => s.nameZh).join('、');
  return `\n\n## 附加技能数据\n用户已启用以下分析技能：${names}。请在你的分析中参考"技能分析数据"部分的数据，将其纳入你的判断依据。`;
}

/**
 * Pre-fetch external data needed by skills (call before runSkillsForAgent)
 * @param {Object} enabledSkills - { agentId: ['skill-id', ...] }
 */
async function prefetchSkillData(enabledSkills) {
  if (!enabledSkills) return;
  // Check if fear-greed-index is enabled for any agent
  const needsFng = Object.values(enabledSkills).some(arr =>
    Array.isArray(arr) && arr.includes('fear-greed-index')
  );
  if (needsFng) {
    await fetchFearGreedIndex();
  }
}

/**
 * Get registry metadata for the API (no compute functions)
 */
function getSkillsMeta() {
  const meta = {};
  for (const [id, skill] of Object.entries(SKILLS_REGISTRY)) {
    meta[id] = {
      id: skill.id,
      name: skill.name,
      nameZh: skill.nameZh,
      description: skill.description,
      descriptionZh: skill.descriptionZh,
      detailZh: skill.detailZh || '',
      applicableAgents: skill.applicableAgents,
    };
  }
  return meta;
}

module.exports = {
  SKILLS_REGISTRY,
  runSkillsForAgent,
  getSkillInstructions,
  getSkillsMeta,
  prefetchSkillData,
};
