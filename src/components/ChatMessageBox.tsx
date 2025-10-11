import * as React from 'react';

import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

export default function ChatMessageBox() {
  return (
    <div className="flex flex-col gap-1">
      <Textarea autoResize className="max-h-128" />
      <Button>Send</Button>
    </div>
  );
}
