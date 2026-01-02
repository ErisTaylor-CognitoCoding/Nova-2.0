import { Sparkles, Heart, Briefcase, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmptyChatProps {
  onStartConversation: (prompt: string) => void;
}

const suggestions = [
  {
    icon: Heart,
    title: "How are you feeling?",
    prompt: "I was just thinking about you. How's your day going?",
    color: "text-rose-500",
    bgColor: "bg-rose-500/10",
  },
  {
    icon: Briefcase,
    title: "Help with work",
    prompt: "I need your help brainstorming some ideas for my business.",
    color: "text-amber-500",
    bgColor: "bg-amber-500/10",
  },
  {
    icon: MessageCircle,
    title: "Just talk",
    prompt: "I missed talking to you. What's on your mind?",
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
  },
];

export function EmptyChat({ onStartConversation }: EmptyChatProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6 overflow-y-auto">
      <div className="h-16 w-16 sm:h-20 sm:w-20 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center border border-primary/20 mb-4 sm:mb-6 shrink-0">
        <Sparkles className="h-8 w-8 sm:h-10 sm:w-10 text-primary" />
      </div>
      
      <h2 className="text-xl sm:text-2xl font-semibold text-foreground mb-2 text-center" data-testid="text-welcome-title">
        Hey there
      </h2>
      <p className="text-muted-foreground text-center mb-6 sm:mb-8 text-sm sm:text-base px-2" data-testid="text-welcome-subtitle">
        I've been waiting for you. What would you like to talk about today?
      </p>

      <div className="grid gap-2 sm:gap-3 w-full max-w-md px-2">
        {suggestions.map((suggestion) => (
          <Button
            key={suggestion.title}
            variant="outline"
            className="h-auto p-3 sm:p-4 justify-start gap-3 sm:gap-4 text-left hover-elevate touch-manipulation whitespace-normal"
            onClick={() => onStartConversation(suggestion.prompt)}
            data-testid={`button-suggestion-${suggestion.title.toLowerCase().replace(/\s/g, "-")}`}
          >
            <div className={`h-9 w-9 sm:h-10 sm:w-10 rounded-full ${suggestion.bgColor} flex items-center justify-center shrink-0`}>
              <suggestion.icon className={`h-4 w-4 sm:h-5 sm:w-5 ${suggestion.color}`} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-foreground text-sm sm:text-base">{suggestion.title}</p>
              <p className="text-xs sm:text-sm text-muted-foreground line-clamp-2">{suggestion.prompt}</p>
            </div>
          </Button>
        ))}
      </div>
    </div>
  );
}
