import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Mic, MicOff, Paperclip, Loader2 } from "lucide-react";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatInput({ onSend, disabled, placeholder = "Message Nova..." }: ChatInputProps) {
  const [message, setMessage] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [message]);

  const stopRecording = useCallback(async () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        setIsRecording(false);
        
        if (chunksRef.current.length > 0) {
          setIsTranscribing(true);
          try {
            const audioBlob = new Blob(chunksRef.current, { type: "audio/webm" });
            const response = await fetch("/api/stt", {
              method: "POST",
              body: audioBlob,
              headers: {
                "Content-Type": "audio/webm",
              },
            });
            
            if (response.ok) {
              const data = await response.json();
              if (data.text) {
                setMessage(prev => prev ? `${prev} ${data.text}` : data.text);
              }
            } else {
              console.error("Failed to transcribe audio");
            }
          } catch (error) {
            console.error("Error sending audio for transcription:", error);
          } finally {
            setIsTranscribing(false);
          }
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error("Error starting recording:", error);
    }
  }, []);

  const toggleRecording = async () => {
    if (isRecording) {
      await stopRecording();
    } else {
      await startRecording();
    }
  };

  const handleSubmit = () => {
    if (message.trim() && !disabled) {
      if (isRecording) {
        stopRecording();
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
            placeholder={isRecording ? "Recording..." : isTranscribing ? "Transcribing..." : placeholder}
            disabled={disabled || isTranscribing}
            className="min-h-[44px] max-h-[200px] resize-none pr-12 rounded-2xl border-muted"
            rows={1}
            data-testid="input-message"
          />
        </div>
        
        <Button
          variant={isRecording ? "default" : "ghost"}
          size="icon"
          onClick={toggleRecording}
          disabled={disabled || isTranscribing}
          className={isRecording ? "shrink-0 rounded-full animate-pulse bg-red-500 hover:bg-red-600" : "shrink-0 rounded-full text-muted-foreground"}
          data-testid="button-voice"
        >
          {isTranscribing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isRecording ? (
            <MicOff className="h-4 w-4" />
          ) : (
            <Mic className="h-4 w-4" />
          )}
        </Button>
        
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
