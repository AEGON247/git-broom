#!/usr/bin/env node

import pc from 'picocolors';
import { runCli } from './cli.js';

runCli().catch((err) => {
  console.error(pc.red(`Unexpected fatal error: ${err.message}`));
  process.exit(1);
});
