import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Plus, Check } from 'lucide-react';
import { api } from '../api/client';
import type { RosterSpot, Team } from '../api/types';
import { Avatar } from './ui/Avatar';
import { Badge } from './ui/Badge';
import { SlotPill, GenreLabel } from './SlotPill';
import { posthog } from '../lib/posthog';

const MAIN_GENRES = new Set(['R&B/Hip-Hop', 'Pop', 'Rock & Alternative', 'Country']);

// Mirrors artistEligibleForSlot on the backend — the server re-validates every
// claim, so this only decides which slots are worth offering.
export function canFillSlot(genre: string, slot: string): boolean {
  if (slot.startsWith('Bench') || slot === 'Flex') return true;
  if (slot === 'Other') return !MAIN_GENRES.has(genre);
  return genre === slot;
}

// The pick-a-slot claim dialog, shared by the Players tab and the artist detail
// page so both offer the same flow (and the same free-agency vs waiver wording).
export function ClaimArtistModal({
  artist,
  leagueId,
  freeAgency,
  onClose,
}: {
  artist: { id: string; name: string; primaryGenre: string };
  leagueId: string;
  // Monday / week-1 window: pickups are instant and free rather than queued.
  freeAgency: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [dropSlot, setDropSlot] = useState<string | null>(null);
  const [error, setError] = useState('');

  const { data: myTeam } = useQuery({
    queryKey: ['myTeam', leagueId],
    queryFn: () => api.get<Team & { rosterSpots: RosterSpot[] }>(`/leagues/${leagueId}/roster`),
  });

  const claimMutation = useMutation({
    mutationFn: ({ artistId, dropSlot }: { artistId: string; dropSlot: string }) =>
      api.post(`/leagues/${leagueId}/roster/claim`, { artistId, dropSlot }),
    onSuccess: (_, { artistId, dropSlot }) => {
      posthog.capture('artist_claimed', { leagueId, artistId, dropSlot, is_free_agency: freeAgency });
      queryClient.invalidateQueries({ queryKey: ['waivers', leagueId] });
      queryClient.invalidateQueries({ queryKey: ['players', leagueId] });
      queryClient.invalidateQueries({ queryKey: ['myTeam', leagueId] });
      queryClient.invalidateQueries({ queryKey: ['activity', leagueId] });
      // The artist page keys off rosteredBy, which this claim may have changed.
      queryClient.invalidateQueries({ queryKey: ['artist', artistId] });
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  const eligibleSlots = (myTeam?.rosterSpots ?? []).filter((s) => canFillSlot(artist.primaryGenre, s.slot));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="bg-gray-900 border border-white/10 rounded-xl w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="min-w-0">
            <h2 className="font-semibold text-white truncate">Claim {artist.name}</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {freeAgency
                ? 'Select a slot · free agency is open, adds are instant'
                : 'Select a slot · claims process Sunday night'}
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 text-gray-500 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-2 max-h-80 overflow-y-auto">
          {eligibleSlots.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-6">No eligible slots on your roster</p>
          ) : (
            eligibleSlots.map((spot) => {
              const empty = !spot.artistId;
              const selected = dropSlot === spot.slot;
              return (
                <button
                  key={spot.slot}
                  onClick={() => setDropSlot(spot.slot)}
                  className={`w-full flex items-center gap-3 p-3 rounded-lg transition-colors text-left ${
                    selected
                      ? empty
                        ? 'bg-green-500/20 border border-green-500/40'
                        : 'bg-red-500/20 border border-red-500/40'
                      : empty
                        ? 'hover:bg-white/5 border border-dashed border-white/10'
                        : 'hover:bg-white/5 border border-transparent'
                  }`}
                >
                  {empty ? (
                    <div className="w-8 h-8 shrink-0 rounded-full bg-white/5 border border-dashed border-white/20 flex items-center justify-center text-gray-500">
                      <Plus className="w-4 h-4" />
                    </div>
                  ) : (
                    <Avatar src={spot.artist?.imageUrl ?? null} name={spot.artist?.name ?? '?'} size="sm" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white truncate">{empty ? 'Empty slot' : spot.artist?.name}</div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <SlotPill slot={spot.slot} />
                      {spot.artist && <Badge genre={spot.artist.primaryGenre}><GenreLabel genre={spot.artist.primaryGenre} /></Badge>}
                    </div>
                  </div>
                  {selected && <Check className={`w-4 h-4 shrink-0 ${empty ? 'text-green-400' : 'text-red-400'}`} />}
                </button>
              );
            })
          )}
        </div>
        {error && <p className="text-xs text-red-400 px-4 pb-2">{error}</p>}
        <div className="flex gap-2 p-4 border-t border-white/10">
          <button
            onClick={onClose}
            className="flex-1 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-gray-300 text-sm font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            disabled={!dropSlot || claimMutation.isPending}
            onClick={() => dropSlot && claimMutation.mutate({ artistId: artist.id, dropSlot })}
            className="flex-1 px-3 py-2 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white text-sm font-medium transition-colors"
          >
            {claimMutation.isPending ? (freeAgency ? 'Adding…' : 'Submitting…') : (freeAgency ? 'Add Free Agent' : 'Submit Waiver Claim')}
          </button>
        </div>
      </div>
    </div>
  );
}
