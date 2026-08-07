/**
 * Name filtering for user-authored text that other people see: usernames,
 * league names, and team names.
 *
 * This exists for App Store guideline 1.2, which expects apps with
 * user-generated content to filter objectionable material rather than rely
 * on reports alone. It is deliberately small: a denylist of slurs and hard
 * profanity, matched after normalization, applied at the three write points
 * where a name enters the system.
 *
 * What it is not: a general profanity engine. It aims to stop the obvious
 * cases with close to zero false positives, because a false positive here
 * blocks someone from naming their own team. Anything subtler is what the
 * report flow is for.
 */

// Kept short and unambiguous on purpose. Every entry is a term that is
// objectionable in essentially any context, so substring matching after
// normalization won't produce a Scunthorpe-style false positive against the
// names people actually pick. Add to this list rather than loosening the
// matcher.
const BLOCKED_TERMS = [
  'nigger',
  'nigga',
  'faggot',
  'fagg0t',
  'chink',
  'spic',
  'kike',
  'tranny',
  'retard',
  'rapist',
  'molester',
  'pedophile',
  'pedo',
  'childporn',
  'cunt',
];

// Common substitutions used to sneak a term past a literal match.
const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '@': 'a',
  $: 's',
  '!': 'i',
};

/**
 * Lowercases, maps leetspeak to letters, and drops everything that isn't a
 * letter, so "n.i.g.g.e.r" and "n1gg3r" both reduce to the bare term.
 */
function flatten(input: string): string {
  return [...input.toLowerCase()]
    .map((ch) => LEET[ch] ?? ch)
    .filter((ch) => ch >= 'a' && ch <= 'z')
    .join('');
}

/** Collapses runs of a repeated letter, so "niiiigggger" reduces to "niger". */
function squeeze(input: string): string {
  return input.replace(/(.)\1+/g, '$1');
}

// Both forms are compared: the flat term catches separators and leetspeak,
// the squeezed term catches letter-padding. The terms must be squeezed too,
// since squeezing the input alone would turn "nigger" into "niger" and never
// match the un-squeezed denylist entry.
const FLAT_TERMS = BLOCKED_TERMS.map(flatten);
const SQUEEZED_TERMS = FLAT_TERMS.map(squeeze);

export function containsBlockedTerm(input: string): boolean {
  if (!input) return false;
  const flat = flatten(input);
  if (!flat) return false;
  const squeezed = squeeze(flat);
  return (
    FLAT_TERMS.some((term) => flat.includes(term)) ||
    SQUEEZED_TERMS.some((term) => squeezed.includes(term))
  );
}

/** Message shown to the user. Deliberately vague: naming the matched term invites gaming it. */
export const BLOCKED_NAME_MESSAGE = "That name isn't allowed. Please choose another.";
