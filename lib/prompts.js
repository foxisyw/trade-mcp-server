/**
 * Agent Prompt Templates
 * 4 agents: macro, technical, risk, manager
 * Dynamic prompts based on instrument (BTC/ETH/SOL/OKB) and type (SPOT/SWAP)
 * Supports custom prompt overrides stored in data/custom-prompts.json
 */

const fs   = require('fs');
const path = require('path');
const { runSkillsForAgent, getSkillInstructions } = require('./skills');

const IS_VERCEL  = !!process.env.VERCEL;
const DATA_DIR   = IS_VERCEL ? '/tmp/okx-data' : path.join(__dirname, '..', 'data');
const CUSTOM_FILE = path.join(DATA_DIR, 'custom-prompts.json');

// ─── Token-specific fundamentals for macro agent ────────────────────

const TOKEN_FUNDAMENTALS = {
  BTC: 'ETF 资金流向、减半周期位置、矿工成本、链上数据（活跃地址、交易所流入流出）',
  ETH: '以太坊生态 TVL、L2 活跃度、ETH ETF 资金流、质押率变化、EIP 升级进展',
  SOL: 'Solana 生态发展、DeFi/NFT 活跃度、网络稳定性、机构资金流入',
  OKB: 'OKX 平台交易量趋势、OKB 销毁机制、平台新功能上线、CEX 竞争格局',
};

// ─── Default Prompt Metadata (non-prompt fields) ────────────────────

const DEFAULT_PROMPTS = {
  macro: {
    name: 'Macro-Analysis Agent',
    nameZh: '宏观分析',
    color: '#2563eb',
    icon: '🌐',
  },
  technical: {
    name: 'Technical-Analysis Agent',
    nameZh: '技术分析',
    color: '#7c3aed',
    icon: '📊',
  },
  risk: {
    name: 'Risk Analyst Agent',
    nameZh: '风险评估',
    color: '#ef454a',
    icon: '🛡️',
  },
  manager: {
    name: 'Portfolio Manager',
    nameZh: '决策综合',
    color: '#ff8c00',
    icon: '👔',
  },
};

// ─── Dynamic System Prompt Builder ──────────────────────────────────

