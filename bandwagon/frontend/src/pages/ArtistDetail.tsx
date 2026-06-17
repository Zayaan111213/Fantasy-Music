import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ExternalLink, Music2, BarChart2, TrendingUp, Radio } from 'lucide-react';
import { api } from '../api/client';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import type { Artist, WeeklyScore } from '../api/types';

type ArtistWithScores = Artist & { weeklyScores: WeeklyScore[] };

function ScoreBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-400">{label}</span>
        <span className="font-semibold text-white">{value.toFixed(1)}</span>
      </div>
      <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function ArtistDetail() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const leagueId = searchParams.get('leagueId');

  const { data: artist, isLoading } = useQuery({
    queryKey: ['artist', id, leagueId],
    queryFn: () => api.get<ArtistWithScores>(`/artists/${id}${leagueId ? `?leagueId=${leagueId}` : ''}`),
  });

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

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-950/20 via-gray-950 to-purple-950/10 pointer-events-none" />

      <header className="relative border-b border-white/10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          <Link to={-1 as unknown as string} className="text-gray-400 hover:text-white transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </Link>
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
              {artist.secondaryGenres.map((g) => (
                <Badge key={g} genre={g}>{g}</Badge>
              ))}
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

        {/* This week score breakdown */}
        {latestScore && (
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <BarChart2 className="w-4 h-4" />
              Week {latestScore.week} Score Breakdown
              {!latestScore.isFinalized && <span className="text-xs text-yellow-500 font-normal ml-auto">Provisional</span>}
            </h2>
            <div className="space-y-4">
              <ScoreBar
                label={`Streaming${latestScore.weeklyStreams ? ` · ${(Number(latestScore.weeklyStreams) / 1_000_000).toFixed(1)}M streams` : ''}`}
                value={latestScore.streamingPoints}
                max={40}
                color="bg-purple-500"
              />
              <ScoreBar
                label={`Chart Position${latestScore.bestChartPosition ? ` · #${latestScore.bestChartPosition}` : ''}`}
                value={latestScore.chartPositionPoints}
                max={25}
                color="bg-indigo-500"
              />
              <ScoreBar
                label={`Chart Movement${latestScore.chartMovement !== null ? ` · ${latestScore.chartMovement > 0 ? '+' : ''}${latestScore.chartMovement}` : ''}`}
                value={Math.max(0, latestScore.chartMovementPoints)}
                max={15}
                color="bg-pink-500"
              />
              <div className="flex justify-between items-center pt-3 border-t border-white/10">
                <span className="font-semibold text-white">Total</span>
                <span className="text-2xl font-bold text-white">{latestScore.totalPoints.toFixed(1)}</span>
              </div>
              {latestScore.dataMissing && (
                <p className="text-xs text-yellow-600">Note: some signals unavailable ({latestScore.dataMissing})</p>
              )}
            </div>
          </Card>
        )}

        {/* Season history */}
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4" />
            Season History
          </h2>
          <div className="space-y-2">
            {artist.weeklyScores.map((score) => (
              <div key={score.id} className="flex items-center gap-3">
                <div className="w-14 text-xs text-gray-500">Week {score.week}</div>
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
              </div>
            ))}
          </div>
        </Card>
      </main>
    </div>
  );
}
