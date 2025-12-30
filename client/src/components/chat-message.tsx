import { useState, useRef } from "react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Heart, Sparkles, Volume2, VolumeX, Loader2 } from "lucide-react";
import type { Message } from "@shared/schema";
import novaAvatar from "@assets/image_1767112700765.png";

interface ChatMessageProps {
  message: Message;
  isStreaming?: boolean;
}

export function ChatMessage({ message, isStreaming }: ChatMessageProps) {
  const isNova = message.role === "assistant";
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handleSpeak = async () => {
    if (isPlaying && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      if (audioRef.current.src) {
        URL.revokeObjectURL(audioRef.current.src);
      }
      setIsPlaying(false);
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: message.content }),
      });

      if (!response.ok) throw new Error("TTS failed");

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      
      if (audioRef.current) {
        audioRef.current.pause();
      }
      
      const audio = new Audio(url);
      audioRef.current = audio;
      
      audio.onended = () => {
        setIsPlaying(false);
        URL.revokeObjectURL(url);
      };
      
      audio.onerror = () => {
        setIsPlaying(false);
        URL.revokeObjectURL(url);
      };

      await audio.play();
      setIsPlaying(true);
    } catch (error) {
      console.error("Error playing speech:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className={cn(
        "flex gap-3 px-4 py-3 group",
        isNova ? "justify-start" : "justify-end"
      )}
      data-testid={`message-${message.id}`}
    >
      {isNova && (
        <Avatar className="h-9 w-9 shrink-0 border border-primary/20">
          <AvatarImage src={novaAvatar} alt="Nova" className="object-cover" />
          <AvatarFallback className="bg-gradient-to-br from-primary/20 to-primary/5 text-primary">
            <Sparkles className="h-4 w-4" />
          </AvatarFallback>
        </Avatar>
      )}
      
      <div className="flex flex-col gap-1">
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
        
        {isNova && !isStreaming && (
          <Button
            size="sm"
            variant="ghost"
            className="self-start h-7 px-2 text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ visibility: "visible" }}
            onClick={handleSpeak}
            disabled={isLoading}
            data-testid={`button-speak-${message.id}`}
          >
            {isLoading ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : isPlaying ? (
              <VolumeX className="h-3 w-3 mr-1" />
            ) : (
              <Volume2 className="h-3 w-3 mr-1" />
            )}
            {isPlaying ? "Stop" : "Listen"}
          </Button>
        )}
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
        <AvatarImage src={novaAvatar} alt="Nova" className="object-cover" />
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
        <AvatarImage src={novaAvatar} alt="Nova" className="object-cover" />
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
