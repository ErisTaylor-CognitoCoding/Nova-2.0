import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Heart, Sparkles } from "lucide-react";
import type { Message } from "@shared/schema";

interface ChatMessageProps {
  message: Message;
  isStreaming?: boolean;
}

export function ChatMessage({ message, isStreaming }: ChatMessageProps) {
  const isNova = message.role === "assistant";

  return (
    <div
      className={cn(
        "flex gap-3 px-4 py-3",
        isNova ? "justify-start" : "justify-end"
      )}
      data-testid={`message-${message.id}`}
    >
      {isNova && (
        <Avatar className="h-9 w-9 shrink-0 border border-primary/20">
          <AvatarFallback className="bg-gradient-to-br from-primary/20 to-primary/5 text-primary">
            <Sparkles className="h-4 w-4" />
          </AvatarFallback>
        </Avatar>
      )}
      
      <div
        className={cn(
          "max-w-[75%] rounded-2xl px-4 py-3",
          isNova
            ? "bg-card text-card-foreground rounded-tl-md"
            : "bg-primary text-primary-foreground rounded-tr-md"
        )}
      >
        <p className="text-sm leading-relaxed whitespace-pre-wrap">
          {message.content}
          {isStreaming && (
            <span className="inline-block w-1.5 h-4 ml-0.5 bg-current animate-pulse rounded-sm" />
          )}
        </p>
      </div>
      
      {!isNova && (
        <Avatar className="h-9 w-9 shrink-0 border border-muted">
          <AvatarFallback className="bg-muted text-muted-foreground">
            <Heart className="h-4 w-4" />
          </AvatarFallback>
        </Avatar>
      )}
    </div>
  );
}

interface StreamingMessageProps {
  content: string;
}

export function StreamingMessage({ content }: StreamingMessageProps) {
  return (
    <div className="flex gap-3 px-4 py-3 justify-start" data-testid="message-streaming">
      <Avatar className="h-9 w-9 shrink-0 border border-primary/20">
        <AvatarFallback className="bg-gradient-to-br from-primary/20 to-primary/5 text-primary">
          <Sparkles className="h-4 w-4" />
        </AvatarFallback>
      </Avatar>
      
      <div className="max-w-[75%] rounded-2xl rounded-tl-md px-4 py-3 bg-card text-card-foreground">
        <p className="text-sm leading-relaxed whitespace-pre-wrap">
          {content}
          <span className="inline-block w-1.5 h-4 ml-0.5 bg-current animate-pulse rounded-sm" />
        </p>
      </div>
    </div>
  );
}

export function TypingIndicator() {
  return (
    <div className="flex gap-3 px-4 py-3 justify-start" data-testid="typing-indicator">
      <Avatar className="h-9 w-9 shrink-0 border border-primary/20">
        <AvatarFallback className="bg-gradient-to-br from-primary/20 to-primary/5 text-primary">
          <Sparkles className="h-4 w-4" />
        </AvatarFallback>
      </Avatar>
      
      <div className="rounded-2xl rounded-tl-md px-4 py-4 bg-card">
        <div className="flex gap-1.5">
          <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:0ms]" />
          <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:150ms]" />
          <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:300ms]" />
        </div>
      </div>
    </div>
  );
}
