/**
 * AI Co-Pilot Orchestration Engine
 * Runs 3 sub-agents in parallel + Portfolio Manager sequentially
 */

const { streamCompletion } = require('./minimax-stream');
const { getPrompt, buildAgentMessage } = require('./prompts');

const MINIMAX_API_KEY = (process.env.MINIMAX_API_KEY || '').trim();

// ─── JSON Parsing with Fallback ─────────────────────────────────────

function safeParseJSON(text) {
  if (!text) return {};
  // Try direct parse
  try { return JSON.parse(text.trim()); } catch (_) {}
  // Try extracting JSON from text
  const m = text.match(/\{[\s\S]*\}/);
  if (m) try { return JSON.parse(m[0]); } catch (_) {}
  return {};
}

// ─── Run a Single Sub-Agent ─────────────────────────────────────────

/**
 * @param {string} agentId - 'macro' | 'technical' | 'risk'
 * @param {Object} context - { analysisRaw, positions, ticker, candles, mode, balances }
 * @param {Function} broadcast - (msg) => void, sends to all WS clients
 * @returns {Promise<{content: string, reasoning: string, parsed: Object}>}
 */
async function runSubAgent(agentId, context, broadcast) {
  const prompt  = getPrompt(agentId, context.customPrompts, context);
  const userMsg = buildAgentMessage(agentId, context);

  broadcast({
    type: 'agentStart',
    agentId,
    name: prompt.nameZh,
    color: prompt.color,
    icon: prompt.icon,
  });

  let lastReasoningLen = 0;
  let lastContentLen   = 0;

  const result = await streamCompletion({
    apiKey:       MINIMAX_API_KEY,
    systemPrompt: prompt.systemPrompt,
    userMessage:  userMsg,
    maxTokens:    2048,
    temperature:  0.5,
    onReasoning: (text) => {
      // Only send new portion to reduce WS traffic
      if (text.length > lastReasoningLen) {
        broadcast({ type: 'agentToken', agentId, tokenType: 'reasoning', text });
        lastReasoningLen = text.length;
      }
    },
    onContent: (text) => {
      if (text.length > lastContentLen) {
        broadcast({ type: 'agentToken', agentId, tokenType: 'content', text });
        lastContentLen = text.length;
      }
    },
  });

  const parsed = safeParseJSON(result.content);

  broadcast({
    type: 'agentDone',
    agentId,
    content:   result.content,
    reasoning: result.reasoning,
    parsed,
  });

  return { ...result, parsed };
}

// ─── Run Portfolio Manager ──────────────────────────────────────────

async function runPortfolioManager(agentResults, context, broadcast) {
  const noSubAgents = Object.keys(agentResults).length === 0;
  const managerCtx = {
    ...context,
    noSubAgents,
    macroReport:     agentResults.macro ? JSON.stringify(agentResults.macro.parsed || {}, null, 2) : '',
    technicalReport: agentResults.technical ? JSON.stringify(agentResults.technical.parsed || {}, null, 2) : '',
    riskReport:      agentResults.risk ? JSON.stringify(agentResults.risk.parsed || {}, null, 2) : '',
  };
  const prompt  = getPrompt('manager', context.customPrompts, managerCtx);
  const userMsg = buildAgentMessage('manager', managerCtx);

  broadcast({
    type: 'agentStart',
    agentId: 'manager',
    name:  prompt.nameZh,
    color: prompt.color,
    icon:  prompt.icon,
  });

  let lastReasoningLen = 0;
  let lastContentLen   = 0;

  const result = await streamCompletion({
    apiKey:       MINIMAX_API_KEY,
    systemPrompt: prompt.systemPrompt,
    userMessage:  userMsg,
    maxTokens:    2048,
    temperature:  0.5,
    onReasoning: (text) => {
      if (text.length > lastReasoningLen) {
        broadcast({ type: 'agentToken', agentId: 'manager', tokenType: 'reasoning', text });
        lastReasoningLen = text.length;
      }
    },
    onContent: (text) => {
      if (text.length > lastContentLen) {
        broadcast({ type: 'agentToken', agentId: 'manager', tokenType: 'content', text });
        lastContentLen = text.length;
      }
    },
  });

  const parsed = safeParseJSON(result.content);

  broadcast({
    type: 'agentDone',
    agentId: 'manager',
    content:   result.content,
    reasoning: result.reasoning,
    parsed,
  });

  return { ...result, parsed };
}

