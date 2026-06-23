const ITUNES_LOOKUP = 'https://itunes.apple.com/lookup';
const ITUNES_SEARCH = 'https://itunes.apple.com/search';

interface ItunesArtistResult {
  wrapperType: string;
  artistId: number;
  artistName: string;
  primaryGenreName: string;
}

interface ItunesResponse {
  resultCount: number;
  results: ItunesArtistResult[];
}

const GENRE_MAP: Record<string, string> = {
  // R&B / Hip-Hop
  'Hip-Hop/Rap':       'R&B/Hip-Hop',
  'R&B/Soul':          'R&B/Hip-Hop',
  // Pop
  'Pop':               'Pop',
  'Singer/Songwriter': 'Pop',
  'Vocal':             'Pop',
  // Rock & Alternative
  'Rock':              'Rock & Alternative',
  'Alternative':       'Rock & Alternative',
  'Indie Rock':        'Rock & Alternative',
  'Hard Rock':         'Rock & Alternative',
  'Metal':             'Rock & Alternative',
  'Punk':              'Rock & Alternative',
  'Blues':             'Rock & Alternative',
  'Folk':              'Rock & Alternative',
  // Country
  'Country':           'Country',
  'Country & Folk':    'Country',
  'Bluegrass':         'Country',
  'Americana':         'Country',
  // Latin
  'Latin':             'Latin',
  'Regional Mexicano': 'Latin',
  'Salsa y Tropical':  'Latin',
  'Tropical':          'Latin',
  'Banda':             'Latin',
  'Corridos':          'Latin',
  'Cumbia':            'Latin',
  'Duranguense':       'Latin',
  'Grupero':           'Latin',
  'Norteño':           'Latin',
  'Quebradita':        'Latin',
  'Ranchera':          'Latin',
  'Tejano':            'Latin',
  'Brazilian':         'Latin',
  // Dance / Electronic
  'Dance':             'Dance',
  'Electronic':        'Dance',
  'EDM/Electronic':    'Dance',
  'Ambient/Noise':     'Dance',
  // K-Pop
  'K-Pop':             'K-Pop',
  // Afrobeats
  'Afrobeats':         'Afrobeats',
  'African':           'Afrobeats',
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithBackoff(url: string, retries = 3): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url);
    if (res.status !== 403) return res;
    if (attempt === retries) throw new Error(`HTTP 403 after ${retries} retries: ${url}`);
    const delay = Math.pow(2, attempt + 1) * 1000; // 2s, 4s, 8s
    console.warn(`  [genre] 403 rate limit, retrying in ${delay}ms...`);
    await sleep(delay);
  }
  throw new Error('unreachable');
}

function mapGenre(rawGenre: string): string {
  const mapped = GENRE_MAP[rawGenre];
  if (mapped) return mapped;
  console.warn(`  [genre] unmapped Apple genre: "${rawGenre}" — defaulting to Other`);
  return 'Other';
}

export async function lookupArtistGenre(
  artist: { appleArtistId: bigint | null; name: string },
): Promise<string | null> {
  try {
    let url: string;
    if (artist.appleArtistId !== null) {
      url = `${ITUNES_LOOKUP}?id=${artist.appleArtistId}&entity=musicArtist`;
    } else {
      url = `${ITUNES_SEARCH}?term=${encodeURIComponent(artist.name)}&entity=musicArtist&limit=1&media=music`;
    }

    const res = await fetchWithBackoff(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = (await res.json()) as ItunesResponse;
    if (data.resultCount === 0 || !data.results[0]) return null;

    const result = data.results.find((r) => r.wrapperType === 'artist') ?? data.results[0];
    return mapGenre(result.primaryGenreName);
  } catch (err) {
    console.error(`  [genre] lookup failed for "${artist.name}":`, err);
    return null;
  }
}
