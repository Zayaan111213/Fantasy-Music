export interface User {
  id: string;
  email: string;
  username: string | null;
  avatarUrl: string | null;
}

export interface ScoringConfig {
  chartPosition: [number, number, number, number, number];
  chartMovement: { newEntryBonus: number; maxGain: number; maxDrop: number };
  streaming: Record<string, [number, number, number, number, number, number, number]>;
}

export interface League {
  id: string;
  name: string;
  commissionerId: string;
  teamCount: number;
  isPrivate: boolean;
  draftTime: string | null;
  status: 'pending' | 'pre_draft' | 'drafting' | 'active' | 'complete';
  inviteCode: string;
  currentWeek: number;
  seasonYear: number;
  scoringConfig?: ScoringConfig | null;
}

export interface Team {
  id: string;
  leagueId: string;
  userId: string;
  name: string;
  logoUrl: string | null;
  wins: number;
  losses: number;
  pointsFor: number;
  draftPosition: number | null;
  user?: Pick<User, 'username' | 'avatarUrl'>;
}

export interface Artist {
  id: string;
  name: string;
  primaryGenre: string;
  imageUrl: string | null;
  spotifyId: string | null;
  appleMusicId: string | null;
  lastWeekPoints?: number;
  avgLast5Points?: number;
}

export interface WeeklyScore {
  id: string;
  artistId: string;
  week: number;
  seasonYear: number;
  streamingPoints: number;
  chartPositionPoints: number;
  chartMovementPoints: number;
  longevityPoints: number;
  totalPoints: number;
  weeklyStreams: string | null;
  bestChartPosition: number | null;
  chartMovement: number | null;
  isFinalized: boolean;
  dataMissing: string | null;
  songRank: number | null;
  songTitle: string | null;
  songPositionPoints: number;
  songMovement: number | null;
  songMovementPoints: number;
  songIsDebut: boolean;
  albumRank: number | null;
  albumTitle: string | null;
  albumPositionPoints: number;
  albumMovement: number | null;
  albumMovementPoints: number;
  albumIsDebut: boolean;
}

export interface ChartBreakdownEntry {
  rank: number;
  title: string;
  movement: number | null;
  isDebut: boolean;
  positionPoints: number;
  movementPoints: number;
}

export interface ChartBreakdown {
  song: ChartBreakdownEntry | null;
  album: ChartBreakdownEntry | null;
}

export interface RosterSpot {
  id: string;
  teamId: string;
  artistId: string | null;
  slot: string;
  artist?: (Artist & { weeklyScores: WeeklyScore[] }) | null;
}

export interface Matchup {
  id: string;
  leagueId: string;
  week: number;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  winnerId: string | null;
  isFinalized: boolean;
  matchupType: string;
  homeSeed: number | null;
  awaySeed: number | null;
  homeTeam?: Team & { rosterSpots?: RosterSpot[] };
  awayTeam?: Team & { rosterSpots?: RosterSpot[] };
}

export interface BracketMatchup {
  id: string;
  week: number;
  matchupType: string;
  homeTeamId: string;
  awayTeamId: string;
  homeSeed: number | null;
  awaySeed: number | null;
  homeScore: number;
  awayScore: number;
  winnerId: string | null;
  isFinalized: boolean;
  homeTeam: { id: string; name: string; wins: number; losses: number };
  awayTeam: { id: string; name: string; wins: number; losses: number };
}

export interface Bracket {
  projected: boolean;
  matchups: BracketMatchup[];
}

export interface StandingsEntry {
  rank: number;
  teamId: string;
  teamName: string;
  teamLogoUrl: string | null;
  userId: string;
  username: string | null;
  avatarUrl: string | null;
  wins: number;
  losses: number;
  pointsFor: number;
}

export interface PlayerEntry {
  id: string;
  name: string;
  primaryGenre: string;
  imageUrl: string | null;
  rosteredBy: { id: string; name: string } | null;
  lastWeekPoints: number;
  avgLast5Points: number;
}

export interface DraftPick {
  id: string;
  leagueId: string;
  teamId: string;
  artistId: string;
  round: number;
  pickNumber: number;
  slot: string;
  isAutoDraft: boolean;
  pickedAt: string;
  artist?: Pick<Artist, 'id' | 'name' | 'primaryGenre' | 'imageUrl'>;
  team?: Pick<Team, 'id' | 'name' | 'logoUrl'>;
}

export interface DraftState {
  status: string;
  currentPickIndex: number;
  pickOrder: string[];
  timerEndsAt: string | null;
  isComplete: boolean;
  teams: (Team & { user: Pick<User, 'username' | 'avatarUrl'>; rosterSpots: RosterSpot[] })[];
  picks: DraftPick[];
  myUserId?: string;
  countdownEndsAt?: string | null;
}

export interface Notification {
  id: string;
  type: string;
  message: string;
  createdAt: string;
}

export interface LeagueCard {
  id: string;
  name: string;
  status: string;
  currentWeek: number;
  isPrivate: boolean;
  teamCount: number;
  isCommissioner: boolean;
  myTeam: { id: string; name: string; logoUrl: string | null; wins: number; losses: number };
  opponent: { id: string; name: string; logoUrl: string | null } | null;
  myScore: number;
  opponentScore: number;
  memberCount: number;
}
