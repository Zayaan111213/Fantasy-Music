import { describe, it, expect } from 'vitest';

import { splitArtistCredit, NO_SPLIT } from '../../data/artistCredits';

describe('splitArtistCredit', () => {
  it('splits a two-artist credit', () => {
    expect(splitArtistCredit('Kanye West & Don Toliver')).toEqual(['Kanye West', 'Don Toliver']);
    expect(splitArtistCredit('PARTYNEXTDOOR & Drake')).toEqual(['PARTYNEXTDOOR', 'Drake']);
    expect(splitArtistCredit('Chlöe & Timbaland')).toEqual(['Chlöe', 'Timbaland']);
  });

  it('splits comma-plus-ampersand credits into all components', () => {
    expect(splitArtistCredit('Rylo Rodriguez, Lil Baby & Kevin Gates')).toEqual([
      'Rylo Rodriguez',
      'Lil Baby',
      'Kevin Gates',
    ]);
    expect(splitArtistCredit('KPop Demon Hunters Cast, HUNTR/X & Saja Boys')).toEqual([
      'KPop Demon Hunters Cast',
      'HUNTR/X',
      'Saja Boys',
    ]);
  });

  it('never splits names without " & "', () => {
    expect(splitArtistCredit('Tyler, the Creator')).toEqual(['Tyler, the Creator']);
    expect(splitArtistCredit('Dexter and The Moonrocks')).toEqual(['Dexter and The Moonrocks']);
    expect(splitArtistCredit('Don Toliver')).toEqual(['Don Toliver']);
  });

  it('never splits NO_SPLIT permanent acts, case-insensitively', () => {
    expect(splitArtistCredit('Zion & Lennox')).toEqual(['Zion & Lennox']);
    expect(splitArtistCredit('Earth, Wind & Fire')).toEqual(['Earth, Wind & Fire']);
    expect(splitArtistCredit('FLORENCE & THE MACHINE')).toEqual(['FLORENCE & THE MACHINE']);
    expect(splitArtistCredit('Crosby, Stills, Nash & Young')).toEqual(['Crosby, Stills, Nash & Young']);
  });

  it('checks NO_SPLIT against the full string before splitting', () => {
    // 'earth, wind & fire' must match as a whole, not split into Earth/Wind/Fire
    expect(NO_SPLIT.has('earth, wind & fire')).toBe(true);
    expect(splitArtistCredit('earth, wind & fire')).toHaveLength(1);
  });

  it('keeps generational suffixes attached to their name', () => {
    expect(
      splitArtistCredit('Lin-Manuel Miranda, Leslie Odom, Jr., Phillipa Soo, Daveed Diggs & Christopher Jackson'),
    ).toEqual(['Lin-Manuel Miranda', 'Leslie Odom, Jr.', 'Phillipa Soo', 'Daveed Diggs', 'Christopher Jackson']);
    expect(splitArtistCredit('Sammy Davis, Jr. & Frank Sinatra')).toEqual(['Sammy Davis, Jr.', 'Frank Sinatra']);
  });

  it('trims whitespace and dedupes components', () => {
    expect(splitArtistCredit('  Kanye West &  Don Toliver ')).toEqual(['Kanye West', 'Don Toliver']);
    expect(splitArtistCredit('Drake & Drake')).toEqual(['Drake & Drake']); // dedupes to 1 → treated as unsplittable
  });

  it('returns empty for empty input', () => {
    expect(splitArtistCredit('')).toEqual([]);
    expect(splitArtistCredit('   ')).toEqual([]);
  });
});
