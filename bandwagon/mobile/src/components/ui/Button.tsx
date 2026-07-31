import { Pressable, Text, type PressableProps } from 'react-native';
import type { ReactNode } from 'react';

interface Props extends PressableProps {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
  className?: string;
}

const variants = {
  primary: 'bg-indigo-500 active:bg-indigo-600',
  secondary: 'bg-white/10 border border-white/20',
  ghost: 'active:bg-white/10',
  danger: 'bg-red-500/20 border border-red-500/30',
};

const textVariants = {
  primary: 'text-gray-950',
  secondary: 'text-white',
  ghost: 'text-gray-300',
  danger: 'text-red-400',
};

const sizes = {
  sm: 'px-3 py-1.5',
  md: 'px-4 py-2.5',
  lg: 'px-6 py-3.5',
};

const textSizes = {
  sm: 'text-sm',
  md: 'text-sm',
  lg: 'text-base',
};

export function Button({ variant = 'primary', size = 'md', className = '', children, disabled, ...props }: Props) {
  return (
    <Pressable
      disabled={disabled}
      className={`flex-row items-center justify-center gap-2 rounded-lg ${variants[variant]} ${sizes[size]} ${disabled ? 'opacity-50' : ''} ${className}`}
      {...props}
    >
      {typeof children === 'string' ? (
        <Text className={`font-medium ${textVariants[variant]} ${textSizes[size]}`}>{children}</Text>
      ) : (
        children
      )}
    </Pressable>
  );
}
