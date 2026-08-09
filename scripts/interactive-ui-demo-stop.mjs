#!/usr/bin/env node
import { stopInteractiveUiDemo } from './lib/interactive-ui-demo-lifecycle.mjs';

try {
  await stopInteractiveUiDemo();
} catch (error) {
  console.error(`[interactive-ui-demo] Stop failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