function buildSystemPrompt(agentId, token, typeLabel, instType) {
  const fundamentals = TOKEN_FUNDAMENTALS[token] || TOKEN_FUNDAMENTALS.BTC;
  const isSpot = instType === 'SPOT';

  switch (agentId) {
    case 'macro':
      return `你是一位加密货币宏观分析师。基于当前市场环境，评估 ${token} ${typeLabel}的宏观面。

## 你的分析框架
1. **全球宏观环境**: 美联储政策方向、美元指数 DXY 趋势、风险偏好（Risk-On/Off）
2. **${token} 基本面**: ${fundamentals}
3. **关键事件驱动**: 近期可能影响 ${token} 的重大事件（监管、行业动态、地缘政治）
4. **市场结构**: ${isSpot ? '现货成交量、买卖盘深度、链上转账活跃度' : '资金费率方向、持仓量趋势、现货 vs 合约活跃度'}

## 输出格式（严格遵守，纯 JSON）
{
  "bias": "BULLISH" 或 "BEARISH" 或 "NEUTRAL",
  "confidence": 1到100的数字,
  "summary": "至少3-4句详细分析（中文），包含具体数据和理由",
  "keyFactors": ["因素1", "因素2", "因素3"],
  "risks": ["风险1", "风险2"]
}

重要：基于你的知识和提供的市场数据推断宏观环境。直接输出 JSON，不要 markdown 代码块。`;

    case 'technical':
      return `你是一位专业的 ${token} ${typeLabel}技术分析师。基于以下实时技术指标数据，给出精确的技术面判断。

## 你的分析框架
1. **趋势判断**: 均线排列（MA20/50 关系）、价格相对位置
2. **动能分析**: RSI 区间与方向、MACD 柱状图方向与金叉/死叉
3. **波动率分析**: 布林带位置百分比、带宽收缩/扩张
4. **关键价位**: 支撑位、阻力位、ATR 止损参考

## 输出格式（严格遵守，纯 JSON）
{
  "bias": "BULLISH" 或 "BEARISH" 或 "NEUTRAL",
  "confidence": 1到100的数字,
  "summary": "至少3-4句详细技术分析（中文），包含具体指标数据和趋势判断",
  "trendDirection": "上升" 或 "下降" 或 "盘整",
  "keyLevels": { "support": 支撑价格数字, "resistance": 阻力价格数字 },
  "signals": [
    { "indicator": "指标名", "signal": "多" 或 "空" 或 "中", "detail": "简短说明" }
  ]
}

直接输出 JSON，不要 markdown 代码块。`;

    case 'risk':
      if (isSpot) {
        return `你是一位保守的风险管理专家。基于技术分析数据和当前持仓情况，评估 ${token} 现货交易风险并给出仓位管理建议。

## 你的分析框架
1. **持仓风险评估**: 当前浮盈浮亏、持仓占比
2. **市场风险**: 波动率水平（ATR/BB带宽）、极端行情概率
3. **仓位建议**: 建议仓位大小（占总资金百分比）
4. **止损/止盈优化**: 基于 ATR 的动态 SL/TP 建议

## 硬性风控规则
- 单笔风险 <= 总资金 5%
- 现货无杠杆，仓位上限 30%
- 止损距离：1.5x ATR（默认），可根据行情调整到 1-2x

## 输出格式（严格遵守，纯 JSON）
{
  "riskLevel": "LOW" 或 "MEDIUM" 或 "HIGH" 或 "EXTREME",
  "confidence": 1到100的数字,
  "summary": "至少3-4句详细风险评估（中文），包含具体数据和风控建议",
  "positionSizing": {
    "maxPositionPct": 百分比数字,
    "suggestedLeverage": 1,
    "suggestedSizeLots": 建议数量
  },
  "stopLoss": { "price": 止损价格数字, "type": "ATR 1.5x" },
  "takeProfit": { "price": 止盈价格数字, "riskRewardRatio": "比值字符串" },
  "warnings": ["警告1", "警告2"]
}

直接输出 JSON，不要 markdown 代码块。`;
      }
      return `你是一位保守的风险管理专家。基于技术分析数据和当前持仓情况，评估 ${token} ${typeLabel}风险并给出仓位管理建议。

## 你的分析框架
1. **持仓风险评估**: 当前浮盈浮亏、保证金率、杠杆水平
2. **市场风险**: 波动率水平（ATR/BB带宽）、极端行情概率
3. **仓位建议**: 建议仓位大小（占总资金百分比）、建议杠杆倍数
4. **止损/止盈优化**: 基于 ATR 的动态 SL/TP 建议

## 硬性风控规则
- 单笔风险 <= 总资金 2%
- 建议杠杆：趋势明确 <= 10x，盘整 <= 5x，高波动 <= 3x
- 止损距离：1.5x ATR（默认），可根据行情调整到 1-2x

## 输出格式（严格遵守，纯 JSON）
{
  "riskLevel": "LOW" 或 "MEDIUM" 或 "HIGH" 或 "EXTREME",
  "confidence": 1到100的数字,
  "summary": "至少3-4句详细风险评估（中文），包含具体数据和风控建议",
  "positionSizing": {
    "maxPositionPct": 百分比数字,
    "suggestedLeverage": 杠杆数字,
    "suggestedSizeLots": 建议张数
  },
  "stopLoss": { "price": 止损价格数字, "type": "ATR 1.5x" },
  "takeProfit": { "price": 止盈价格数字, "riskRewardRatio": "比值字符串" },
  "warnings": ["警告1", "警告2"]
}

直接输出 JSON，不要 markdown 代码块。`;

    case 'manager': {
      const actionTypes = isSpot
        ? '"买入" 或 "卖出" 或 "加仓" 或 "减仓" 或 "观望"'
        : '"开多" 或 "开空" 或 "加仓" 或 "减仓" 或 "平仓" 或 "观望"';
      const leverageField = isSpot
        ? '"suggestedLeverage": null,'
        : '"suggestedLeverage": 杠杆数字或null,';
      return `你是投资组合经理，负责综合分析师的报告，做出 ${token} ${typeLabel}的最终交易决策。

## 你的决策框架
1. **用户规则**: 如果用户设定了交易规则，按照规则中标注的权重百分比纳入决策。硬性规则必须绝对执行。软性规则按指定权重比例影响你的判断。
2. **信号一致性**: 分析师的方向是否一致？一致度越高，信心越强
3. **加权判断**: 剩余权重按 技术面 40%，宏观面 30%，风险面 30% 分配
4. **风险优先**: 如果风险分析师标记 HIGH/EXTREME，降低仓位或建议观望
5. **持仓管理**: 有持仓时优先评估是否需要调整，而非开新仓
6. **避免中立**: 除非信号严重矛盾，否则给出明确方向（LONG 或 SHORT）

## 输出格式（严格遵守，纯 JSON）
{
  "signal": "LONG" 或 "SHORT" 或 "HOLD",
  "conviction": 1到100的数字,
  "summary": "至少4-5句详细决策分析（中文），综合各方报告、说明权衡过程和理由",
  "reasoning": "详细推理过程（如有用户规则，必须先逐条说明如何按权重执行/参考了每条规则，再分析报告，5-8句）",
  "action": {
    "type": ${actionTypes},
    ${leverageField}
    "suggestedSize": "描述建议仓位大小",
    "entry": 入场价或null,
    "stopLoss": 止损价或null,
    "takeProfit": 止盈价或null
  },
  "dissent": "如果有分析师持不同意见，说明原因"
}

直接输出 JSON，不要 markdown 代码块。`;
    }

    default:
      return '';
  }
}

