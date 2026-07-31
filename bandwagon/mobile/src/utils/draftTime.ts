// datetime-local inputs only have minute granularity, so "now" must be
// floored to the current minute before adding the 1-hour minimum. Without
// this, picking exactly the earliest allowed minute gets rejected by the
// time the form is submitted, since Date.now() has ticked forward a few
// seconds since the input's min attribute was computed.
export function minDraftTime(): Date {
  const flooredNow = Math.floor(Date.now() / 60_000) * 60_000;
  return new Date(flooredNow + 60 * 60_000);
}

const PACIFIC_TZ = 'America/Los_Angeles';

// datetime-local inputs have no timezone of their own — the browser reads
// and writes their value as plain wall-clock numbers in whatever timezone
// the OS happens to be set to. This app's draft times are always meant as
// Pacific wall-clock time, so every read from (or write to) one of these
// inputs has to explicitly convert through Pacific rather than relying on
// the browser's ambient local timezone, which may not be Pacific at all.

// Formats an instant (typically a stored UTC draftTime) as the Pacific
// wall-clock "YYYY-MM-DDTHH:mm" string a datetime-local input's `value`
// expects.
export function utcToPacificInputValue(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: PACIFIC_TZ,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function minDraftTimeInputValue(): string {
  return utcToPacificInputValue(minDraftTime());
}

// Interprets a datetime-local string as Pacific wall-clock time (never the
// browser's own local timezone) and returns the correct UTC ISO string to
// send to the API. DST-aware: re-derives the Pacific UTC offset from the
// guessed instant itself rather than assuming a fixed offset.
export function pacificInputValueToUtcIso(value: string): string {
  const [datePart, timePart] = value.split('T');
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, mi] = (timePart ?? '00:00').split(':').map(Number);

  const guessUtcMs = Date.UTC(y, mo - 1, d, h, mi);
  const shownInPacific = utcToPacificInputValue(new Date(guessUtcMs));
  const [shownDate, shownTime] = shownInPacific.split('T');
  const [sy, smo, sd] = shownDate.split('-').map(Number);
  const [sh, smi] = shownTime.split(':').map(Number);
  const shownAsUtcMs = Date.UTC(sy, smo - 1, sd, sh, smi);

  const offsetMs = guessUtcMs - shownAsUtcMs;
  return new Date(guessUtcMs + offsetMs).toISOString();
}

// Formats a stored UTC instant for read-only display, always in Pacific
// regardless of the viewer's own device timezone, with a trailing "PT" so
// it's unambiguous.
export function formatPacific(date: Date | string, opts: Intl.DateTimeFormatOptions): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return `${d.toLocaleString('en-US', { ...opts, timeZone: PACIFIC_TZ })} PT`;
}
