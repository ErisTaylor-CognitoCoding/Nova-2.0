import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Mic, MicOff, Paperclip } from "lucide-react";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

// Check if browser supports speech recognition
const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

export function ChatInput({ onSend, disabled, placeholder = "Message Nova..." }: ChatInputProps) {
  const [message, setMessage] = useState("");
  const [isListening, setIsListening] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [message]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  const startListening = useCallback(() => {
    if (!SpeechRecognition) {
      console.error("Speech recognition not supported");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: any) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setMessage(transcript);
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error:", event.error);
      stopListening();
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [stopListening]);

  const toggleListening = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  const handleSubmit = () => {
    if (message.trim() && !disabled) {
      if (isListening) {
        stopListening();
      }
      onSend(message.trim());
      setMessage("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const hasSpeechRecognition = !!SpeechRecognition;

  return (
    <div className="p-4 border-t bg-background">
      <div className="flex items-end gap-2 max-w-4xl mx-auto">
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 text-muted-foreground"
          disabled={disabled}
          data-testid="button-attach"
        >
          <Paperclip className="h-5 w-5" />
        </Button>
        
        <div className="flex-1 relative">
          <Textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isListening ? "Listening..." : placeholder}
            disabled={disabled}
            className="min-h-[44px] max-h-[200px] resize-none pr-12 rounded-2xl border-muted"
            rows={1}
            data-testid="input-message"
          />
        </div>
        
        {hasSpeechRecognition && (
          <Button
            variant={isListening ? "default" : "ghost"}
            size="icon"
            onClick={toggleListening}
            disabled={disabled}
            className={isListening ? "shrink-0 rounded-full animate-pulse bg-red-500 hover:bg-red-600" : "shrink-0 rounded-full text-muted-foreground"}
            data-testid="button-voice"
          >
            {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </Button>
        )}
        
        <Button
          onClick={handleSubmit}
          disabled={!message.trim() || disabled}
          size="icon"
          className="shrink-0 rounded-full"
          data-testid="button-send"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
