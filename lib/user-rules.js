/**
 * 用户交易规则引擎
 *
 * 两种规则类型：
 * 1. HARD — 量化条件，程序化检查，不可绕过
 * 2. SOFT — 定性规则，注入 AI prompt，以"绝对约束"语言强制执行
 */

const fs   = require('fs');
const path = require('path');

const IS_VERCEL = !!process.env.VERCEL;
const DATA_DIR  = IS_VERCEL ? '/tmp/okx-data' : path.join(__dirname, '..', 'data');
const RULES_FILE = path.join(DATA_DIR, 'user-rules.json');

// ── 已知可量化指标 ─────────────────────────────────
const KNOWN_METRICS = {
  lsRatio:        { label: '多空比',     unit: '',     keywords: ['多空比','多空','long short ratio','ls ratio','l/s'] },
  fundingRate:    { label: '资金费率',   unit: '%',    keywords: ['资金费率','费率','funding rate','funding'] },
  oi:             { label: '持仓量',     unit: '',     keywords: ['持仓量','oi','open interest'] },
  positionCount:  { label: '当前持仓数', unit: '个',   keywords: ['持仓数','仓位数','position count','几个仓'] },
  totalExposure:  { label: '总敞口',     unit: 'USDT', keywords: ['总敞口','总仓位','total exposure','总金额'] },
  conviction:     { label: 'AI信心度',   unit: '%',    keywords: ['信心','conviction','信心度'] },
  price:          { label: '当前价格',   unit: 'USDT', keywords: ['价格','price','btc价格','eth价格','sol价格','okb价格','币价'] },
  _unconditional: { label: '无条件',     unit: '',     keywords: [] },
};

const KNOWN_ACTIONS = {
  block_long:  { label: '禁止开多仓', keywords: ['不要做多','禁止开多','不做多','不能做多','不开多','block long'] },
  block_short: { label: '禁止开空仓', keywords: ['不要做空','禁止开空','不做空','不能做空','不开空','block short'] },
  block_all:   { label: '禁止所有交易', keywords: ['不要交易','禁止交易','停止交易','不交易','block all'] },
  reduce_size: { label: '减小仓位',   keywords: ['减小仓位','减仓','仓位减半','reduce size'] },
};

// ── 持久化 ─────────────────────────────────────────

function loadRules() {
  try {
    if (fs.existsSync(RULES_FILE)) {
      return JSON.parse(fs.readFileSync(RULES_FILE, 'utf8'));
    }
  } catch (_) {}
  return [];
}

function saveRules(rules) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(RULES_FILE, JSON.stringify(rules, null, 2));
  } catch (e) { console.error('[rules] save error:', e.message); }
}

// ── 指标值解析 ─────────────────────────────────────

function resolveMetricValue(metric, state) {
  switch (metric) {
    case 'lsRatio':       return state.marketData?.longShortRatio?.lsRatio ?? null;
    case 'fundingRate':   return state.marketData?.fundingRate?.fundingRate ?? null;
    case 'oi':            return state.marketData?.openInterest?.oi ?? null;
    case 'positionCount': return state.positions?.length ?? 0;
    case 'totalExposure': return state.totalExposureUSDT ?? 0;
    case 'conviction':    return state.result?.conviction ?? null;
    case 'price':          return state.price ?? (state.ticker?.last ? parseFloat(state.ticker.last) : null);
    case '_unconditional': return 1;
    default:              return null;
  }
}

// ── Hard 规则评估 ──────────────────────────────────

/**
 * @param {Array} rules
 * @param {Object} state - { marketData, positions, totalExposureUSDT, result, signal }
 * @returns {{ allowed: boolean, violations: Array }}
 */
function evaluateHardRules(rules, state) {
  const violations = [];

  for (const rule of rules) {
    if (!rule.enabled || rule.type !== 'hard' || !rule.structured) continue;
    const s = rule.structured;
    const current = resolveMetricValue(s.metric, state);
    if (current === null || current === undefined) continue;

    let triggered = false;
    if (s.metric === '_unconditional') { triggered = true; }
    switch (s.operator) {
      case '>':  triggered = current > s.threshold; break;
      case '<':  triggered = current < s.threshold; break;
      case '>=': triggered = current >= s.threshold; break;
      case '<=': triggered = current <= s.threshold; break;
      case '==': triggered = current == s.threshold; break;
      case '!=': triggered = current != s.threshold; break;
    }

    if (triggered) {
      violations.push({
        ruleId:     rule.id,
        readable:   rule.readable,
        action:     s.action,
        actionParam: s.actionParam,
        metric:     s.metric,
        current,
        threshold:  s.threshold,
      });
    }
  }

  // 判断是否被方向性规则或全局规则阻止
  const signal = state.signal; // 'LONG' | 'SHORT'
  const blocked = violations.some(v => {
    if (v.action === 'block_all') return true;
    if (v.action === 'block_long' && signal === 'LONG') return true;
    if (v.action === 'block_short' && signal === 'SHORT') return true;
    return false;
  });

  return { allowed: !blocked, violations };
}

