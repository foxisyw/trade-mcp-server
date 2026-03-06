#!/usr/bin/env node

/**
 * OKX AI Trading Co-Pilot — MCP Server Entry Point
 * Communicates via stdio (standard MCP transport)
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from '../src/server.mjs';

const server = createServer();
const transport = new StdioServerTransport();
await server.connect(transport);
