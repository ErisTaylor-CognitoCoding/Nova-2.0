import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatMessage, StreamingMessage, TypingIndicator } from "@/components/chat-message";
import { ChatInput } from "@/components/chat-input";
import { EmptyChat } from "@/components/empty-chat";
import { ConversationSidebar } from "@/components/conversation-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import type { Conversation, Message } from "@shared/schema";

export default function ChatPage() {
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [streamingContent, setStreamingContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

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

        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center justify-between gap-2 px-4 py-3 border-b bg-background">
            <div className="flex items-center gap-2">
              <SidebarTrigger data-testid="button-sidebar-toggle" />
              {activeConversation && (
                <h2 className="font-medium text-sm truncate" data-testid="text-conversation-title">
                  {activeConversation.title}
                </h2>
              )}
            </div>
            <ThemeToggle />
          </header>

          {showEmptyState ? (
            <EmptyChat onStartConversation={handleStartWithPrompt} />
          ) : (
            <>
              <ScrollArea className="flex-1" ref={scrollRef}>
                <div className="max-w-4xl mx-auto py-4">
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

              <ChatInput
                onSend={handleSendMessage}
                disabled={isStreaming || sendMessageMutation.isPending}
                placeholder="Message Nova..."
              />
            </>
          )}
        </div>
      </div>
    </SidebarProvider>
  );
}
