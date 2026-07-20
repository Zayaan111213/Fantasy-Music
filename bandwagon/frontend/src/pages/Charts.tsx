import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, Disc3, Music } from 'lucide-react';
import { api } from '../api/client';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { Avatar } from '../components/ui/Avatar';
import { WagonMark } from '../components/Logo';
import type { ChartRow, ChartsPayload } from '../api/types';

function MovePill({ row }: { row: ChartRow }) {
  if (row.isNew) {
    return <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400 bg-indigo-500/10 border border-indigo-500/40 rounded-full px-2 py-0.5">New</span>;
  }
  if (row.delta === 0) return <span className="text-xs text-gray-600">–</span>;
  const up = (row.delta ?? 0) > 0;
  return (
    <span className={`text-[13px] font-bold ${up ? 'text-green-400' : 'text-red-400'}`}>
      {up ? '▲' : '▼'} {Math.abs(row.delta ?? 0)}
    </span>
  );
}

function ChartTable({ rows }: { rows: ChartRow[] }) {
  if (rows.length === 0) {
    return <div className="text-center py-12 text-gray-500 text-sm">No chart data yet this week.</div>;
  }
  return (
    <div>
      <div className="grid grid-cols-[44px_1fr_72px_64px] gap-2 items-center px-3 py-2 border-b border-gray-700 text-[11px] font-bold uppercase tracking-widest text-gray-400">
        <div className="text-center">#</div>
        <div>Title</div>
        <div className="text-center">Last wk</div>
        <div className="text-center">Move</div>
      </div>
      {rows.map((row) => (
        <div key={row.rank} className="grid grid-cols-[44px_1fr_72px_64px] gap-2 items-center px-3 py-2.5 border-b border-gray-900 last:border-0">
          <div className="font-serif text-lg text-gray-400 text-center">{row.rank}</div>
          <div className="flex items-center gap-3 min-w-0">
            {row.artists[0] ? (
              <Avatar src={row.artists[0].imageUrl} name={row.artists[0].name} size="sm" />
            ) : (
              <div className="w-8 h-8 shrink-0 rounded-lg bg-gray-800 border border-gray-700 flex items-center justify-center text-gray-500 text-xs">♪</div>
            )}
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white truncate">{row.title}</div>
              <div className="text-xs text-gray-400 truncate">
                {row.artists.length > 0
                  ? row.artists.map((a, i) => (
                      <span key={a.id}>
                        {i > 0 && ', '}
                        <Link to={`/artists/${a.id}`} className="hover:text-indigo-400 transition-colors">{a.name}</Link>
                      </span>
                    ))
                  : '—'}
              </div>
            </div>
          </div>
          <div className="font-serif text-sm text-gray-500 text-center">{row.lastWeekRank ?? '–'}</div>
          <div className="text-center"><MovePill row={row} /></div>
        </div>
      ))}
    </div>
  );
}

export function Charts() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<'songs' | 'albums'>(searchParams.get('tab') === 'albums' ? 'albums' : 'songs');

  const { data, isLoading } = useQuery({
    queryKey: ['charts'],
    queryFn: () => api.get<ChartsPayload>('/charts'),
  });

  const weekLabel = data?.weekDate
    ? new Date(`${data.weekDate}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
    : null;

  return (
    <div className="min-h-screen bg-gray-950">
      <header className="border-b border-white/10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-white transition-colors" aria-label="Back">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <WagonMark size={24} />
          <div>
            <h1 className="font-serif font-bold text-white text-lg leading-tight">Apple Music Charts</h1>
            {weekLabel && <p className="text-xs text-gray-500">Most Played · week of {weekLabel}</p>}
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        <div className="flex gap-2">
          <button
            onClick={() => setTab('songs')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
              tab === 'songs' ? 'bg-indigo-500 text-gray-950' : 'bg-gray-800 border border-gray-700 text-gray-300 hover:text-white'
            }`}
          >
            <Music className="w-4 h-4" />
            Top 100 Songs
          </button>
          <button
            onClick={() => setTab('albums')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
              tab === 'albums' ? 'bg-indigo-500 text-gray-950' : 'bg-gray-800 border border-gray-700 text-gray-300 hover:text-white'
            }`}
          >
            <Disc3 className="w-4 h-4" />
            Top 100 Albums
          </button>
        </div>

        <Card className="overflow-hidden">
          {isLoading ? (
            <div className="flex justify-center py-16"><Spinner className="w-8 h-8" /></div>
          ) : (
            <ChartTable rows={tab === 'songs' ? (data?.songs ?? []) : (data?.albums ?? [])} />
          )}
        </Card>
      </main>
    </div>
  );
}
