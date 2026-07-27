// datetime-local inputs only have minute granularity, so "now" must be
// floored to the current minute before adding the 1-hour minimum. Without
// this, picking exactly the earliest allowed minute gets rejected by the
// time the form is submitted, since Date.now() has ticked forward a few
// seconds since the input's min attribute was computed.
export function minDraftTime(): Date {
  const flooredNow = Math.floor(Date.now() / 60_000) * 60_000;
  return new Date(flooredNow + 60 * 60_000);
}

export function minDraftTimeInputValue(): string {
  return minDraftTime().toISOString().slice(0, 16);
}
