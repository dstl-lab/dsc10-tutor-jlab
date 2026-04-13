import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/utils';

interface IChatMessageBoxProps {
  onSubmit: (message: string) => void;
  disabled?: boolean;
  suggestion?: string;
  onSuggestionAccept?: (suggestionText: string) => void;
}

function renderGhost(
  inputValue: string,
  suggestion: string | undefined
): string {
  if (!suggestion) {
    return '';
  }
  if (inputValue.length > 0) {
    if (suggestion.toLowerCase().startsWith(inputValue.toLowerCase())) {
      return suggestion;
    }
    return '';
  }
  return suggestion;
}

export default function ChatMessageBox({
  onSubmit,
  disabled = false,
  suggestion = '',
  onSuggestionAccept
}: IChatMessageBoxProps) {
  const [message, setMessage] = React.useState('');
  const measureRef = React.useRef<HTMLSpanElement>(null);
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const [suggestionLeftPx, setSuggestionLeftPx] = React.useState(0);

  const ghostText = renderGhost(message, suggestion);
  const showGhost = ghostText.length > 0;

  // Measure width of current input so we can position the click-to-accept overlay.
  React.useEffect(() => {
    if (!measureRef.current || !wrapperRef.current) {
      return;
    }
    const textarea = wrapperRef.current.querySelector('textarea');
    if (!textarea) {
      return;
    }
    const style = window.getComputedStyle(textarea);
    const paddingLeft = parseFloat(style.paddingLeft) || 0;
    const width = measureRef.current.offsetWidth;
    setSuggestionLeftPx(paddingLeft + width);
  }, [message, ghostText]);

  const handleSubmit = React.useCallback(() => {
    if (disabled) {
      return;
    }
    if (message.trim()) {
      onSubmit(message.trim());
      setMessage('');
    }
  }, [message, onSubmit, disabled]);

  const acceptSuggestion = React.useCallback(() => {
    if (!suggestion || disabled) {
      return;
    }
    setMessage(suggestion);
    onSuggestionAccept?.(suggestion);
  }, [suggestion, disabled, onSuggestionAccept]);

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (disabled) {
        return;
      }
      if (event.key === 'Tab' && suggestion && ghostText) {
        event.preventDefault();
        acceptSuggestion();
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit, disabled, suggestion, ghostText, acceptSuggestion]
  );

  const handleChange = React.useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (disabled) {
        return;
      }
      setMessage(e.target.value);
    },
    [disabled]
  );

  return (
    <div className="flex flex-col gap-1">
      <div ref={wrapperRef} className="relative">
        {/* Hidden span to measure width of current input (same font/size as textarea) */}
        <span
          ref={measureRef}
          aria-hidden
          className="font-inherit invisible absolute top-0 left-0 border-0 whitespace-pre text-inherit"
          style={{
            font: 'inherit',
            fontSize: 'inherit',
            lineHeight: 'inherit',
            letterSpacing: 'inherit'
          }}
        >
          {message}
        </span>

        {/* Ghost text (gray suggestion) behind the textarea */}
        {showGhost && (
          <div
            className="pointer-events-none absolute inset-0 flex items-start gap-1.5 overflow-hidden rounded-md border border-transparent p-2"
            style={{ color: 'var(--jp-ui-font-color2)' }}
          >
            <span
              className="mt-px inline-flex shrink-0 items-center gap-1 text-[0.85em] leading-none"
              aria-hidden
            >
              <span
                className="rounded border px-1 py-0.5"
                style={{
                  borderColor: 'var(--jp-border-color2)',
                  color: 'var(--jp-ui-font-color2)',
                  fontFamily: 'var(--jp-ui-font-family)'
                }}
              >
                Tab
              </span>
              <span className="opacity-80">→</span>
            </span>
            <span
              className="min-w-0 flex-1 break-words whitespace-pre-wrap"
              style={{
                font: 'inherit',
                fontSize: 'inherit',
                lineHeight: 'inherit',
                letterSpacing: 'inherit'
              }}
            >
              {ghostText}
            </span>
          </div>
        )}

        {/* Clickable overlay over the suggestion part only: click = accept */}
        {showGhost && onSuggestionAccept && (
          <div
            className="absolute top-0 right-0 bottom-0 cursor-text"
            style={{ left: suggestionLeftPx }}
            onClick={acceptSuggestion}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                acceptSuggestion();
              }
            }}
            role="button"
            tabIndex={-1}
            aria-label="Use suggestion"
          />
        )}

        <Textarea
          autoResize
          className={cn(
            'relative max-h-128 bg-transparent',
            disabled ? 'pointer-events-none' : ''
          )}
          value={message}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
        />
      </div>
      <Button onClick={handleSubmit} disabled={disabled}>
        Send
      </Button>
    </div>
  );
}
