import type { ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-white/5 border border-white/10 rounded-xl backdrop-blur-sm ${className}`}>
      {children}
    </div>
  );
}
