/**
 * OKX AI Trading Co-Pilot — MCP Server
 * Registers all tools and resources for OpenClaw / Claude Desktop / any MCP client
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerMarketDataTools } from './tools/market-data.mjs';
import { registerAccountTools } from './tools/account.mjs';
import { registerTradingTools } from './tools/trading.mjs';
import { registerCopilotTools } from './tools/copilot.mjs';
import { registerRulesTools } from './tools/rules.mjs';
import { registerSkillsTools } from './tools/skills.mjs';
import { registerConfigTools } from './tools/config.mjs';

export function createServer() {
  const server = new McpServer({
    name: 'okx-trade-copilot',
    version: '1.0.0',
  });

  // Register all tool groups
  registerMarketDataTools(server);   // 4 tools: ticker, candles, analysis, market-data
  registerAccountTools(server);      // 2 tools: balance, positions
  registerTradingTools(server);      // 2 tools: place_order, close_position
  registerCopilotTools(server);      // 3 tools: run_copilot, run_single_agent, trading_plan
  registerRulesTools(server);        // 3 tools: list, evaluate, add
  registerSkillsTools(server);       // 2 tools: list_skills, configure_skills
  registerConfigTools(server);       // 3 tools: get_prompts, update_prompt, set_llm_config

  return server;
}
