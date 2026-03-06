/**
 * AI Co-Pilot Tools — run full analysis, single agent, and generate trading plan
 * Replicates context assembly from server.js:727-808
 */

import { z } from 'zod';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { runCoPilotCycle, runSubAgent } = require('../../lib/copilot.js');
const { analyze } = require('../../lib/analyze.js');
const { prefetchSkillData } = require('../../lib/skills.js');
const { formatSoftRulesForPrompt, loadRules } = require('../../lib/user-rules.js');
const { generateTradingPlan } = require('../../lib/trading-plan.js');

import { getClient, getPublicClient, getMode, hasCredentials, hasLLMKey } from '../client-factory.mjs';

// ─── Helper: assemble context (mirrors server.js /api/copilot/analyze) ───

async function assembleContext(opts = {}) {
  const instrument = opts.instrument || 'BTC-USDT';
  const instType = opts.instType || 'SWAP';
  const mode = getMode();
  const isSpot = instType === 'SPOT';

  // Use authenticated client if available, else public
  const c = hasCredentials() ? getClient() : getPublicClient();
  const pubC = getPublicClient();

  // Parallel fetch: ticker, positions, balance
  const [ticker, positions, balanceArr] = await Promise.all([
    isSpot ? pubC.fetchSpotTicker(instrument) : pubC.fetchTicker(instrument),
    hasCredentials()
      ? (isSpot ? Promise.resolve([]) : c.fetchPositions('SWAP'))
      : Promise.resolve([]),
    hasCredentials() ? c.fetchBalance() : Promise.resolve([]),
  ]);

  // Candles + technical analysis
  const candles = isSpot
    ? await pubC.fetchSpotCandles(instrument, '15m', 200)
    : await pubC.fetchCandles(instrument, '15m', 200);
  const result = analyze(candles, instrument, '15m');

  // Market data for SWAP instruments
  let marketData = null;
  if (!isSpot) {
    try {
      const [oi, lsArr, funding] = await Promise.all([
        pubC.fetchOpenInterest(instrument),
        pubC.fetchLongShortRatio(instrument, '5m'),
        pubC.fetchFundingRate(instrument),
      ]);
      const latestLS = lsArr.length ? lsArr[lsArr.length - 1] : null;
      marketData = { openInterest: oi, longShortRatio: latestLS, fundingRate: funding };
    } catch (e) { /* non-fatal */ }
  }

  // User rules
  const userRules = loadRules();
  const userRulesText = formatSoftRulesForPrompt(userRules, opts.softRuleWeight);

  // Pre-fetch external skill data
  const enabledSkills = opts.enabledSkills || {};
  await prefetchSkillData(enabledSkills).catch(() => {});

  return {
    analysisRaw: result?.raw || '',
    positions: positions || [],
    ticker,
    candles,
    mode,
    balances: balanceArr || [],
    customPrompts: opts.customPrompts || null,
    disabledAgents: opts.disabledAgents || [],
    enabledSkills,
    instrument,
    instType,
    marketData,
    userRulesText,
  };
}

// ─── No-op broadcast collector (MCP is synchronous, no SSE) ──────────

function createCollector() {
  const events = [];
  const broadcast = (msg) => { events.push(msg); };
  return { broadcast, events };
}

