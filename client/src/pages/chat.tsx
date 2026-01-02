import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatMessage, StreamingMessage, TypingIndicator } from "@/components/chat-message";
import { ChatInput, ChatInputRef } from "@/components/chat-input";
import { EmptyChat } from "@/components/empty-chat";
import { ConversationSidebar } from "@/components/conversation-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { PresencePanel, PresenceHeader } from "@/components/presence-panel";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import type { Conversation, Message } from "@shared/schema";

export default function ChatPage() {
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [streamingContent, setStreamingContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [conversationMode, setConversationMode] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<ChatInputRef>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pendingAutoRecordRef = useRef(false);

  const { data: conversations = [], isLoading: conversationsLoading } = useQuery<Conversation[]>({
    queryKey: ["/api/conversations"],
  });

  const { data: activeConversation, isLoading: messagesLoading } = useQuery<Conversation & { messages: Message[] }>({
    queryKey: ["/api/conversations", activeConversationId],
    enabled: activeConversationId !== null,
  });

  const createConversationMutation = useMutation({
    mutationFn: async (title: string) => {
      const res = await apiRequest("POST", "/api/conversations", { title });
      return res.json();
    },
    onSuccess: (newConversation: Conversation) => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      setActiveConversationId(newConversation.id);
    },
  });

  const deleteConversationMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/conversations/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      if (activeConversationId === deleteConversationMutation.variables) {
        setActiveConversationId(null);
      }
    },
  });

  // Play TTS for a message
  const playTTS = useCallback(async (text: string): Promise<void> => {
    return new Promise(async (resolve, reject) => {
      try {
        setIsPlayingAudio(true);
        const response = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });

        if (!response.ok) {
          throw new Error("Failed to generate speech");
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        
        if (audioRef.current) {
          audioRef.current.pause();
        }
        
        const audio = new Audio(url);
        audioRef.current = audio;
        
        audio.onended = () => {
          URL.revokeObjectURL(url);
          setIsPlayingAudio(false);
          resolve();
        };
        
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          setIsPlayingAudio(false);
          reject(new Error("Audio playback failed"));
        };
        
        await audio.play();
      } catch (error) {
        setIsPlayingAudio(false);
        reject(error);
      }
    });
  }, []);

  const sendMessageMutation = useMutation({
    mutationFn: async ({ conversationId, content }: { conversationId: number; content: string }) => {
      setIsStreaming(true);
      setStreamingContent("");

      const response = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });

      if (!response.ok) throw new Error("Failed to send message");

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No reader available");

      const decoder = new TextDecoder();
      let fullContent = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.content) {
                fullContent += data.content;
                setStreamingContent(fullContent);
              }
              if (data.done) {
                setIsStreaming(false);
                queryClient.invalidateQueries({ queryKey: ["/api/conversations", conversationId] });
                
                // Auto-play in conversation mode
                if (conversationMode && fullContent) {
                  pendingAutoRecordRef.current = true;
                  try {
                    await playTTS(fullContent);
                    // Auto-start recording after TTS finishes
                    if (pendingAutoRecordRef.current && conversationMode) {
                      setTimeout(() => {
                        chatInputRef.current?.startRecording();
                      }, 500);
                    }
                  } catch (err) {
                    console.error("TTS error in conversation mode:", err);
                  }
                  pendingAutoRecordRef.current = false;
                }
              }
            } catch {
              // Ignore parse errors for incomplete JSON
            }
          }
        }
      }

      if (buffer.startsWith("data: ")) {
        try {
          const data = JSON.parse(buffer.slice(6));
          if (data.done) {
            setIsStreaming(false);
            queryClient.invalidateQueries({ queryKey: ["/api/conversations", conversationId] });
          }
        } catch {
          // Final buffer parse error
        }
      }
      
      return fullContent;
    },
    onError: () => {
      setIsStreaming(false);
    },
  });

  const handleNewConversation = () => {
    createConversationMutation.mutate("New conversation");
  };

  const handleStartWithPrompt = async (prompt: string) => {
    const res = await apiRequest("POST", "/api/conversations", { title: prompt.slice(0, 50) + "..." });
    const newConversation = await res.json();
    queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
    setActiveConversationId(newConversation.id);
    
    // Wait a tick for state to update, then send the message
    setTimeout(() => {
      sendMessageMutation.mutate({ conversationId: newConversation.id, content: prompt });
    }, 100);
  };

  const handleSendMessage = (content: string) => {
    if (activeConversationId) {
      sendMessageMutation.mutate({ conversationId: activeConversationId, content });
    }
  };

  const handleConversationModeToggle = () => {
    setConversationMode(!conversationMode);
    pendingAutoRecordRef.current = false;
    if (audioRef.current) {
      audioRef.current.pause();
    }
  };

  // Auto-scroll when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeConversation?.messages, streamingContent]);

  const messages = activeConversation?.messages || [];
  const showEmptyState = activeConversationId === null;

  const sidebarStyle = {
    "--sidebar-width": "18rem",
    "--sidebar-width-icon": "3rem",
  } as React.CSSProperties;

  return (
    <SidebarProvider style={sidebarStyle}>
      <div className="flex h-screen w-full">
        <ConversationSidebar
          conversations={conversations}
          activeId={activeConversationId}
          onSelect={setActiveConversationId}
          onNew={handleNewConversation}
          onDelete={(id) => deleteConversationMutation.mutate(id)}
        />

        <div className="flex flex-1 min-w-0">
          <PresencePanel 
            isTyping={isStreaming || sendMessageMutation.isPending}
            isSpeaking={isPlayingAudio}
            className="hidden lg:flex w-[320px] xl:w-[380px] border-r shrink-0"
          />

          <div className="flex flex-col flex-1 min-w-0 h-full">
            <header className="flex items-center justify-between gap-2 px-3 sm:px-4 py-2 sm:py-3 border-b bg-background shrink-0 z-10">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <SidebarTrigger data-testid="button-sidebar-toggle" className="shrink-0" />
                {activeConversation && (
                  <h2 className="font-medium text-sm truncate" data-testid="text-conversation-title">
                    {activeConversation.title}
                  </h2>
                )}
              </div>
              <ThemeToggle />
            </header>

            <div className="lg:hidden shrink-0">
              <PresenceHeader isTyping={isStreaming || sendMessageMutation.isPending} isSpeaking={isPlayingAudio} />
            </div>

            {showEmptyState ? (
              <EmptyChat onStartConversation={handleStartWithPrompt} />
            ) : (
              <>
                <ScrollArea className="flex-1 overflow-auto" ref={scrollRef}>
                  <div className="max-w-3xl mx-auto py-4 px-2 sm:px-4">
                    {messagesLoading ? (
                      <div className="flex items-center justify-center py-12">
                        <div className="text-muted-foreground">Loading...</div>
                      </div>
                    ) : messages.length === 0 && !isStreaming ? (
                      <EmptyChat onStartConversation={(prompt) => handleSendMessage(prompt)} />
                    ) : (
                      <>
                        {messages.map((message) => (
                          <ChatMessage key={message.id} message={message} />
                        ))}
                        {isStreaming && streamingContent && (
                          <StreamingMessage content={streamingContent} />
                        )}
                        {sendMessageMutation.isPending && !streamingContent && (
                          <TypingIndicator />
                        )}
                      </>
                    )}
                  </div>
                </ScrollArea>

                <div className="shrink-0">
                  <ChatInput
                    ref={chatInputRef}
                    onSend={handleSendMessage}
                    disabled={isStreaming || sendMessageMutation.isPending || isPlayingAudio}
                    placeholder="Message Nova..."
                    conversationMode={conversationMode}
                    onConversationModeToggle={handleConversationModeToggle}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </SidebarProvider>
  );
}
