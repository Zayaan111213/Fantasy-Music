// Splits Apple Music joint-credit strings ("A, B & C") into individual artist
// names so each component scores the shared song/album. Splitting only
// triggers on " & " — Apple separates collaborators with ", " and a final
// " & ", while single acts with commas ("Tyler, the Creator") or the word
// "and" ("Dexter and The Moonrocks") never contain " & ".

// Permanent acts whose billing contains " & " and must never be split.
// Compared case-insensitively against the FULL credit string before any
// splitting. Curated: when the ingest log shows a `[split]` line for a name
// that is actually one act, add it here (and hand-merge the artists).
export const NO_SPLIT: ReadonlySet<string> = new Set([
  'zion & lennox',
  'earth, wind & fire',
  'simon & garfunkel',
  'florence & the machine',
  'hall & oates',
  'daryl hall & john oates',
  'brooks & dunn',
  'mumford & sons',
  'hootie & the blowfish',
  'crosby, stills & nash',
  'crosby, stills, nash & young',
  'emerson, lake & palmer',
  'huey lewis & the news',
  'tom petty & the heartbreakers',
  'bob marley & the wailers',
  'she & him',
]);

// Generational suffixes that follow a comma inside ONE person's name
// ("Leslie Odom, Jr.") — re-attached to the preceding part after splitting.
const NAME_SUFFIXES = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv']);

export function splitArtistCredit(artistName: string): string[] {
  const name = artistName.trim();
  if (!name) return [];
  if (NO_SPLIT.has(name.toLowerCase())) return [name];
  if (!name.includes(' & ')) return [name];

  const raw = name
    .split(' & ')
    .flatMap((segment) => segment.split(', '))
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  const parts: string[] = [];
  for (const part of raw) {
    if (parts.length > 0 && NAME_SUFFIXES.has(part.toLowerCase())) {
      parts[parts.length - 1] += `, ${part}`;
    } else {
      parts.push(part);
    }
  }

  const deduped = [...new Set(parts)];
  return deduped.length < 2 ? [name] : deduped;
}