// ── Soft 规则 prompt 格式化 ────────────────────────

/**
 * @param {Array} rules
 * @param {number} [softWeight=70] - 0-100, how much soft rules influence AI decision
 */
function formatSoftRulesForPrompt(rules, softWeight) {
  const active = (rules || []).filter(r => r.enabled);
  if (!active.length) return '';

  const w = (softWeight != null && softWeight >= 0 && softWeight <= 100) ? softWeight : 70;
  const rest = 100 - w;

  const hardRules = active.filter(r => r.type === 'hard');
  const softRules = active.filter(r => r.type === 'soft');

  let text = `\n\n## 用户交易规则（软规则决策权重: ${w}%）\n`;
  text += `在你的最终决策中，软性规则应占 **${w}%** 的权重，剩余 ${rest}% 基于市场数据和分析师报告。\n`;
  text += `你的 reasoning 必须逐条说明如何按 ${w}% 权重参考了每条软性规则。\n\n`;

  if (hardRules.length) {
    text += '--- 硬性规则（系统自动执行，不受权重影响）---\n';
    let idx = 1;
    for (const r of hardRules) {
      text += `${idx++}. 【硬性约束 - 系统自动执行】${r.readable || r.naturalLanguage}\n`;
    }
    text += '\n';
  }

  if (softRules.length) {
    text += `--- 软性规则（权重: ${w}%）---\n`;
    let idx = 1;
    for (const r of softRules) {
      text += `${idx++}. 【软性规则 · 权重${w}%】${r.readable || r.naturalLanguage}\n`;
    }
    text += '\n';
  }

  text += `⚠️ 硬性规则必须绝对执行。软性规则按 ${w}% 权重纳入决策，你必须在 reasoning 中逐条说明执行情况。\n`;
  return text;
}

// ── 构建 LLM 规则解析 prompt ──────────────────────

function buildRuleParsePrompt(text) {
  return `你是一个交易规则解析器。用户输入了一条自然语言的交易规则，请判断是否可以量化为具体条件。

可用的度量指标:
${Object.entries(KNOWN_METRICS).filter(([k]) => k !== '_unconditional').map(([k, v]) => `- ${k}: ${v.label}`).join('\n')}
- _unconditional: 无条件（用于"暂停所有交易"等无需条件的规则，threshold设为0，operator设为">="）

可用的动作:
${Object.entries(KNOWN_ACTIONS).map(([k, v]) => `- ${k}: ${v.label}`).join('\n')}

可用的比较运算符: >, <, >=, <=, ==, !=

如果规则可以量化，返回 JSON:
{
  "type": "hard",
  "structured": {
    "metric": "指标名",
    "operator": "运算符",
    "threshold": 数字,
    "action": "动作名",
    "actionParam": null
  },
  "readable": "中文可读描述，例如：当多空比 > 2.0 时，禁止开多仓"
}

如果规则是定性的（不能量化为具体数字条件），返回:
{
  "type": "soft",
  "structured": null,
  "readable": "中文可读描述（准确表达用户意图）"
}

用户规则: "${text}"

直接输出 JSON，不要 markdown 代码块。`;
}

// ── 确定性规则自动分类（不需要 LLM） ─────────────

function autoClassifyRule(text) {
  if (!text) return null;
  const t = text.trim();

  // Unconditional block_all
  if (/暂停.*(交易|所有|全部)|停止.*(交易|所有)|不要.*(交易|任何)|全部停止|禁止.*(所有|一切).*交易/i.test(t)) {
    return {
      type: 'hard',
      structured: { metric: '_unconditional', operator: '>=', threshold: 0, action: 'block_all', actionParam: null },
      readable: '暂停所有交易（无条件禁止）',
    };
  }

  // Unconditional block_long (no numeric condition present)
  if (/^(不要|禁止|不能|不可以|不准).*(做多|开多|买入|买多)/.test(t) && !/\d/.test(t)) {
    return {
      type: 'hard',
      structured: { metric: '_unconditional', operator: '>=', threshold: 0, action: 'block_long', actionParam: null },
      readable: '禁止开多仓（无条件）',
    };
  }

  // Unconditional block_short (no numeric condition present)
  if (/^(不要|禁止|不能|不可以|不准).*(做空|开空|卖出|卖空)/.test(t) && !/\d/.test(t)) {
    return {
      type: 'hard',
      structured: { metric: '_unconditional', operator: '>=', threshold: 0, action: 'block_short', actionParam: null },
      readable: '禁止开空仓（无条件）',
    };
  }

  return null; // needs LLM
}

module.exports = {
  loadRules,
  saveRules,
  evaluateHardRules,
  formatSoftRulesForPrompt,
  resolveMetricValue,
  buildRuleParsePrompt,
  autoClassifyRule,
  KNOWN_METRICS,
  KNOWN_ACTIONS,
};
