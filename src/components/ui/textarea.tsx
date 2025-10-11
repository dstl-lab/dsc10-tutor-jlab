import * as React from 'react';

import { cn } from '@/utils';

type TextareaProps = React.ComponentProps<'textarea'> & {
  autoResize?: boolean;
};

function Textarea({
  className,
  autoResize,
  onInput,
  value,
  ...props
}: TextareaProps) {
  const internalRef = React.useRef<HTMLTextAreaElement | null>(null);

  const applyAutoResize = React.useCallback((element: HTMLTextAreaElement) => {
    if (!element) {
      return;
    }
    element.style.height = 'auto';

    const computedMax = window.getComputedStyle(element).maxHeight;
    const maxHeight =
      computedMax === 'none'
        ? Number.POSITIVE_INFINITY
        : parseFloat(computedMax);
    const nextHeight = Math.min(
      element.scrollHeight,
      isNaN(maxHeight) ? Number.POSITIVE_INFINITY : maxHeight
    );

    element.style.height = `${nextHeight}px`;
    // element.style.overflowY =
    //   element.scrollHeight > nextHeight ? 'auto' : 'hidden';
  }, []);

  const handleInput = React.useCallback(
    (event: React.FormEvent<HTMLTextAreaElement>) => {
      if (autoResize) {
        applyAutoResize(event.currentTarget);
      }
      if (onInput) {
        onInput(event);
      }
    },
    [autoResize, applyAutoResize, onInput]
  );

  React.useEffect(() => {
    if (autoResize && internalRef.current) {
      applyAutoResize(internalRef.current);
    }
  }, [autoResize, value, applyAutoResize]);

  return (
    <textarea
      ref={internalRef}
      data-slot="textarea"
      className={cn(
        'min-h-16, w-full resize-none rounded-md border-1 border-jp-brand-color2 p-2 transition-[color,box-shadow]',
        className
      )}
      onInput={handleInput}
      value={value}
      {...props}
    />
  );
}

export { Textarea };
