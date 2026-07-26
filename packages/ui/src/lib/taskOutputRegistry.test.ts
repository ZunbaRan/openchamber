import { describe, expect, test } from 'bun:test';
import type { Message, Part } from '@opencode-ai/sdk/v2';

import {
  createEmptyTaskOutputRegistry,
  observeTaskOutputs,
} from './taskOutputRegistry';

const message = (id: string, role: 'user' | 'assistant'): Message => ({ id, role } as Message);

describe('task output registry', () => {
  test('does not backfill completed outputs from an existing session', () => {
    const parts = {
      assistant: [{
        id: 'tool-old',
        sessionID: 'session',
        messageID: 'assistant',
        callID: 'call-old',
        type: 'tool',
        tool: 'write',
        state: { status: 'completed', input: { filePath: 'old.md' } },
      } as unknown as Part],
    };
    const observed = observeTaskOutputs(
      createEmptyTaskOutputRegistry(),
      [message('assistant', 'assistant')],
      parts,
      '/repo',
      1,
    );
    expect(observed.outputs).toEqual([]);
    expect(observed.seen['tool-old']).toBe('completed');
  });

  test('records only a newly completed authoritative write and deduplicates its path', () => {
    const base = observeTaskOutputs(
      createEmptyTaskOutputRegistry(),
      [message('assistant', 'assistant')],
      {
        assistant: [{
          id: 'tool-write',
          sessionID: 'session',
          messageID: 'assistant',
          callID: 'call-write',
          type: 'tool',
          tool: 'write',
          state: { status: 'running', input: { filePath: 'report.md' } },
        } as unknown as Part],
      },
      '/repo',
      1,
    );
    const completed = observeTaskOutputs(
      base,
      [message('assistant', 'assistant')],
      {
        assistant: [{
          id: 'tool-write',
          sessionID: 'session',
          messageID: 'assistant',
          callID: 'call-write',
          type: 'tool',
          tool: 'write',
          state: { status: 'completed', input: { filePath: 'report.md' } },
        } as unknown as Part],
      },
      '/repo',
      2,
    );
    expect(completed.outputs.map((entry) => entry.path)).toEqual(['/repo/report.md']);
    expect(completed.outputs[0]?.modifications).toBe(1);
  });
});
