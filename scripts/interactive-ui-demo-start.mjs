#!/usr/bin/env node
import { startInteractiveUiDemo } from './lib/interactive-ui-demo-lifecycle.mjs';

try {
  await startInteractiveUiDemo();
} catch (error) {
  console.error(`[interactive-ui-demo] Start failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
