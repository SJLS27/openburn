import { describe, expect, it } from 'vitest';
import { machine } from './machine';

describe('machine console', () => {
  it('greets with the build version, not a hardcoded one (regression)', () => {
    const first = machine.getState().logs[0];
    expect(first?.dir).toBe('info');
    expect(first?.text).toContain(`OpenBurn ${__APP_VERSION__}`);
    expect(first?.text).toContain('GRBL console ready');
    // The old literal stayed at 0.6.1 while the app moved on.
    expect(first?.text).not.toContain('0.6.1');
  });
});
