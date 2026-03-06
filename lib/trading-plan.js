/**
 * Trading Plan Generator
 * Takes co-pilot result and generates a detailed executable trading plan
 */

const { streamCompletion } = require('./minimax-stream');

const MINIMAX_API_KEY = (process.env.MINIMAX_API_KEY || '').trim();

const PLAN_SYSTEM_PROMPT = `你是 OKX 交易所的 AI 交易计划助手。
基于 Co-Pilot 的分析结论和当前持仓信息，生成详细的可执行交易计划。

## 计划生成规则
1. 每个计划包含 2-4 个执行步骤（开仓 + 止盈 + 止损，可选加仓/减仓）
2. 止损距离基于 ATR 或分析师建议
3. 止盈/止损必须是具体价格数字
4. 风险回报比 >= 1.5

## 输出格式（纯 JSON，不要 markdown 代码块）
{
  "name": "策略名称（如：合约做多 AI Co-Pilot）",
  "direction": "long" 或 "short",
  "tag": "保守" 或 "稳健" 或 "进取",
  "desc": "一句话策略描述",
  "executionSteps": [
    {
      "step": 步骤编号,
      "action": "动作描述",
      "type": "market" 或 "limit" 或 "tp" 或 "sl",
      "price": 具体价格数字,
      "size": "金额或数量描述",
      "note": "操作理由"
    }
  ],
  "params": {
    "entry": 入场价,
    "tp": 止盈价,
    "sl": 止损价,
    "leverage": 杠杆倍数,
    "margin": 保证金金额
  },
  "risk": {
    "maxProfit": "+$金额",
    "maxLoss": "-$金额",
    "riskReward": "比值如1:1.9",
    "warning": "一句话风险提醒"
  }
}`;

/**
 * Generate a trading plan from co-pilot result
 * @param {Object} coPilotResult - from runCoPilotCycle
 * @param {Object} context - { positions, balances, mode }
 * @param {Function} broadcast - WS broadcast
 * @returns {Promise<Object>}
 */
async function generateTradingPlan(coPilotResult, context, broadcast) {
  const signal     = coPilotResult.signal;
  const action     = coPilotResult.action || {};
  const agents     = coPilotResult.agents || {};

  const posLines = (context.positions || []).map(p => {
    const dir = p.pos > 0 ? '多仓' : '空仓';
    return `${p.instId} ${dir} ${Math.abs(p.pos)}张 ${p.lever}× 均价$${p.avgPx}`;
  }).join('\n') || '无持仓';

  const balStr = (context.balances || []).map(b => `${b.ccy}: $${b.eq?.toFixed(2)}`).join(', ') || '未知';

  const userMsg = `## Co-Pilot 决策结果
信号: ${signal}
信心度: ${coPilotResult.conviction}%
摘要: ${coPilotResult.summary}

## 建议操作
类型: ${action.type || signal}
建议杠杆: ${action.suggestedLeverage || '10'}x
入场价: ${action.entry || '市价'}
止损: ${action.stopLoss || '待定'}
止盈: ${action.takeProfit || '待定'}

## 各分析师摘要
宏观: ${agents.macro?.summary || '-'}（${agents.macro?.bias || '-'}）
技术: ${agents.technical?.summary || '-'}（${agents.technical?.bias || '-'}）
风险: ${agents.risk?.summary || '-'}（${agents.risk?.riskLevel || '-'}）

## 当前持仓
${posLines}

## 账户余额
${balStr}
模式: ${context.mode === 'live' ? '实盘' : '模拟盘'}

请生成具体的交易执行计划。`;

  broadcast({ type: 'tradingPlanStart' });

  const result = await streamCompletion({
    apiKey:       MINIMAX_API_KEY,
    systemPrompt: PLAN_SYSTEM_PROMPT,
    userMessage:  userMsg,
    maxTokens:    2048,
    temperature:  0.3,
    onReasoning: (text) => {
      broadcast({ type: 'tradingPlanToken', tokenType: 'reasoning', text });
    },
    onContent: (text) => {
      broadcast({ type: 'tradingPlanToken', tokenType: 'content', text });
    },
  });

  let plan = {};
  try { plan = JSON.parse(result.content.trim()); } catch (_) {
    const m = result.content.match(/\{[\s\S]*\}/);
    if (m) try { plan = JSON.parse(m[0]); } catch (_) {}
  }

  // Recalculate risk metrics if we have entry/tp/sl
  if (plan.params) {
    const { entry, tp, sl, leverage, margin } = plan.params;
    if (entry && tp && sl && leverage && margin) {
      const isLong    = plan.direction === 'long';
      const maxProfit = Math.abs((tp - entry) / entry * leverage * margin);
      const maxLoss   = Math.abs((entry - sl) / entry * leverage * margin);
      plan.risk = plan.risk || {};
      plan.risk.maxProfit = `+$${maxProfit.toFixed(0)}`;
      plan.risk.maxLoss   = `-$${maxLoss.toFixed(0)}`;
      plan.risk.riskReward = maxLoss > 0 ? `1:${(maxProfit / maxLoss).toFixed(1)}` : '-';
    }
  }

  broadcast({ type: 'tradingPlanResult', plan, reasoning: result.reasoning });
  return { plan, reasoning: result.reasoning };
}

module.exports = { generateTradingPlan };
