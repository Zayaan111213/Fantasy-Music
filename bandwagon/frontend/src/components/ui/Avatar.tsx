interface Props {
  src: string | null | undefined;
  name: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const sizes = {
  sm: 'w-7 h-7 text-xs',
  md: 'w-9 h-9 text-sm',
  lg: 'w-12 h-12 text-base',
  xl: 'w-20 h-20 text-2xl',
};

export function Avatar({ src, name, size = 'md' }: Props) {
  return src ? (
    <img src={src} alt={name} className={`${sizes[size]} rounded-full object-cover ring-2 ring-white/10`} />
  ) : (
    <div className={`${sizes[size]} rounded-full bg-indigo-500/30 border border-indigo-500/50 flex items-center justify-center font-semibold text-indigo-300`}>
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}
