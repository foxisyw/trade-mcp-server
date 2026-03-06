/**
 * Config Tools — manage agent prompts and LLM configuration
 * Persistent storage at ~/.okx-trade-mcp/
 */

import { z } from 'zod';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const require = createRequire(import.meta.url);
const { DEFAULT_PROMPTS, buildSystemPrompt, loadCustomPrompts, saveCustomPrompts } = require('../../lib/prompts.js');

const CONFIG_DIR = path.join(os.homedir(), '.okx-trade-mcp');
const LLM_CONFIG_FILE = path.join(CONFIG_DIR, 'llm-config.json');

// ─── LLM Config Persistence ─────────────────────────

function loadLLMConfig() {
  try {
    if (fs.existsSync(LLM_CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(LLM_CONFIG_FILE, 'utf8'));
    }
  } catch (_) {}
  return {
    provider: 'minimax',
    model: 'MiniMax-M2.5-highspeed',
    temperature: 0.5,
    maxTokens: 2048,
  };
}

function saveLLMConfig(config) {
  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(LLM_CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error('[llm-config] save error:', e.message);
  }
}

export function registerConfigTools(server) {

  // ─── okx_get_prompts ───────────────────────────────
  server.tool(
    'okx_get_prompts',
    'View the current system prompts for all 4 AI agents. Shows both default and custom prompts.',
    {
      agentId: z.enum(['macro', 'technical', 'risk', 'manager', 'all']).default('all').describe('Which agent prompt to view'),
    },
    async ({ agentId }) => {
      const customs = loadCustomPrompts();
      const agents = agentId === 'all'
        ? ['macro', 'technical', 'risk', 'manager']
        : [agentId];

      const result = {};
      for (const id of agents) {
        const meta = DEFAULT_PROMPTS[id];
        const customPrompt = customs[id]?.systemPrompt || null;
        const defaultPrompt = buildSystemPrompt(id, 'BTC', '永续合约', 'SWAP');

        result[id] = {
          name: meta.name,
          nameZh: meta.nameZh,
          color: meta.color,
          icon: meta.icon,
          hasCustomPrompt: !!customPrompt,
          activePrompt: customPrompt
            ? '(Custom) ' + customPrompt.substring(0, 200) + (customPrompt.length > 200 ? '...' : '')
            : '(Default) ' + defaultPrompt.substring(0, 200) + '...',
          customPrompt: customPrompt || null,
        };
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            agents: result,
            note: 'Use okx_update_prompt to customize a specific agent\'s prompt. Set prompt to null to reset to default.',
          }, null, 2),
        }],
      };
    }
  );

  // ─── okx_update_prompt ─────────────────────────────
  server.tool(
    'okx_update_prompt',
    'Customize an agent\'s system prompt. The JSON output format suffix is automatically appended. Set prompt to empty string to reset to default.',
    {
      agentId: z.enum(['macro', 'technical', 'risk', 'manager']).describe('Which agent to customize'),
      prompt: z.string().describe('New system prompt text. Empty string = reset to default.'),
    },
    async ({ agentId, prompt }) => {
      const customs = loadCustomPrompts();

      if (!prompt || prompt.trim() === '') {
        // Reset to default
        delete customs[agentId];
        saveCustomPrompts(customs);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              status: 'reset',
              agentId,
              message: `${agentId} prompt reset to default.`,
            }, null, 2),
          }],
        };
      }

      customs[agentId] = { systemPrompt: prompt.trim() };
      saveCustomPrompts(customs);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status: 'updated',
            agentId,
            promptPreview: prompt.substring(0, 200) + (prompt.length > 200 ? '...' : ''),
            message: `${agentId} prompt updated. JSON output format suffix will be auto-appended.`,
          }, null, 2),
        }],
      };
    }
  );

  // ─── okx_set_llm_config ────────────────────────────
  server.tool(
    'okx_set_llm_config',
    'Configure LLM settings (temperature, max tokens). v1 supports MiniMax only; architecture is ready for future providers.',
    {
      temperature: z.number().min(0).max(1).optional().describe('LLM temperature (0-1)'),
      maxTokens: z.number().min(256).max(8192).optional().describe('Max output tokens'),
      model: z.string().optional().describe('Model name (default: MiniMax-M2.5-highspeed)'),
    },
    async ({ temperature, maxTokens, model }) => {
      const config = loadLLMConfig();

      if (temperature !== undefined) config.temperature = temperature;
      if (maxTokens !== undefined) config.maxTokens = maxTokens;
      if (model) config.model = model;

      saveLLMConfig(config);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status: 'updated',
            config,
            note: 'LLM config saved. Changes apply to next AI analysis call.',
            supportedProviders: ['minimax (current)', 'openai (planned v2)', 'anthropic (planned v2)'],
          }, null, 2),
        }],
      };
    }
  );
}
