import type { ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-gray-800 border border-gray-700 rounded-2xl ${className}`}>
      {children}
    </div>
  );
}
