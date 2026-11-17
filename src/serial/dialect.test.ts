import { describe, expect, it } from 'vitest';
import { dialectFromLine, isChatter, jogLines, statusPoll } from './dialect';

describe('serial/dialect', () => {
  it('recognises controllers from their $I / banner lines', () => {
    expect(dialectFromLine('[XTool D1:ver 40.30.002.01 B1]')).toBe('xtool');
    expect(dialectFromLine('[VER:1.1h.20190825:]')).toBe('grbl');
    expect(dialectFromLine("Grbl 1.1h ['$' for help]")).toBe('grbl');
    expect(dialectFromLine('ok')).toBeNull();
    expect(dialectFromLine('[MSG:Pgm End]')).toBeNull();
  });

  it('polls stock GRBL with the real-time ? at all times', () => {
    expect(statusPoll('grbl', false)).toBe('?');
    expect(statusPoll('grbl', true)).toBe('?');
  });

  it('polls xTool with a full line, and not while a job streams', () => {
    expect(statusPoll('xtool', false)).toBe('?\n');
    expect(statusPoll('xtool', true)).toBeNull();
  });

  it('jogs stock GRBL with $J', () => {
    expect(jogLines('grbl', 10, 0, 600)).toEqual(['$J=G91 X10 F600']);
    expect(jogLines('grbl', 0, -1, 1000)).toEqual(['$J=G91 Y-1 F1000']);
  });

  it('jogs xTool with a relative move ended by M2', () => {
    expect(jogLines('xtool', 0, -10, 6000)).toEqual(['G91', 'G1 Y-10 F6000 S0', 'G90', 'M2']);
  });

  it('treats ok:… lines as chatter, not acknowledgements', () => {
    expect(isChatter('ok:IDLE')).toBe(true);
    expect(isChatter('ok:512')).toBe(true);
    expect(isChatter('ok')).toBe(false);
  });
});
