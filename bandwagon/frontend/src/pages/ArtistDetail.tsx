import { useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ExternalLink, Music2, BarChart2, TrendingUp, Radio } from 'lucide-react';
import { api } from '../api/client';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import type { Artist, WeeklyScore, ChartBreakdown } from '../api/types';

type ArtistWithScores = Artist & { weeklyScores: WeeklyScore[]; chartBreakdown?: ChartBreakdown | null };

// Reconstruct the breakdown for a past week from the fields persisted at scoring
// time. Rows scored before this per-signal tracking existed have null song/album
// rank even if the artist did chart — flagged separately as "legacy" below.
function breakdownFromScore(ws: WeeklyScore): ChartBreakdown {
  return {
    song: ws.songRank !== null ? {
      rank: ws.songRank,
      title: ws.songTitle ?? '',
      movement: ws.songMovement,
      isDebut: ws.songIsDebut,
      positionPoints: ws.songPositionPoints,
      movementPoints: ws.songMovementPoints,
    } : null,
    album: ws.albumRank !== null ? {
      rank: ws.albumRank,
      title: ws.albumTitle ?? '',
      movement: ws.albumMovement,
      isDebut: ws.albumIsDebut,
      positionPoints: ws.albumPositionPoints,
      movementPoints: ws.albumMovementPoints,
    } : null,
  };
}

function isLegacyRow(ws: WeeklyScore): boolean {
  return ws.songRank === null && ws.albumRank === null
    && (ws.chartPositionPoints > 0 || ws.chartMovementPoints !== 0);
}

function ScoreBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const isNegative = value < 0;
  const pct = max > 0 ? (Math.abs(value) / max) * 100 : 0;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-400">{label}</span>
        <span className={`font-semibold ${isNegative ? 'text-red-400' : 'text-white'}`}>{value.toFixed(1)}</span>
      </div>
      <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div className={`h-full ${isNegative ? 'bg-red-500' : color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function ArtistDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const leagueId = searchParams.get('leagueId');

  const { data: artist, isLoading } = useQuery({
    queryKey: ['artist', id, leagueId],
    queryFn: () => api.get<ArtistWithScores>(`/artists/${id}${leagueId ? `?leagueId=${leagueId}` : ''}`),
  });

  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);

  if (isLoading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <Spinner className="w-10 h-10" />
    </div>
  );
  if (!artist) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">Artist not found</div>
  );

  const latestScore = artist.weeklyScores[0];
  const maxTotal = Math.max(...artist.weeklyScores.map((s) => s.totalPoints), 1);
  const activeScore = artist.weeklyScores.find((s) => s.week === selectedWeek) ?? latestScore;
  const isViewingLatest = !!activeScore && activeScore.week === latestScore?.week;
  // The latest week's breakdown is recomputed live server-side (see artists.ts)
  // so it stays accurate between daily pipeline runs; past weeks read the
  // breakdown captured at scoring time.
  const activeBreakdown = activeScore
    ? (isViewingLatest ? artist.chartBreakdown ?? null : breakdownFromScore(activeScore))
    : null;
  const activeIsLegacy = !!activeScore && !isViewingLatest && isLegacyRow(activeScore);

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-950/20 via-gray-950 to-purple-950/10 pointer-events-none" />

      <header className="relative border-b border-white/10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-white transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <Music2 className="w-4 h-4 text-indigo-400" />
        </div>
      </header>

      <main className="relative max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Artist header */}
        <div className="flex items-start gap-5">
          <img
            src={artist.imageUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(artist.name)}&background=6366f1&color=fff&size=256`}
            alt={artist.name}
            className="w-24 h-24 rounded-2xl object-cover ring-2 ring-white/10"
          />
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-white mb-1">{artist.name}</h1>
            <div className="flex flex-wrap gap-1.5 mb-3">
              <Badge genre={artist.primaryGenre}>{artist.primaryGenre}</Badge>
            </div>
            <div className="flex gap-2">
              {artist.spotifyId && (
                <a
                  href={`https://open.spotify.com/artist/${artist.spotifyId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-500/20 border border-green-500/30 rounded-lg text-green-400 text-xs font-medium hover:bg-green-500/30 transition-colors"
                >
                  <Radio className="w-3.5 h-3.5" />
                  Spotify
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Selected week score breakdown */}
        {activeScore && (
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <BarChart2 className="w-4 h-4" />
              Week {activeScore.week} Score Breakdown
              {!activeScore.isFinalized && <span className="text-xs text-yellow-500 font-normal ml-auto">Provisional</span>}
            </h2>
            {activeIsLegacy ? (
              <p className="text-xs text-gray-500 italic">
                Detailed breakdown isn't available for this week — it was scored before per-signal tracking was added. Total: {activeScore.totalPoints.toFixed(1)}
              </p>
            ) : (
            <div className="space-y-4">
              {activeBreakdown?.song ? (
                <>
                  <ScoreBar
                    label={`Song Position · #${activeBreakdown.song.rank}${activeBreakdown.song.title ? ` · ${activeBreakdown.song.title}` : ''}`}
                    value={activeBreakdown.song.positionPoints}
                    max={25}
                    color="bg-indigo-500"
                  />
                  <ScoreBar
                    label={`Song Movement · ${activeBreakdown.song.isDebut ? 'New Entry' : activeBreakdown.song.movement !== null ? `${activeBreakdown.song.movement > 0 ? '+' : ''}${activeBreakdown.song.movement}` : 'No change'}`}
                    value={activeBreakdown.song.movementPoints}
                    max={15}
                    color="bg-pink-500"
                  />
                </>
              ) : (
                <p className="text-xs text-gray-500 italic">No song chart entry this week</p>
              )}
              {activeBreakdown?.album ? (
                <>
                  <ScoreBar
                    label={`Album Position · #${activeBreakdown.album.rank}${activeBreakdown.album.title ? ` · ${activeBreakdown.album.title}` : ''}`}
                    value={activeBreakdown.album.positionPoints}
                    max={25}
                    color="bg-violet-500"
                  />
                  <ScoreBar
                    label={`Album Movement · ${activeBreakdown.album.isDebut ? 'New Entry' : activeBreakdown.album.movement !== null ? `${activeBreakdown.album.movement > 0 ? '+' : ''}${activeBreakdown.album.movement}` : 'No change'}`}
                    value={activeBreakdown.album.movementPoints}
                    max={15}
                    color="bg-fuchsia-500"
                  />
                </>
              ) : (
                <p className="text-xs text-gray-500 italic">No album chart entry this week</p>
              )}
              <ScoreBar
                label="Longevity"
                value={activeScore.longevityPoints ?? 0}
                max={12}
                color="bg-amber-500"
              />
              <div className="flex justify-between items-center pt-3 border-t border-white/10">
                <span className="font-semibold text-white">Total</span>
                <span className="text-2xl font-bold text-white">{activeScore.totalPoints.toFixed(1)}</span>
              </div>
              {activeScore.dataMissing && (
                <p className="text-xs text-yellow-600">Note: some signals unavailable ({activeScore.dataMissing})</p>
              )}
            </div>
            )}
          </Card>
        )}

        {/* Chart history — last 10 real chart weeks, independent of any league's season length */}
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4" />
            Chart History
            <span className="text-xs text-gray-600 font-normal normal-case tracking-normal ml-auto">Tap a week for details</span>
          </h2>
          <div className="space-y-2">
            {artist.weeklyScores.map((score) => (
              <button
                key={score.id}
                onClick={() => setSelectedWeek(score.week === activeScore?.week ? null : score.week)}
                className={`w-full flex items-center gap-3 -mx-2 px-2 py-1 rounded-lg transition-colors ${
                  score.week === activeScore?.week ? 'bg-white/10' : 'hover:bg-white/5'
                }`}
              >
                <div className="w-14 text-xs text-gray-500 text-left">Week {score.week}</div>
                <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 rounded-full"
                    style={{ width: `${(score.totalPoints / maxTotal) * 100}%` }}
                  />
                </div>
                <div className="w-12 text-right text-sm font-semibold text-white font-mono">
                  {score.totalPoints.toFixed(1)}
                </div>
                {!score.isFinalized && (
                  <span className="text-xs text-yellow-600">~</span>
                )}
              </button>
            ))}
          </div>
        </Card>
      </main>
    </div>
  );
}
