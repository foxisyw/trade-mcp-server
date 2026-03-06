/**
 * Skills Tools — list and configure analysis skills
 * Wraps lib/skills.js with persistent configuration
 */

import { z } from 'zod';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const require = createRequire(import.meta.url);
const { getSkillsMeta } = require('../../lib/skills.js');

// Persist skills config to ~/.okx-trade-mcp/
const CONFIG_DIR = path.join(os.homedir(), '.okx-trade-mcp');
const SKILLS_CONFIG_FILE = path.join(CONFIG_DIR, 'skills-config.json');

function loadSkillsConfig() {
  try {
    if (fs.existsSync(SKILLS_CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(SKILLS_CONFIG_FILE, 'utf8'));
    }
  } catch (_) {}
  return null; // null means "use defaults (all enabled)"
}

function saveSkillsConfig(config) {
  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(SKILLS_CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error('[skills-config] save error:', e.message);
  }
}

// Build default config: all skills enabled for their applicable agents
function getDefaultConfig() {
  const meta = getSkillsMeta();
  const config = {};
  for (const [id, skill] of Object.entries(meta)) {
    for (const agentId of skill.applicableAgents) {
      if (!config[agentId]) config[agentId] = [];
      config[agentId].push(id);
    }
  }
  return config;
}

export function registerSkillsTools(server) {

  // ─── okx_list_skills ───────────────────────────────
  server.tool(
    'okx_list_skills',
    'List all 6 available analysis skills with descriptions and which agents they apply to. Shows current enabled/disabled status.',
    {},
    async () => {
      const meta = getSkillsMeta();
      const config = loadSkillsConfig() || getDefaultConfig();

      const skills = Object.values(meta).map(skill => ({
        id: skill.id,
        name: skill.name,
        nameZh: skill.nameZh,
        description: skill.description,
        descriptionZh: skill.descriptionZh,
        detailZh: skill.detailZh,
        applicableAgents: skill.applicableAgents,
        enabledFor: skill.applicableAgents.filter(agentId =>
          (config[agentId] || []).includes(skill.id)
        ),
      }));

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            count: skills.length,
            skills,
            currentConfig: config,
            note: 'Use okx_configure_skills to enable/disable skills per agent.',
          }, null, 2),
        }],
      };
    }
  );

  // ─── okx_configure_skills ─────────────────────────
  server.tool(
    'okx_configure_skills',
    'Enable or disable specific skills for specific agents. Saves configuration persistently.',
    {
      agentId: z.enum(['macro', 'technical', 'risk', 'manager']).describe('Agent to configure'),
      enabledSkills: z.array(z.string()).describe('List of skill IDs to enable for this agent. Empty array = disable all.'),
    },
    async ({ agentId, enabledSkills }) => {
      const meta = getSkillsMeta();
      const config = loadSkillsConfig() || getDefaultConfig();

      // Validate skill IDs
      const validSkills = enabledSkills.filter(id => {
        const skill = meta[id];
        if (!skill) return false;
        if (!skill.applicableAgents.includes(agentId)) return false;
        return true;
      });

      const invalidSkills = enabledSkills.filter(id => !validSkills.includes(id));

      config[agentId] = validSkills;
      saveSkillsConfig(config);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status: 'updated',
            agentId,
            enabledSkills: validSkills,
            invalidSkills: invalidSkills.length ? invalidSkills : undefined,
            note: invalidSkills.length
              ? `Some skills were invalid or not applicable to ${agentId}: ${invalidSkills.join(', ')}`
              : `Skills for ${agentId} updated successfully.`,
            fullConfig: config,
          }, null, 2),
        }],
      };
    }
  );
}
