import * as React from 'react';

import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

interface IChatMessageBoxProps {
  onSubmit: (message: string) => void;
}

export default function ChatMessageBox({ onSubmit }: IChatMessageBoxProps) {
  const [message, setMessage] = React.useState('');

  const handleSubmit = React.useCallback(() => {
    if (message.trim()) {
      onSubmit(message.trim());
      setMessage('');
    }
  }, [message, onSubmit]);

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  return (
    <div className="flex flex-col gap-1">
      <Textarea
        autoResize
        className="max-h-128"
        value={message}
        onChange={e => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <Button onClick={handleSubmit}>Send</Button>
    </div>
  );
}