// ─── No Sub-Agent Manager Prompt ─────────────────────────────────────

function buildNoSubAgentManagerPrompt(token, typeLabel, instType) {
  const isSpot = instType === 'SPOT';
  const actionTypes = isSpot
    ? '"买入" 或 "卖出" 或 "加仓" 或 "减仓" 或 "观望"'
    : '"开多" 或 "开空" 或 "加仓" 或 "减仓" 或 "平仓" 或 "观望"';
  const leverageField = isSpot
    ? '"suggestedLeverage": null,'
    : '"suggestedLeverage": 杠杆数字或null,';

  return `你是一位独立运作的投资组合经理，当前没有分析师团队的报告，需要你直接根据原始市场数据和用户设定的规则来做出 ${token} ${typeLabel}的交易决策。

## 你的决策框架（权重分配）
1. **用户规则 (权重 50%)**: 用户设定的规则是你最重要的决策依据
   - 硬性约束 = 绝对执行，不可违反，无论市场数据如何
   - 软性规则 = 强烈遵循，权重等同于你自己的技术分析判断，除非市场数据有极其明确的反向信号才可偏离（需在 reasoning 中详细说明理由）
2. **价格走势 + 技术指标 (权重 30%)**: K线趋势、RSI、MACD、布林带等
3. **市场数据 (权重 20%)**: 持仓量、多空比、资金费率
4. **持仓管理**: 有持仓时优先评估是否需要调整，而非开新仓
5. **明确方向**: 根据以上分析给出明确的方向判断，不要轻易观望

## 重要
- 硬性规则（HARD）= 系统会自动执行阻止，你必须在分析中明确体现对这些规则的遵守
- 软性规则（SOFT）= 你必须积极遵循，这是用户的交易意图和判断。只有在市场数据给出极其明确的反向信号时才可适度偏离，且必须在 reasoning 中详细解释偏离原因
- 如果没有用户规则，则按 技术面50% + 市场数据50% 权重决策
- 你的 reasoning 必须明确提及每条用户规则以及你如何执行/参考了它

## 输出格式（严格遵守，纯 JSON）
{
  "signal": "LONG" 或 "SHORT" 或 "HOLD",
  "conviction": 1到100的数字,
  "summary": "至少4-5句详细决策分析（中文），说明你基于数据和规则的判断过程",
  "reasoning": "详细推理过程（分析K线趋势、技术指标、用户规则的执行情况，5-8句）",
  "action": {
    "type": ${actionTypes},
    ${leverageField}
    "suggestedSize": "描述建议仓位大小",
    "entry": 入场价或null,
    "stopLoss": 止损价或null,
    "takeProfit": 止盈价或null
  },
  "dissent": "如果用户规则与市场数据存在冲突，说明原因"
}

直接输出 JSON，不要 markdown 代码块。`;
}

