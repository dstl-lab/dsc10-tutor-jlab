import * as React from 'react';

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
      className={['jp-dsc10-Textarea', className].filter(Boolean).join(' ')}
      style={{
        // Provide sensible defaults compatible with JupyterLab theming
        width: '100%',
        minHeight: '4rem',
        padding: '0.5rem 0.75rem',
        borderRadius: 4,
        border: '1px solid var(--jp-border-color2, #c6c6c6)',
        background: 'var(--jp-input-background, transparent)',
        color: 'var(--jp-ui-font-color1, inherit)',
        fontSize: 'var(--jp-ui-font-size1, 14px)',
        boxShadow: 'var(--jp-input-box-shadow, none)',
        resize: 'none'
      }}
      onInput={handleInput}
      value={value}
      {...props}
    />
  );
}

export { Textarea };
