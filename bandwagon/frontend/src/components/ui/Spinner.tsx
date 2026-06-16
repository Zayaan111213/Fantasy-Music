export function Spinner({ className = '' }: { className?: string }) {
  return (
    <div className={`animate-spin rounded-full border-2 border-white/20 border-t-indigo-500 ${className}`} />
  );
}

export function FullPageSpinner() {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <Spinner className="w-10 h-10" />
    </div>
  );
}
