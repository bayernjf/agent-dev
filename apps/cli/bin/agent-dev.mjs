#!/usr/bin/env node
// Shells and MCP clients need an executable JavaScript file, while every package in this repo
// stays untranspiled TypeScript. Registering tsx in-process is the shortest bridge between the
// two, and keeps stdout free for the MCP stdio protocol.
import { register } from 'tsx/esm/api';

register();
await import('../src/index.ts');
