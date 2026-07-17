import { X, Music2, TrendingUp, CalendarDays, Users, Trophy } from 'lucide-react';

export function HowItWorksModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={onClose}>
      <div
        className="bg-gray-900 border border-white/10 rounded-xl w-full max-w-lg shadow-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
              <Music2 className="w-4 h-4 text-indigo-400" />
            </div>
            <h2 className="text-lg font-bold text-white">How Bandwagoner Works</h2>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5 overflow-y-auto text-sm text-gray-300">
          <p className="text-gray-400">
            Bandwagoner is fantasy sports for music. Draft real recording artists, then earn points
            each week based on how they perform on the Apple Music charts.
          </p>

          <div className="flex gap-3">
            <Users className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-white mb-1">Draft your roster</h3>
              <p>
                Join a league with friends and take part in a live snake draft. Every team fills 9
                slots: 6 starters (R&amp;B/Hip-Hop, Pop, Rock &amp; Alternative, Country, Other, and a
                Flex that takes any genre) plus 3 bench spots.
              </p>
            </div>
          </div>

          <div className="flex gap-3">
            <TrendingUp className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-white mb-1">Score points from the charts</h3>
              <p className="mb-2">
                Each starter earns points from the Apple Music Most Played Songs and Albums charts
                (Top 100):
              </p>
              <ul className="space-y-1 text-gray-400">
                <li>· <span className="text-gray-300">Chart position:</span> #1 scores 25, top 10 scores 18, down to 4 points for ranks 51-100</li>
                <li>· <span className="text-gray-300">Movement:</span> debuts earn +10; climbing the chart earns +1 per spot (falling costs points)</li>
                <li>· <span className="text-gray-300">Longevity:</span> +2 per consecutive week on the chart, up to +10</li>
              </ul>
            </div>
          </div>

          <div className="flex gap-3">
            <CalendarDays className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-white mb-1">Set your lineup weekly</h3>
              <p>
                Scoring weeks run Tuesday through Sunday. Mondays are for adjustments: swap starters
                and bench, and pick up free agents instantly. During the week your lineup is locked,
                and free-agent pickups go through waiver claims that resolve Sunday night. You can
                also trade with other teams.
              </p>
            </div>
          </div>

          <div className="flex gap-3">
            <Trophy className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-white mb-1">Win your matchup, make the playoffs</h3>
              <p>
                Every week you face another team head-to-head, and most points wins. After a 10-week
                regular season, the top 4 teams enter a playoff bracket to crown the league champion.
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 pb-5 pt-4 border-t border-white/10">
          <button
            onClick={onClose}
            className="w-full px-4 py-2.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-gray-950 font-medium transition-colors"
          >
            Got it, let's play
          </button>
        </div>
      </div>
    </div>
  );
}
