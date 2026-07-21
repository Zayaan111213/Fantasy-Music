import { X, Share, SquarePlus } from 'lucide-react';
import { WagonMark } from './Logo';

export function InstallInstructionsModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={onClose}>
      <div
        className="bg-gray-900 border border-white/10 rounded-xl w-full max-w-sm shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <WagonMark size={28} />
            <h2 className="text-lg font-bold text-white">Add to Home Screen</h2>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4 text-sm text-gray-300">
          <div className="flex gap-3">
            <span className="w-6 h-6 shrink-0 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-white">1</span>
            <p className="flex items-center gap-1.5 flex-wrap">
              Tap the Share icon <Share className="w-4 h-4 inline text-indigo-400" /> in Safari's toolbar.
            </p>
          </div>
          <div className="flex gap-3">
            <span className="w-6 h-6 shrink-0 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-white">2</span>
            <p className="flex items-center gap-1.5 flex-wrap">
              Scroll down and tap <SquarePlus className="w-4 h-4 inline text-indigo-400" /> "Add to Home Screen."
            </p>
          </div>
          <div className="flex gap-3">
            <span className="w-6 h-6 shrink-0 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-white">3</span>
            <p>Tap "Add" to confirm. Bandwagoner will open like an app from your home screen from then on.</p>
          </div>
        </div>

        <div className="px-6 pb-5 pt-4 border-t border-white/10">
          <button
            onClick={onClose}
            className="w-full px-4 py-2.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-gray-950 font-medium transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