// ─── Full Co-Pilot Cycle ────────────────────────────────────────────

/**
 * Run one complete co-pilot analysis cycle
 * Phase 1: 3 sub-agents in parallel
 * Phase 2: Portfolio Manager synthesizes
 *
 * @param {Object} context
 * @param {Function} broadcast
 * @returns {Promise<Object>}
 */
async function runCoPilotCycle(context, broadcast) {
  const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  broadcast({ type: 'coPilotStart', runId, ts: Date.now() });

  try {
    // Phase 1: Run enabled sub-agents in parallel
    const disabled = new Set(context.disabledAgents || []);
    const agentIds = ['macro', 'technical', 'risk'].filter(id => !disabled.has(id));

    const results = await Promise.all(
      agentIds.map(id => runSubAgent(id, context, broadcast))
    );

    const agentResults = {};
    agentIds.forEach((id, i) => { agentResults[id] = results[i]; });

    // Broadcast skip events for disabled agents
    for (const id of disabled) {
      if (['macro', 'technical', 'risk'].includes(id)) {
        broadcast({ type: 'agentDone', agentId: id, content: '', reasoning: '', parsed: { disabled: true } });
      }
    }

    // Phase 2: Portfolio Manager synthesizes available reports
    const managerResult = await runPortfolioManager(agentResults, context, broadcast);

    const finalResult = {
      runId,
      ts:         Date.now(),
      signal:     managerResult.parsed.signal || 'HOLD',
      conviction: managerResult.parsed.conviction || 50,
      summary:    managerResult.parsed.summary || '',
      reasoning:  managerResult.parsed.reasoning || '',
      action:     managerResult.parsed.action || {},
      dissent:    managerResult.parsed.dissent || '',
      agents: {
        macro:     agentResults.macro
          ? { summary: agentResults.macro.parsed.summary, bias: agentResults.macro.parsed.bias, confidence: agentResults.macro.parsed.confidence }
          : null,
        technical: agentResults.technical
          ? { summary: agentResults.technical.parsed.summary, bias: agentResults.technical.parsed.bias, confidence: agentResults.technical.parsed.confidence }
          : null,
        risk:      agentResults.risk
          ? { summary: agentResults.risk.parsed.summary, riskLevel: agentResults.risk.parsed.riskLevel, confidence: agentResults.risk.parsed.confidence }
          : null,
      },
      fullReasoning: {
        macro:     agentResults.macro?.reasoning || '',
        technical: agentResults.technical?.reasoning || '',
        risk:      agentResults.risk?.reasoning || '',
        manager:   managerResult.reasoning,
      },
    };

    broadcast({ type: 'coPilotResult', ...finalResult });
    return finalResult;

  } catch (err) {
    console.error('[copilot] cycle error:', err.message);
    broadcast({ type: 'coPilotError', runId, error: err.message });
    throw err;
  }
}

// ─── Auto-Pilot ─────────────────────────────────────────────────────

let _autoPilotTimer   = null;
let _autoPilotRunning = false;

/**
 * Start auto-pilot: runs analysis cycles at fixed intervals
 * @param {Function} getContext - () => context object (re-fetched each cycle)
 * @param {Function} broadcast
 * @param {number} [intervalMs=600000] - 10 min default
 */
function startAutoPilot(getContext, broadcast, intervalMs = 10 * 60 * 1000) {
  if (_autoPilotRunning) return { ok: false, error: 'Already running' };
  _autoPilotRunning = true;
  broadcast({ type: 'autoPilotStatus', running: true });

  const cycle = async () => {
    if (!_autoPilotRunning) return;
    try {
      const ctx = typeof getContext === 'function' ? getContext() : getContext;
      await runCoPilotCycle(ctx, broadcast);
    } catch (e) {
      console.error('[autoPilot] cycle error:', e.message);
    }
  };

  // Run immediately, then on interval
  cycle();
  _autoPilotTimer = setInterval(cycle, intervalMs);
  return { ok: true };
}

function stopAutoPilot(broadcast) {
  _autoPilotRunning = false;
  if (_autoPilotTimer) { clearInterval(_autoPilotTimer); _autoPilotTimer = null; }
  broadcast({ type: 'autoPilotStatus', running: false });
  return { ok: true };
}

function isAutoPilotRunning() { return _autoPilotRunning; }

module.exports = {
  runCoPilotCycle,
  runSubAgent,
  runPortfolioManager,
  startAutoPilot,
  stopAutoPilot,
  isAutoPilotRunning,
};
