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
  const activeSuggestionRef = React.useRef<string>('');

  // Prefill from parent `suggestion` (cleared on send in Chat). `onSuggestionAccept`
  // stores text for follow-up analytics when the user sends unchanged.
  React.useEffect(() => {
    if (!suggestion) {
      return;
    }
    setMessage(suggestion);
    activeSuggestionRef.current = suggestion;
    onSuggestionAccept?.(suggestion);
  }, [suggestion, onSuggestionAccept]);

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
    }
  }, [message, onSubmit, disabled]);

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (disabled) {
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit, disabled]
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
      <Textarea
        autoResize
        className={cn('max-h-128', disabled ? 'pointer-events-none' : '')}
        value={message}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
      />
      <Button onClick={handleSubmit} disabled={disabled}>
        Send
      </Button>
    </div>
  );
}