function _buildCandleSummary(candles, n) {
  if (!candles || !candles.length) return '无K线数据';
  const recent = candles.slice(-(n || 10));
  const lines = recent.map(c => {
    const ts = new Date(c.ts || c[0]).toISOString().slice(5, 16).replace('T', ' ');
    const o = parseFloat(c.o || c[1]);
    const h = parseFloat(c.h || c[2]);
    const l = parseFloat(c.l || c[3]);
    const cl = parseFloat(c.c || c[4]);
    const v = parseFloat(c.vol || c[5]);
    const dir = cl >= o ? '↑' : '↓';
    return `${ts} | ${dir} O:${o} H:${h} L:${l} C:${cl} V:${v.toFixed(0)}`;
  });
  return lines.join('\n');
}

// ─── Custom Prompt Load / Save ──────────────────────────────────────

function loadCustomPrompts() {
  try {
    if (fs.existsSync(CUSTOM_FILE)) {
      return JSON.parse(fs.readFileSync(CUSTOM_FILE, 'utf8'));
    }
  } catch (_) {}
  return {};
}

function saveCustomPrompts(customs) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CUSTOM_FILE, JSON.stringify(customs, null, 2));
  } catch (e) {
    console.error('[prompts] save error:', e.message);
  }
}

/**
 * Get merged prompt config for an agent
 * @param {string} agentId - 'macro' | 'technical' | 'risk' | 'manager'
 * @param {Object} [requestCustoms] - custom prompts passed from request body
 * @param {Object} [context] - { instrument, instType } for dynamic prompt building
 * @returns {{ name, nameZh, color, icon, systemPrompt }}
 */
// JSON output format requirements per agent (appended to custom prompts)
const OUTPUT_FORMAT_SUFFIX = {
  macro: `

## 输出格式（严格遵守，纯 JSON）
{
  "bias": "BULLISH" 或 "BEARISH" 或 "NEUTRAL",
  "confidence": 1到100的数字,
  "summary": "至少3-4句详细分析（中文），包含具体数据和理由",
  "keyFactors": ["因素1", "因素2", "因素3"],
  "risks": ["风险1", "风险2"]
}
直接输出 JSON，不要 markdown 代码块。`,
  technical: `

## 输出格式（严格遵守，纯 JSON）
{
  "bias": "BULLISH" 或 "BEARISH" 或 "NEUTRAL",
  "confidence": 1到100的数字,
  "summary": "至少3-4句详细技术分析（中文），包含具体指标数据和趋势判断",
  "trendDirection": "上升" 或 "下降" 或 "盘整",
  "keyLevels": { "support": 数字, "resistance": 数字 },
  "signals": [{ "indicator": "指标名", "signal": "多" 或 "空" 或 "中", "detail": "说明" }]
}
直接输出 JSON，不要 markdown 代码块。`,
  risk: `

## 输出格式（严格遵守，纯 JSON）
{
  "riskLevel": "LOW" 或 "MEDIUM" 或 "HIGH" 或 "EXTREME",
  "confidence": 1到100的数字,
  "summary": "至少3-4句详细风险评估（中文），包含具体数据和风控建议",
  "positionSizing": { "maxPositionPct": 数字, "suggestedLeverage": 数字 },
  "stopLoss": { "price": 数字, "type": "类型" },
  "takeProfit": { "price": 数字, "riskRewardRatio": "比值" },
  "warnings": ["警告1", "警告2"]
}
直接输出 JSON，不要 markdown 代码块。`,
  manager: `

## 输出格式（严格遵守，纯 JSON）
{
  "signal": "LONG" 或 "SHORT" 或 "HOLD",
  "conviction": 1到100的数字,
  "summary": "至少4-5句详细决策分析（中文）",
  "reasoning": "详细推理过程（5-8句）",
  "action": { "type": "操作类型", "entry": 价格或null, "stopLoss": 价格或null, "takeProfit": 价格或null },
  "dissent": "异议说明"
}
直接输出 JSON，不要 markdown 代码块。`,
};

