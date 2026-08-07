import { describe, it, expect } from 'vitest';
import { containsBlockedTerm } from '../../moderation/wordlist';

describe('containsBlockedTerm', () => {
  it('allows ordinary names', () => {
    for (const name of [
      'MusicMaven',
      'ChartWatcher',
      'Top Squad',
      'The Bandwagoners',
      'beat_broker',
      'Hook Hunter 2026',
      'zayaan',
    ]) {
      expect(containsBlockedTerm(name)).toBe(false);
    }
  });

  it('blocks a plain slur', () => {
    expect(containsBlockedTerm('faggot')).toBe(true);
  });

  it('blocks a slur embedded in a longer name', () => {
    expect(containsBlockedTerm('xX_faggot_Xx')).toBe(true);
  });

  it('sees through leetspeak substitutions', () => {
    expect(containsBlockedTerm('f4gg0t')).toBe(true);
    expect(containsBlockedTerm('n1gg3r')).toBe(true);
  });

  it('sees through separators', () => {
    expect(containsBlockedTerm('f.a.g.g.o.t')).toBe(true);
    expect(containsBlockedTerm('f a g g o t')).toBe(true);
    expect(containsBlockedTerm('f-a-g-g-o-t')).toBe(true);
  });

  // The squeeze pass collapses repeated letters, so the denylist has to be
  // squeezed too — otherwise "nigger" itself stops matching after collapsing.
  it('sees through letter padding without breaking the base term', () => {
    expect(containsBlockedTerm('niiiiggggeeer')).toBe(true);
    expect(containsBlockedTerm('nigger')).toBe(true);
  });

  it('is case insensitive', () => {
    expect(containsBlockedTerm('FAGGOT')).toBe(true);
    expect(containsBlockedTerm('FaGgOt')).toBe(true);
  });

  it('handles empty and punctuation-only input without matching', () => {
    expect(containsBlockedTerm('')).toBe(false);
    expect(containsBlockedTerm('   ')).toBe(false);
    expect(containsBlockedTerm('!!!')).toBe(false);
  });
});
