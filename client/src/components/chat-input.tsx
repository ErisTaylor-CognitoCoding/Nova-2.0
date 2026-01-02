import { useState, useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Mic, MicOff, Loader2, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
  conversationMode?: boolean;
  onConversationModeToggle?: () => void;
}

export interface ChatInputRef {
  startRecording: () => Promise<void>;
}

export const ChatInput = forwardRef<ChatInputRef, ChatInputProps>(
  ({ onSend, disabled, placeholder = "Message Nova...", conversationMode, onConversationModeToggle }, ref) => {
  const [message, setMessage] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [message]);

  const stopRecording = useCallback(async () => {
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      // Set up audio analysis for silence detection in conversation mode
      if (conversationMode) {
        audioContextRef.current = new AudioContext();
        const source = audioContextRef.current.createMediaStreamSource(stream);
        analyserRef.current = audioContextRef.current.createAnalyser();
        analyserRef.current.fftSize = 256;
        source.connect(analyserRef.current);

        let hasSpeechStarted = false;
        
        const checkSilence = () => {
          if (!analyserRef.current || mediaRecorderRef.current?.state !== "recording") return;
          
          const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
          analyserRef.current.getByteFrequencyData(dataArray);
          const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
          
          // Only start silence detection after user has started speaking
          if (average > 15) {
            hasSpeechStarted = true;
            // Clear any pending silence timeout when speech detected
            if (silenceTimeoutRef.current) {
              clearTimeout(silenceTimeoutRef.current);
              silenceTimeoutRef.current = null;
            }
          } else if (hasSpeechStarted && average < 10) {
            // Silence detected after speech
            if (!silenceTimeoutRef.current) {
              silenceTimeoutRef.current = setTimeout(() => {
                if (mediaRecorderRef.current?.state === "recording") {
                  stopRecording();
                }
              }, 1500); // 1.5 seconds of silence = auto-stop
            }
          }
          
          requestAnimationFrame(checkSilence);
        };
        
        // Small delay before starting detection to let audio context stabilize
        setTimeout(() => {
          requestAnimationFrame(checkSilence);
        }, 200);
      }

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        streamRef.current = null;
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
              if (data.text && data.text.trim()) {
                if (conversationMode) {
                  // Auto-send in conversation mode
                  onSend(data.text.trim());
                } else {
                  setMessage(prev => prev ? `${prev} ${data.text}` : data.text);
                }
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
  }, [conversationMode, onSend, stopRecording]);

  // Expose startRecording to parent
  useImperativeHandle(ref, () => ({
    startRecording,
  }), [startRecording]);

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
    <div className="p-2 sm:p-4 border-t bg-background safe-area-bottom">
      <div className="flex items-end gap-1.5 sm:gap-2 max-w-4xl mx-auto">
        <Button
          variant={conversationMode ? "default" : "ghost"}
          size="icon"
          onClick={onConversationModeToggle}
          className={cn(
            "shrink-0 touch-manipulation",
            conversationMode ? "bg-primary" : "text-muted-foreground"
          )}
          disabled={disabled}
          title={conversationMode ? "Exit conversation mode" : "Enter conversation mode"}
          data-testid="button-conversation-mode"
        >
          <MessageCircle className="h-5 w-5" />
        </Button>
        
        <div className="flex-1 relative min-w-0">
          <Textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              conversationMode 
                ? (isRecording ? "Listening..." : "Tap mic to talk")
                : (isRecording ? "Recording..." : isTranscribing ? "Transcribing..." : placeholder)
            }
            disabled={disabled || isTranscribing || conversationMode}
            className="min-h-[44px] max-h-[200px] resize-none pr-2 rounded-2xl border-muted text-base"
            rows={1}
            data-testid="input-message"
          />
        </div>
        
        <Button
          variant={isRecording ? "default" : "ghost"}
          size="icon"
          onClick={toggleRecording}
          disabled={disabled || isTranscribing}
          className={cn(
            "shrink-0 rounded-full touch-manipulation",
            isRecording ? "animate-pulse bg-red-500 hover:bg-red-600" : "text-muted-foreground"
          )}
          data-testid="button-voice"
        >
          {isTranscribing ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : isRecording ? (
            <MicOff className="h-5 w-5" />
          ) : (
            <Mic className="h-5 w-5" />
          )}
        </Button>
        
        {!conversationMode && (
          <Button
            onClick={handleSubmit}
            disabled={!message.trim() || disabled}
            size="icon"
            className="shrink-0 rounded-full touch-manipulation"
            data-testid="button-send"
          >
            <Send className="h-5 w-5" />
          </Button>
        )}
      </div>
      
      {conversationMode && (
        <p className="text-xs text-muted-foreground text-center mt-2">
          Speak naturally, pause when done. Nova will respond and listen again.
        </p>
      )}
    </div>
  );
});

ChatInput.displayName = "ChatInput";