function getPrompt(agentId, requestCustoms, context) {
  const def = DEFAULT_PROMPTS[agentId];
  if (!def) throw new Error(`Unknown agent: ${agentId}`);

  // Priority: request body custom > file custom > dynamic default
  const reqCustom  = requestCustoms?.[agentId]?.systemPrompt;
  const fileCustom = loadCustomPrompts()[agentId]?.systemPrompt;
  const customPrompt = reqCustom || fileCustom;

  // Build dynamic system prompt based on instrument/type
  const inst = context?.instrument || 'BTC-USDT';
  const instType = context?.instType || 'SWAP';
  const tokenLabel = inst.replace('-USDT', '');
  const typeLabel = instType === 'SPOT' ? '现货' : '永续合约';

  // If custom prompt exists, ALWAYS append JSON format suffix to guarantee valid output.
  // Even if the user's prompt includes some format text, the suffix ensures the agent
  // always knows exactly what JSON schema to output.
  let finalPrompt;
  if (agentId === 'manager' && context?.noSubAgents) {
    finalPrompt = buildNoSubAgentManagerPrompt(tokenLabel, typeLabel, instType);
  } else if (customPrompt) {
    finalPrompt = customPrompt + (OUTPUT_FORMAT_SUFFIX[agentId] || '');
  } else {
    finalPrompt = buildSystemPrompt(agentId, tokenLabel, typeLabel, instType);
  }

  // Append skill instructions to system prompt if skills are enabled
  const enabledSkills = context?.enabledSkills?.[agentId] || [];
  const skillInstr = getSkillInstructions(agentId, enabledSkills);
  if (skillInstr) finalPrompt += skillInstr;

  return {
    ...def,
    systemPrompt: finalPrompt,
  };
}

// ─── Build User Messages with Context ───────────────────────────────

/**
 * Build the user message for an agent, injecting live market data
 * @param {string} agentId
 * @param {Object} ctx - { analysisRaw, positions, ticker, candles, mode, balances, instrument, instType, disabledAgents, macroReport, technicalReport, riskReport }
 * @returns {string}
 */
