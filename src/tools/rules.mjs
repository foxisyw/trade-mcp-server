/**
 * Rules Tools — list, evaluate, and add trading rules
 * Wraps lib/user-rules.js
 */

import { z } from 'zod';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const {
  loadRules,
  saveRules,
  evaluateHardRules,
  autoClassifyRule,
  buildRuleParsePrompt,
  KNOWN_METRICS,
  KNOWN_ACTIONS,
} = require('../../lib/user-rules.js');

const { streamCompletion } = require('../../lib/minimax-stream.js');

import { getPublicClient, getClient, getMode, hasCredentials, hasLLMKey } from '../client-factory.mjs';

export function registerRulesTools(server) {

  // ─── okx_list_rules ────────────────────────────────
  server.tool(
    'okx_list_rules',
    'List all user trading rules. Hard rules are programmatic checks (metric + operator + threshold → block/allow). Soft rules are natural language injected into AI prompts.',
    {},
    async () => {
      const rules = loadRules();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            count: rules.length,
            hardRules: rules.filter(r => r.type === 'hard').map(r => ({
              id: r.id,
              readable: r.readable,
              enabled: r.enabled,
              structured: r.structured,
            })),
            softRules: rules.filter(r => r.type === 'soft').map(r => ({
              id: r.id,
              readable: r.readable,
              enabled: r.enabled,
            })),
            availableMetrics: Object.entries(KNOWN_METRICS)
              .filter(([k]) => k !== '_unconditional')
              .map(([k, v]) => ({ id: k, label: v.label })),
            availableActions: Object.entries(KNOWN_ACTIONS).map(([k, v]) => ({ id: k, label: v.label })),
          }, null, 2),
        }],
      };
    }
  );

  // ─── okx_evaluate_rules ────────────────────────────
  server.tool(
    'okx_evaluate_rules',
    'Evaluate hard rules against current market state. Returns whether a proposed trade (signal) would be allowed or blocked.',
    {
      signal: z.enum(['LONG', 'SHORT', 'HOLD']).describe('Proposed trade direction'),
      instrument: z.string().default('BTC-USDT'),
    },
    async ({ signal, instrument }) => {
      const rules = loadRules();
      const hardRules = rules.filter(r => r.type === 'hard' && r.enabled);

      if (!hardRules.length) {
        return { content: [{ type: 'text', text: JSON.stringify({ allowed: true, message: 'No hard rules configured.', violations: [] }, null, 2) }] };
      }

      try {
        const pubC = getPublicClient();
        const c = hasCredentials() ? getClient() : null;

        // Fetch market state for evaluation
        const [ticker, positions] = await Promise.all([
          pubC.fetchTicker(instrument),
          c ? c.fetchPositions('SWAP') : Promise.resolve([]),
        ]);

        let marketData = null;
        try {
          const [oi, lsArr, funding] = await Promise.all([
            pubC.fetchOpenInterest(instrument),
            pubC.fetchLongShortRatio(instrument, '5m'),
            pubC.fetchFundingRate(instrument),
          ]);
          const latestLS = lsArr.length ? lsArr[lsArr.length - 1] : null;
          marketData = { openInterest: oi, longShortRatio: latestLS, fundingRate: funding };
        } catch (_) {}

        const activePositions = (positions || []).filter(p => Math.abs(parseFloat(p.pos || 0)) > 0);
        const totalExposure = activePositions.reduce((s, p) => s + parseFloat(p.notionalUsd || 0), 0);

        const state = {
          signal,
          ticker,
          price: parseFloat(ticker.last),
          positions: activePositions,
          totalExposureUSDT: totalExposure,
          marketData,
        };

        const { allowed, violations } = evaluateHardRules(rules, state);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              signal,
              instrument,
              allowed,
              violations: violations.map(v => ({
                rule: v.readable,
                action: v.action,
                metric: v.metric,
                current: v.current,
                threshold: v.threshold,
              })),
              message: allowed
                ? `✅ ${signal} trade is allowed by all hard rules.`
                : `🚫 ${signal} trade is BLOCKED by ${violations.length} rule(s).`,
            }, null, 2),
          }],
        };
      } catch (e) {
        return { content: [{ type: 'text', text: `❌ Rule evaluation failed: ${e.message}` }] };
      }
    }
  );

  // ─── okx_add_rule ──────────────────────────────────
  server.tool(
    'okx_add_rule',
    'Add a new trading rule using natural language. The system auto-classifies it as hard (quantitative) or soft (qualitative). Examples: "Block all trades when funding rate > 0.1%", "Prefer to follow the trend".',
    {
      text: z.string().describe('Natural language rule, e.g. "多空比大于2时禁止做多" or "Block long when L/S ratio > 2"'),
    },
    async ({ text }) => {
      // Try deterministic classification first
      const auto = autoClassifyRule(text);
      let classified = auto;

      if (!classified) {
        // Need LLM for classification
        if (!hasLLMKey()) {
          // Fall back to soft rule
          classified = {
            type: 'soft',
            structured: null,
            readable: text,
          };
        } else {
          try {
            const prompt = buildRuleParsePrompt(text);
            const result = await streamCompletion({
              apiKey: process.env.MINIMAX_API_KEY,
              systemPrompt: 'You are a trading rule parser. Output JSON only.',
              userMessage: prompt,
              maxTokens: 512,
              temperature: 0.1,
              onReasoning: () => {},
              onContent: () => {},
            });
            try {
              classified = JSON.parse(result.content.trim());
            } catch {
              const m = result.content.match(/\{[\s\S]*\}/);
              if (m) classified = JSON.parse(m[0]);
            }
          } catch (e) {
            classified = { type: 'soft', structured: null, readable: text };
          }
        }
      }

      const rules = loadRules();
      const newRule = {
        id: 'rule_' + Date.now(),
        type: classified.type,
        enabled: true,
        naturalLanguage: text,
        readable: classified.readable || text,
        structured: classified.structured || null,
        createdAt: new Date().toISOString(),
      };
      rules.push(newRule);
      saveRules(rules);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status: 'added',
            rule: newRule,
            totalRules: rules.length,
            message: classified.type === 'hard'
              ? `✅ Hard rule added: ${classified.readable}. This rule will be automatically enforced.`
              : `✅ Soft rule added: ${classified.readable}. This rule will be injected into AI prompts.`,
          }, null, 2),
        }],
      };
    }
  );
}
