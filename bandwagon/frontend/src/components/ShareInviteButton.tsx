import { useState } from 'react';
import { Share2, X, MessageSquare, Mail, MessageCircle, Copy, Check } from 'lucide-react';
import { WagonMark } from './Logo';

interface Props {
  leagueName: string;
  inviteUrl: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'primary' | 'secondary';
}

const sizeClasses = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
};

const variantClasses = {
  primary: 'bg-indigo-500 hover:bg-indigo-600 text-gray-950',
  secondary: 'bg-white/10 hover:bg-white/20 text-white border border-white/20',
};

export function ShareInviteButton({ leagueName, inviteUrl, className = '', size = 'md', variant = 'secondary' }: Props) {
  const [fallbackOpen, setFallbackOpen] = useState(false);

  async function handleClick() {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: `Join ${leagueName} on Bandwagoner`,
          text: `Join my league "${leagueName}" on Bandwagoner!`,
          url: inviteUrl,
        });
      } catch {
        // User cancelled the native share sheet — no-op
      }
      return;
    }
    setFallbackOpen(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      >
        <Share2 className="w-4 h-4" />
        Share
      </button>
      {fallbackOpen && (
        <ShareFallbackModal leagueName={leagueName} inviteUrl={inviteUrl} onClose={() => setFallbackOpen(false)} />
      )}
    </>
  );
}

function ShareFallbackModal({ leagueName, inviteUrl, onClose }: { leagueName: string; inviteUrl: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const shareText = `Join my league "${leagueName}" on Bandwagoner! ${inviteUrl}`;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

  const channels = [
    { label: 'Messages', icon: MessageSquare, href: `sms:${isIOS ? '&' : '?'}body=${encodeURIComponent(shareText)}` },
    { label: 'WhatsApp', icon: MessageCircle, href: `https://wa.me/?text=${encodeURIComponent(shareText)}`, external: true },
    { label: 'Email', icon: Mail, href: `mailto:?subject=${encodeURIComponent(`Join ${leagueName} on Bandwagoner`)}&body=${encodeURIComponent(shareText)}` },
  ];

  async function handleCopy() {
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={onClose}>
      <div
        className="bg-gray-900 border border-white/10 rounded-xl w-full max-w-sm shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <WagonMark size={28} />
            <h2 className="text-lg font-bold text-white">Invite to {leagueName}</h2>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5">
          <div className="grid grid-cols-3 gap-3 mb-4">
            {channels.map((c) => (
              <a
                key={c.label}
                href={c.href}
                {...(c.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                onClick={onClose}
                className="flex flex-col items-center gap-1.5 p-3 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white text-xs transition-colors"
              >
                <c.icon className="w-5 h-5" />
                {c.label}
              </a>
            ))}
          </div>
          <button
            onClick={handleCopy}
            className="w-full flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 text-white rounded-lg py-2.5 text-sm transition-colors"
          >
            {copied ? <><Check className="w-4 h-4" /> Copied</> : <><Copy className="w-4 h-4" /> Copy link</>}
          </button>
        </div>
      </div>
    </div>
  );
}