export function registerCopilotTools(server) {

  // ─── okx_run_copilot ──────────────────────────────
  server.tool(
    'okx_run_copilot',
    'Run full 4-agent AI analysis (macro + technical + risk + portfolio manager). Returns signal, conviction, summary, reasoning, and suggested action. Requires LLM API key (MINIMAX_API_KEY).',
    {
      instrument: z.string().default('BTC-USDT').describe('Trading pair, e.g. BTC-USDT'),
      instType: z.enum(['SWAP', 'SPOT']).default('SWAP'),
      disabledAgents: z.array(z.enum(['macro', 'technical', 'risk'])).default([]).describe('Agents to skip'),
      enabledSkills: z.record(z.array(z.string())).optional().describe('Skills per agent, e.g. {"technical":["fibonacci-levels","candlestick-patterns"]}'),
    },
    async ({ instrument, instType, disabledAgents, enabledSkills }) => {
      if (!hasLLMKey()) {
        return { content: [{ type: 'text', text: '❌ LLM API key not configured. Set MINIMAX_API_KEY environment variable to run AI analysis.' }] };
      }

      try {
        const context = await assembleContext({ instrument, instType, disabledAgents, enabledSkills: enabledSkills || {} });
        const { broadcast } = createCollector();
        const result = await runCoPilotCycle(context, broadcast);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              status: 'complete',
              mode: getMode(),
              instrument,
              instType,
              signal: result.signal,
              conviction: result.conviction,
              summary: result.summary,
              reasoning: result.reasoning,
              action: result.action,
              dissent: result.dissent,
              agents: result.agents,
            }, null, 2),
          }],
        };
      } catch (e) {
        return { content: [{ type: 'text', text: `❌ Co-Pilot analysis failed: ${e.message}` }] };
      }
    }
  );

  // ─── okx_run_single_agent ─────────────────────────
  server.tool(
    'okx_run_single_agent',
    'Run a single AI analysis agent (macro, technical, or risk). Faster than full co-pilot. Returns the agent\'s analysis report.',
    {
      agentId: z.enum(['macro', 'technical', 'risk']).describe('Which agent to run'),
      instrument: z.string().default('BTC-USDT'),
      instType: z.enum(['SWAP', 'SPOT']).default('SWAP'),
      enabledSkills: z.record(z.array(z.string())).optional().describe('Skills per agent'),
    },
    async ({ agentId, instrument, instType, enabledSkills }) => {
      if (!hasLLMKey()) {
        return { content: [{ type: 'text', text: '❌ LLM API key not configured. Set MINIMAX_API_KEY environment variable.' }] };
      }

      try {
        const context = await assembleContext({ instrument, instType, enabledSkills: enabledSkills || {} });
        const { broadcast } = createCollector();
        const result = await runSubAgent(agentId, context, broadcast);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              status: 'complete',
              mode: getMode(),
              agentId,
              instrument,
              instType,
              content: result.content,
              reasoning: result.reasoning,
              parsed: result.parsed,
            }, null, 2),
          }],
        };
      } catch (e) {
        return { content: [{ type: 'text', text: `❌ Agent ${agentId} failed: ${e.message}` }] };
      }
    }
  );

  // ─── okx_generate_trading_plan ─────────────────────
  server.tool(
    'okx_generate_trading_plan',
    'Generate a detailed executable trading plan from a co-pilot analysis result. Must run okx_run_copilot first to get the analysis result, then pass it here.',
    {
      coPilotResult: z.object({
        signal: z.string(),
        conviction: z.number(),
        summary: z.string().optional(),
        reasoning: z.string().optional(),
        action: z.record(z.any()).optional(),
        agents: z.record(z.any()).optional(),
      }).describe('Result from okx_run_copilot'),
      instrument: z.string().default('BTC-USDT'),
    },
    async ({ coPilotResult, instrument }) => {
      if (!hasLLMKey()) {
        return { content: [{ type: 'text', text: '❌ LLM API key not configured. Set MINIMAX_API_KEY environment variable.' }] };
      }
      if (!hasCredentials()) {
        return { content: [{ type: 'text', text: '❌ OKX API key not configured. Cannot fetch positions/balance for plan generation.' }] };
      }

      try {
        const c = getClient();
        const [positions, balanceArr] = await Promise.all([
          c.fetchPositions(),
          c.fetchBalance(),
        ]);

        const { broadcast } = createCollector();
        const { plan, reasoning } = await generateTradingPlan(coPilotResult, {
          positions: positions || [],
          balances: balanceArr || [],
          mode: getMode(),
        }, broadcast);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              status: 'complete',
              mode: getMode(),
              plan,
              reasoning,
            }, null, 2),
          }],
        };
      } catch (e) {
        return { content: [{ type: 'text', text: `❌ Trading plan generation failed: ${e.message}` }] };
      }
    }
  );
}
