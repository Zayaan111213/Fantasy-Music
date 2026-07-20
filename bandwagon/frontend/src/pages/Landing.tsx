import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Users, TrendingUp, CalendarDays, Trophy, Music, Disc3 } from 'lucide-react';
import { api } from '../api/client';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Avatar } from '../components/ui/Avatar';
import { WagonMark, Wordmark } from '../components/Logo';
import type { ChartRow, MoversPayload } from '../api/types';

function MoverRow({ row }: { row: ChartRow }) {
  const up = (row.delta ?? 0) > 0;
  const a = row.artists[0];
  return (
    <div className="flex items-center gap-3 py-2 border-b border-gray-900 last:border-0">
      <div className="w-6 font-serif text-base text-gray-500 text-center shrink-0">{row.rank}</div>
      {a ? (
        <Avatar src={a.imageUrl} name={a.name} size="sm" />
      ) : (
        <div className="w-8 h-8 shrink-0 rounded-lg bg-gray-800 border border-gray-700 flex items-center justify-center text-gray-500 text-xs">♪</div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-white truncate">{row.title}</div>
        <div className="text-xs text-gray-400 truncate">{row.artists.map((x) => x.name).join(', ') || '—'}</div>
      </div>
      <div className={`text-[13px] font-bold shrink-0 ${up ? 'text-green-400' : 'text-red-400'}`}>
        {up ? '▲' : '▼'} {Math.abs(row.delta ?? 0)}
      </div>
    </div>
  );
}

function MoversCard({ label, icon: Icon, data }: {
  label: string;
  icon: typeof Music;
  data?: { risers: ChartRow[]; fallers: ChartRow[] };
}) {
  const rows = [...(data?.risers.slice(0, 3) ?? []), ...(data?.fallers.slice(0, 2) ?? [])];
  return (
    <Card className="p-5">
      <h3 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-2">
        <Icon className="w-4 h-4" />
        {label} · This Week's Movers
      </h3>
      {rows.length > 0 ? (
        rows.map((row) => <MoverRow key={row.rank} row={row} />)
      ) : (
        <p className="text-sm text-gray-500 py-4 text-center">No chart movement yet this week.</p>
      )}
    </Card>
  );
}

export function Landing() {
  const navigate = useNavigate();

  const { data: movers } = useQuery({
    queryKey: ['chartMovers'],
    queryFn: () => api.get<MoversPayload>('/charts/movers?limit=3'),
  });

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Nav */}
      <header className="relative border-b border-white/10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <WagonMark size={32} />
            <Wordmark className="text-lg" />
          </div>
          <Button variant="secondary" size="sm" onClick={() => navigate('/auth')}>
            Log In
          </Button>
        </div>
      </header>

      {/* Hero */}
      <main className="relative max-w-5xl mx-auto px-4">
        <div className="text-center py-16">
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-3">
            Fantasy sports for music fans
          </h1>
          <p className="text-gray-400 max-w-md mx-auto mb-8">
            Draft real recording artists, compete head-to-head with friends, and score points
            off the real Apple Music charts every week.
          </p>
          <div className="flex gap-3 justify-center">
            <Button size="lg" onClick={() => navigate('/auth?mode=signup&redirect=/leagues/create')}>
              <Plus className="w-4 h-4" />
              Create a League
            </Button>
            <Button variant="secondary" size="lg" onClick={() => navigate('/auth?mode=signup&redirect=/leagues/join')}>
              <Users className="w-4 h-4" />
              Join a League
            </Button>
          </div>
        </div>

        {/* How it works */}
        <div className="grid gap-4 md:grid-cols-3 pb-16">
          <Card className="p-5">
            <Users className="w-5 h-5 text-indigo-400 mb-2" />
            <h3 className="font-semibold text-white mb-1">Draft your roster</h3>
            <p className="text-sm text-gray-400">
              Live snake draft with friends. 9-artist rosters: 6 starters across R&amp;B/Hip-Hop,
              Pop, Rock &amp; Alternative, Country, Other, and Flex, plus 3 bench spots.
            </p>
          </Card>
          <Card className="p-5">
            <TrendingUp className="w-5 h-5 text-indigo-400 mb-2" />
            <h3 className="font-semibold text-white mb-1">Score off the charts</h3>
            <p className="text-sm text-gray-400">
              Points come from real Apple Music Most Played Songs and Albums charts: chart
              position, weekly movement, and longevity on the chart.
            </p>
          </Card>
          <Card className="p-5">
            <Trophy className="w-5 h-5 text-indigo-400 mb-2" />
            <h3 className="font-semibold text-white mb-1">Win your matchup</h3>
            <p className="text-sm text-gray-400">
              Face another team head-to-head each week. After a 10-week regular season, the top
              4 teams battle in the playoffs for the league title.
            </p>
          </Card>
        </div>

        {/* Top movers */}
        <div className="grid gap-5 md:grid-cols-2 pb-16">
          <MoversCard label="Songs" icon={Music} data={movers?.songs} />
          <MoversCard label="Albums" icon={Disc3} data={movers?.albums} />
        </div>

        <div className="pb-16 flex items-center justify-center gap-2 text-sm text-gray-500">
          <CalendarDays className="w-4 h-4" />
          Already have an account?
          <Link to="/auth" className="text-indigo-400 hover:text-indigo-300 transition-colors font-medium">
            Log in
          </Link>
        </div>
      </main>
    </div>
  );
}
