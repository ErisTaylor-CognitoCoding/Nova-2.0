import { cn } from "@/lib/utils";
import novaAvatar from "@assets/image_1767112700765.png";

interface PresencePanelProps {
  isTyping?: boolean;
  className?: string;
}

export function PresencePanel({ isTyping, className }: PresencePanelProps) {
  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center bg-gradient-to-b from-background to-muted/30 overflow-hidden",
        className
      )}
    >
      <div className="absolute inset-0 overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center blur-2xl opacity-20 scale-110"
          style={{ backgroundImage: `url(${novaAvatar})` }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-transparent" />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-4 p-6">
        <div className="relative">
          <div
            className={cn(
              "absolute -inset-3 rounded-full bg-primary/20 blur-xl transition-opacity duration-1000",
              isTyping ? "opacity-60 animate-pulse" : "opacity-30"
            )}
          />
          <div className="relative">
            <img
              src={novaAvatar}
              alt="Nova"
              className="w-48 h-48 md:w-56 md:h-56 lg:w-64 lg:h-64 rounded-full object-cover border-4 border-background shadow-2xl"
              data-testid="img-nova-avatar"
            />
            <div
              className={cn(
                "absolute bottom-4 right-4 w-5 h-5 rounded-full border-4 border-background transition-colors",
                isTyping ? "bg-primary animate-pulse" : "bg-green-500"
              )}
              data-testid="status-nova-online"
            />
          </div>
        </div>

        <div className="text-center space-y-1">
          <h2 className="text-2xl font-semibold" data-testid="text-nova-name">Nova</h2>
          <p className="text-sm text-muted-foreground" data-testid="text-nova-status">
            {isTyping ? "typing..." : "Online"}
          </p>
        </div>

        <div className="flex flex-wrap justify-center gap-2 mt-2 max-w-xs">
          <span className="px-3 py-1 text-xs rounded-full bg-muted text-muted-foreground">
            F1 Fan
          </span>
          <span className="px-3 py-1 text-xs rounded-full bg-muted text-muted-foreground">
            Thriller Nights
          </span>
          <span className="px-3 py-1 text-xs rounded-full bg-muted text-muted-foreground">
            Code Together
          </span>
        </div>
      </div>
    </div>
  );
}

export function PresenceHeader({ isTyping }: { isTyping?: boolean }) {
  return (
    <div className="flex items-center gap-4 p-4 border-b bg-gradient-to-r from-muted/50 to-background">
      <div className="relative">
        <img
          src={novaAvatar}
          alt="Nova"
          className="w-14 h-14 rounded-full object-cover border-2 border-background shadow-lg"
          data-testid="img-nova-avatar-header"
        />
        <div
          className={cn(
            "absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 border-background",
            isTyping ? "bg-primary animate-pulse" : "bg-green-500"
          )}
        />
      </div>
      <div>
        <h2 className="font-semibold" data-testid="text-nova-name-header">Nova</h2>
        <p className="text-xs text-muted-foreground">
          {isTyping ? "typing..." : "Online"}
        </p>
      </div>
    </div>
  );
}
