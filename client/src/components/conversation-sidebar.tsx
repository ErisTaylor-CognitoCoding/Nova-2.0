import { Plus, MessageCircle, Trash2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import type { Conversation } from "@shared/schema";
import { isToday, isYesterday, isThisWeek, isThisMonth } from "date-fns";

interface ConversationSidebarProps {
  conversations: Conversation[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onNew: () => void;
  onDelete: (id: number) => void;
}

function groupConversations(conversations: Conversation[]) {
  const groups: { label: string; items: Conversation[] }[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "This Week", items: [] },
    { label: "This Month", items: [] },
    { label: "Older", items: [] },
  ];

  conversations.forEach((conv) => {
    const date = new Date(conv.createdAt);
    if (isToday(date)) {
      groups[0].items.push(conv);
    } else if (isYesterday(date)) {
      groups[1].items.push(conv);
    } else if (isThisWeek(date)) {
      groups[2].items.push(conv);
    } else if (isThisMonth(date)) {
      groups[3].items.push(conv);
    } else {
      groups[4].items.push(conv);
    }
  });

  return groups.filter((g) => g.items.length > 0);
}

export function ConversationSidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
}: ConversationSidebarProps) {
  const groups = groupConversations(conversations);
  const { isMobile, setOpenMobile } = useSidebar();

  const handleSelect = (id: number) => {
    onSelect(id);
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  const handleNew = () => {
    onNew();
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  return (
    <Sidebar>
      <SidebarHeader className="border-b p-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center border border-primary/20">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="font-semibold text-foreground truncate">Nova</h1>
            <p className="text-xs text-muted-foreground">Your companion</p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <div className="p-3">
          <Button
            onClick={handleNew}
            className="w-full justify-start gap-2"
            variant="outline"
            data-testid="button-new-conversation"
          >
            <Plus className="h-4 w-4" />
            New conversation
          </Button>
        </div>

        <ScrollArea className="flex-1">
          {groups.map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel className="text-xs text-muted-foreground px-3">
                {group.label}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((conv) => (
                    <SidebarMenuItem key={conv.id}>
                      <div className="flex items-center w-full group">
                        <SidebarMenuButton
                          onClick={() => handleSelect(conv.id)}
                          className={cn(
                            "flex-1 touch-manipulation",
                            activeId === conv.id && "bg-sidebar-accent"
                          )}
                          data-testid={`conversation-${conv.id}`}
                        >
                          <MessageCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="truncate flex-1">{conv.title}</span>
                        </SidebarMenuButton>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 md:h-6 md:w-6 transition-opacity touch-manipulation"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDelete(conv.id);
                          }}
                          data-testid={`button-delete-${conv.id}`}
                        >
                          <Trash2 className="h-4 w-4 md:h-3 md:w-3" />
                        </Button>
                      </div>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </ScrollArea>
      </SidebarContent>

      <SidebarFooter className="border-t p-3">
        <p className="text-xs text-muted-foreground text-center">
          Built with love, just for you
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}
