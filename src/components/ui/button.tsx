import * as React from 'react';
import { cn } from '@/utils';

type ButtonProps = React.ComponentProps<'button'> & {
  className?: string;
};

const defaultClasses = cn(
  'h-8 w-full self-end rounded-md bg-jp-brand-color1 px-4 py-1 text-white'
);

export function Button({ className, ...props }: ButtonProps): JSX.Element {
  return <button className={cn(defaultClasses, className)} {...props} />;
}
