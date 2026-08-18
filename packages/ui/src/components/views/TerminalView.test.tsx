/**
 * Regression guard for the maintained-donor terminal tab handoff.
 *
 * ContextPanel pins a preferred terminal tab (an action or tool terminal) via
 * `preferredTabId={activeTab?.targetPath ?? null}`. TerminalView must adopt
 * that tab once its directory state exists, and must do nothing else: no
 * fallback tab creation, no close, no stream teardown — only a `setActiveTab`
 * when the donor's tab is known. These tests sniff the component source the
 * same way `__tests__/terminalViewportRemount.test.ts` does, avoiding broad
 * component mocking.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, 'TerminalView.tsx'), 'utf-8');

const effectStart = source.indexOf('if (!isTerminalVisible || !effectiveDirectory || !preferredTabId) return;');
const effectEnd = effectStart > -1 ? source.indexOf('}, [', effectStart) : -1;
const effectBody = effectStart > -1 && effectEnd > -1 ? source.slice(effectStart, effectEnd) : '';

describe('terminal view maintained-donor tab handoff', () => {
    test('accepts an optional preferredTabId prop defaulting to null', () => {
        expect(source).toContain('preferredTabId?: string | null');
        expect(source).toContain('preferredTabId = null');
    });

    test('adopts the donor tab only when visible, pinned, and present in directory state', () => {
        expect(effectStart).toBeGreaterThan(-1);
        expect(effectEnd).toBeGreaterThan(effectStart);

        expect(effectBody).toContain('!isTerminalVisible');
        expect(effectBody).toContain('!effectiveDirectory');
        expect(effectBody).toContain('!preferredTabId');
        expect(effectBody).toContain('activeTabId === preferredTabId');
        expect(effectBody).toContain('directoryTerminalState?.tabs.some((tab) => tab.id === preferredTabId)');
        expect(effectBody).toContain('setActiveTab(effectiveDirectory, preferredTabId)');
    });

    test('the handoff is a pure switch: no tab creation, close, or stream teardown', () => {
        expect(effectBody).not.toContain('createTab(');
        expect(effectBody).not.toContain('closeTab(');
        expect(effectBody).not.toContain('disconnectStream(');
        expect(effectBody).not.toContain('ensureDirectory(');
    });
});
