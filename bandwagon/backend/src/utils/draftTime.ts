// The draft-time picker only has minute granularity, so "now" must be
// floored to the current minute before adding the 1-hour minimum. Without
// this, a user who picks exactly the earliest allowed minute gets rejected
// by the time the request reaches the server, since Date.now() has ticked
// forward a few seconds (or more, over the network) since the form loaded.
export function minDraftTime(now: number = Date.now()): Date {
  const flooredNow = Math.floor(now / 60_000) * 60_000;
  return new Date(flooredNow + 60 * 60_000);
}
