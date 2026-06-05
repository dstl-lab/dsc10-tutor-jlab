import * as React from 'react';

import { logEvent } from '@/api/logger';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/utils';

interface IChatMessageBoxProps {
  onSubmit: (message: string) => void;
  disabled?: boolean;
  suggestion?: string;
  onSuggestionAccept?: (suggestionText: string) => void;
}

export default function ChatMessageBox({
  onSubmit,
  disabled = false,
  suggestion = '',
  onSuggestionAccept
}: IChatMessageBoxProps) {
  const [message, setMessage] = React.useState('');
  const [suggestionAccepted, setSuggestionAccepted] = React.useState(false);
  const activeSuggestionRef = React.useRef<string>('');
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

  React.useEffect(() => {
    if (!suggestion) {
      return;
    }
    setSuggestionAccepted(false);
    activeSuggestionRef.current = '';
  }, [suggestion]);

  const showGhostSuggestion =
    Boolean(suggestion) && !suggestionAccepted && message === '';

  const acceptSuggestion = React.useCallback(() => {
    if (!suggestion || disabled) {
      return;
    }
    setMessage(suggestion);
    setSuggestionAccepted(true);
    activeSuggestionRef.current = suggestion;
    onSuggestionAccept?.(suggestion);
    textareaRef.current?.focus();
  }, [suggestion, disabled, onSuggestionAccept]);

  const handleSubmit = React.useCallback(() => {
    if (disabled) {
      return;
    }
    if (message.trim()) {
      const activeSuggestion = activeSuggestionRef.current;
      if (activeSuggestion) {
        if (message.trim() === activeSuggestion.trim()) {
          logEvent({
            event_type: 'follow_up_sent_unedited',
            payload: { question: message.trim() }
          });
        } else {
          logEvent({
            event_type: 'follow_up_overridden',
            payload: {
              suggestion: activeSuggestion,
              sent_query: message.trim()
            }
          });
        }
        activeSuggestionRef.current = '';
      }
      onSubmit(message.trim());
      setMessage('');
      setSuggestionAccepted(false);
    }
  }, [message, onSubmit, disabled]);

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (disabled) {
        return;
      }
      if (event.key === 'Tab' && showGhostSuggestion) {
        event.preventDefault();
        acceptSuggestion();
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit, disabled, showGhostSuggestion, acceptSuggestion]
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
      <div className="relative">
        <Textarea
          ref={textareaRef}
          autoResize
          className={cn('max-h-128', disabled ? 'pointer-events-none' : '')}
          value={message}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
        />
        {showGhostSuggestion && (
          <div
            className="pointer-events-none absolute inset-0 overflow-hidden rounded-md p-2"
            aria-hidden
          >
            <p className="m-0 leading-relaxed text-gray-400">
              <button
                type="button"
                className="pointer-events-auto mr-1 inline-flex items-center rounded border border-gray-300 px-1.5 py-0.5 align-text-bottom text-xs leading-none text-gray-400 hover:bg-gray-50 hover:text-gray-500"
                onClick={acceptSuggestion}
                tabIndex={-1}
              >
                Tab
              </button>
              <span className="whitespace-pre">→ </span>
              {suggestion}
            </p>
          </div>
        )}
      </div>
      <Button onClick={handleSubmit} disabled={disabled}>
        Send
      </Button>
    </div>
  );
}