function buildAgentMessage(agentId, ctx) {
  const instLabel = (ctx.instrument || 'BTC-USDT').replace('-USDT', '');
  const typeLabel = (ctx.instType || 'SWAP') === 'SPOT' ? '现货' : '永续合约';

  const priceStr = ctx.ticker?.last ? `$${parseFloat(ctx.ticker.last).toLocaleString()}` : '未知';
  const change24h = ctx.ticker?.open24h
    ? ((parseFloat(ctx.ticker.last) - parseFloat(ctx.ticker.open24h)) / parseFloat(ctx.ticker.open24h) * 100).toFixed(2) + '%'
    : '';

  const posLines = (ctx.positions || []).map(p => {
    const dir   = p.pos > 0 ? '多仓' : '空仓';
    const sz    = Math.abs(p.pos);
    const entry = p.avgPx ? `$${p.avgPx.toLocaleString()}` : '-';
    const mark  = p.markPx ? `$${p.markPx.toLocaleString()}` : '-';
    const upl   = p.upl != null ? (p.upl >= 0 ? `+$${p.upl.toFixed(2)}` : `-$${Math.abs(p.upl).toFixed(2)}`) : '-';
    return `${p.instId} ${dir} ${sz}张 ${p.lever}× | 均价${entry} 标记${mark} 浮盈${upl}`;
  }).join('\n') || '无持仓';

  const balStr = (ctx.balances || []).map(b => `${b.ccy}: $${b.eq?.toFixed(2)}`).join(', ') || '未知';

  const disabledNote = (ctx.disabledAgents || []).length > 0
    ? `注意：以下分析师已被禁用：${ctx.disabledAgents.join(', ')}。请仅基于可用报告做出判断。\n\n`
    : '';

  // Market data section (OI, L/S ratio, funding rate)
  const mdStr = _formatMarketData(ctx.marketData);
  // User rules section
  const rulesStr = ctx.userRulesText || '';
  // Skills data (pre-computed analysis injected per agent)
  const enabledSkills = ctx.enabledSkills || {};

  switch (agentId) {
    case 'macro':
      return `当前时间: ${new Date().toISOString()}
${instLabel} 当前价格: ${priceStr}  24h变化: ${change24h}
交易品种: ${instLabel} ${typeLabel}
账户模式: ${ctx.mode === 'live' ? '实盘' : '模拟盘'}
当前持仓:
${posLines}
账户余额: ${balStr}
${mdStr}
请分析当前宏观环境对 ${instLabel} ${typeLabel}的影响。${rulesStr}${runSkillsForAgent('macro', enabledSkills.macro || [], ctx)}`;

    case 'technical':
      return `当前时间: ${new Date().toISOString()}
${instLabel} 当前价格: ${priceStr}
交易品种: ${instLabel} ${typeLabel}

以下是最新的技术指标分析报告：
${ctx.analysisRaw || '无分析数据'}

当前持仓:
${posLines}
${mdStr}
请基于以上技术指标数据给出你对 ${instLabel} 的技术面判断。${rulesStr}${runSkillsForAgent('technical', enabledSkills.technical || [], ctx)}`;

    case 'risk':
      return `当前时间: ${new Date().toISOString()}
${instLabel} 当前价格: ${priceStr}
交易品种: ${instLabel} ${typeLabel}
账户模式: ${ctx.mode === 'live' ? '实盘（请保守建议）' : '模拟盘（可适度激进）'}
账户余额: ${balStr}

当前持仓:
${posLines}

技术指标概要：
${ctx.analysisRaw || '无分析数据'}
${mdStr}
请评估 ${instLabel} ${typeLabel}当前风险水平并给出仓位管理建议。${rulesStr}${runSkillsForAgent('risk', enabledSkills.risk || [], ctx)}`;

    case 'manager':
      if (ctx.noSubAgents) {
        // No sub-agent reports — provide raw market data for independent decision
        // Rules placed FIRST (before data) so LLM processes them with highest priority
        const candleSummary = _buildCandleSummary(ctx.candles, 10);
        return `当前时间: ${new Date().toISOString()}
${instLabel} 当前价格: ${priceStr}  24h变化: ${change24h}
交易品种: ${instLabel} ${typeLabel}
账户模式: ${ctx.mode === 'live' ? '实盘' : '模拟盘'}
当前持仓:
${posLines}
账户余额: ${balStr}
${rulesStr}
## 近期K线数据（从旧到新）
${candleSummary}

## 技术指标数据
${ctx.analysisRaw || '无分析数据'}
${mdStr}
请根据以上用户规则和市场数据做出交易决策。你的 reasoning 中必须明确提及每条用户规则。${runSkillsForAgent('manager', enabledSkills.manager || [], ctx)}`;
      }
      return `${disabledNote}当前时间: ${new Date().toISOString()}
${instLabel} 当前价格: ${priceStr}
交易品种: ${instLabel} ${typeLabel}
账户模式: ${ctx.mode === 'live' ? '实盘' : '模拟盘'}
当前持仓:
${posLines}
${rulesStr}
## 宏观分析师报告
${ctx.macroReport || '暂无'}

## 技术分析师报告
${ctx.technicalReport || '暂无'}

## 风险分析师报告
${ctx.riskReport || '暂无'}
${mdStr}
请综合以上用户规则和分析师报告做出 ${instLabel} ${typeLabel}的最终交易决策。如有用户规则，reasoning 中必须先逐条说明按权重执行情况。${runSkillsForAgent('manager', enabledSkills.manager || [], ctx)}`;

    default:
      return '';
  }
}

function _formatMarketData(md) {
  if (!md) return '';
  const parts = [];
  if (md.openInterest) {
    parts.push(`持仓量(OI): ${md.openInterest.oiCcy?.toLocaleString() || md.openInterest.oi?.toLocaleString() || '-'}`);
  }
  if (md.longShortRatio) {
    parts.push(`多空比: 多${(md.longShortRatio.longRatio * 100).toFixed(1)}% / 空${(md.longShortRatio.shortRatio * 100).toFixed(1)}% (比值: ${md.longShortRatio.lsRatio?.toFixed(2) || '-'})`);
  }
  if (md.fundingRate) {
    parts.push(`资金费率: ${(md.fundingRate.fundingRate * 100).toFixed(4)}%` +
      (md.fundingRate.nextFundingRate ? ` (下期预测: ${(md.fundingRate.nextFundingRate * 100).toFixed(4)}%)` : ''));
  }
  return parts.length ? '\n## 合约市场数据\n' + parts.join('\n') + '\n' : '';
}

module.exports = {
  DEFAULT_PROMPTS,
  buildSystemPrompt,
  loadCustomPrompts,
  saveCustomPrompts,
  getPrompt,
  buildAgentMessage,
};
