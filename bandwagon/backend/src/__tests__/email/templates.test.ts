import { describe, it, expect } from 'vitest';

import { subjectFor, renderEmail, escapeHtml } from '../../email/templates';

const PERSONAL_TYPES = [
  'trade_proposed',
  'trade_accepted',
  'trade_rejected',
  'trade_cancelled',
  'trade_vetoed',
  'trade_executed',
  'trade_failed',
  'waiver_result',
  'lineup_reminder',
  'league_deleted',
  'league_renewed',
];

describe('subjectFor', () => {
  it('has a distinct subject for every personal notification type', () => {
    const subjects = PERSONAL_TYPES.map(subjectFor);
    expect(subjects).not.toContain('Bandwagon update');
    expect(new Set(subjects).size).toBe(PERSONAL_TYPES.length);
  });

  it('falls back for unknown types', () => {
    expect(subjectFor('some_future_type')).toBe('Bandwagon update');
  });
});

describe('renderEmail', () => {
  it('includes the greeting, message, and app link in html and text', () => {
    const { html, text } = renderEmail({ username: 'MusicMaven', message: 'Your trade went through.' });
    expect(html).toContain('Hi MusicMaven,');
    expect(html).toContain('Your trade went through.');
    expect(html).toContain('https://bandwagon.up.railway.app');
    expect(text).toContain('Hi MusicMaven,');
    expect(text).toContain('Your trade went through.');
  });

  it('falls back to a generic greeting without a username', () => {
    const { html } = renderEmail({ username: null, message: 'msg' });
    expect(html).toContain('Hi there,');
  });

  it('escapes html in user-controlled content', () => {
    const { html } = renderEmail({
      username: '<b>bold</b>',
      message: '<script>alert("xss")</script> & "quotes"',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp; &quot;quotes&quot;');
    expect(html).toContain('Hi &lt;b&gt;bold&lt;/b&gt;,');
  });
});

describe('escapeHtml', () => {
  it('escapes all five special characters', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
});
