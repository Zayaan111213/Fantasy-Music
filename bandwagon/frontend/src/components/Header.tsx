import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Avatar } from './ui/Avatar';
import { Button } from './ui/Button';
import { WagonMark, Wordmark } from './Logo';

interface HeaderProps {
  // Back chevron. Pass a route for a Link, or a handler (e.g. navigate(-1)) for a button.
  backTo?: string;
  onBack?: () => void;
  title?: ReactNode;
  icon?: ReactNode;
  // Extra content rendered before the profile block (e.g. "Draft Live" button, help icon).
  actions?: ReactNode;
  sticky?: boolean;
  maxWidthClass?: string;
  // Home uses the full wordmark; every other page uses just the mark to save space.
  showWordmark?: boolean;
}

export function Header({
  backTo,
  onBack,
  title,
  icon,
  actions,
  sticky = false,
  maxWidthClass = 'max-w-3xl',
  showWordmark = false,
}: HeaderProps) {
  const { user, logout } = useAuth();

  return (
    <header className={`relative border-b border-white/10 ${sticky ? 'sticky top-0 bg-gray-950/80 backdrop-blur-sm z-10' : ''}`}>
      <div className={`${maxWidthClass} mx-auto px-4 py-3 flex items-center gap-3`}>
        {backTo ? (
          <Link to={backTo} className="text-gray-400 hover:text-white transition-colors shrink-0" aria-label="Back">
            <ChevronLeft className="w-5 h-5" />
          </Link>
        ) : onBack ? (
          <button onClick={onBack} className="text-gray-400 hover:text-white transition-colors shrink-0" aria-label="Back">
            <ChevronLeft className="w-5 h-5" />
          </button>
        ) : null}

        <Link to="/home" className="flex items-center gap-2 shrink-0 hover:opacity-80 transition-opacity">
          <WagonMark size={showWordmark ? 32 : 20} />
          {showWordmark && <Wordmark className="text-lg" />}
        </Link>

        {title && (
          <div className="flex items-center gap-2 min-w-0">
            {icon}
            {typeof title === 'string' ? (
              <span className="font-semibold text-white text-sm truncate">{title}</span>
            ) : (
              title
            )}
          </div>
        )}

        <div className="flex-1" />

        {actions}

        <Link to="/account" className="flex items-center gap-2 hover:opacity-80 transition-opacity shrink-0" aria-label="Account settings">
          <Avatar src={user?.avatarUrl} name={user?.username ?? '?'} size="sm" />
          <span className="hidden sm:inline text-gray-400 text-sm">{user?.username}</span>
        </Link>
        <Button variant="ghost" size="sm" onClick={logout} className="shrink-0">Sign out</Button>
      </div>
    </header>
  );
}
