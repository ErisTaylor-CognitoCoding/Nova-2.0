import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { useToast } from "@/hooks/use-toast";
import { Plus, ArrowLeft, Trash2, ExternalLink, Video, Youtube, Clock } from "lucide-react";
import { SiTiktok } from "react-icons/si";
import { Link } from "wouter";
import type { ScienceStanVideo } from "@shared/schema";

const CLIP_LABELS = [
  { key: "1", name: "Hook", description: "Grab attention" },
  { key: "2", name: "Rising Action", description: "Build tension" },
  { key: "3", name: "Conflict", description: "The problem" },
  { key: "4", name: "Comeback", description: "The solution" },
  { key: "5", name: "Outcome", description: "Resolution" },
];

const STATUS_OPTIONS = [
  { value: "draft", label: "Draft", color: "bg-muted text-muted-foreground" },
  { value: "in-production", label: "In Production", color: "bg-yellow-500/20 text-yellow-700 dark:text-yellow-400" },
  { value: "published", label: "Published", color: "bg-green-500/20 text-green-700 dark:text-green-400" },
];

function getStatusBadge(status: string) {
  const option = STATUS_OPTIONS.find((o) => o.value === status) || STATUS_OPTIONS[0];
  return <Badge className={option.color}>{option.label}</Badge>;
}

export default function ScienceStanPage() {
  const { toast } = useToast();
  const [selectedVideo, setSelectedVideo] = useState<ScienceStanVideo | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const { data: videos = [], isLoading } = useQuery<ScienceStanVideo[]>({
    queryKey: ["/api/science-stan/videos"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { title: string; hook: string }) => {
      const res = await apiRequest("POST", "/api/science-stan/videos", data);
      return res.json();
    },
    onSuccess: (newVideo) => {
      queryClient.invalidateQueries({ queryKey: ["/api/science-stan/videos"] });
      setIsCreateOpen(false);
      setSelectedVideo(newVideo);
      toast({ title: "Video created", description: "Start adding your clips!" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: Partial<ScienceStanVideo> & { id: number }) => {
      const res = await apiRequest("PATCH", `/api/science-stan/videos/${id}`, data);
      return res.json();
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["/api/science-stan/videos"] });
      setSelectedVideo(updated);
      toast({ title: "Saved", description: "Changes saved successfully" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/science-stan/videos/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/science-stan/videos"] });
      setSelectedVideo(null);
      toast({ title: "Deleted", description: "Video removed" });
    },
  });

  if (selectedVideo) {
    return (
      <VideoEditor
        video={selectedVideo}
        onBack={() => setSelectedVideo(null)}
        onSave={(data) => updateMutation.mutate({ id: selectedVideo.id, ...data })}
        onDelete={() => deleteMutation.mutate(selectedVideo.id)}
        isSaving={updateMutation.isPending}
      />
    );
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="flex items-center justify-between p-4 border-b gap-4">
        <div className="flex items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="icon" data-testid="button-back-home">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <Video className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-semibold">Science Stan</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-create-video">
                <Plus className="h-4 w-4 mr-2" />
                New Video
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New Science Stan Video</DialogTitle>
              </DialogHeader>
              <CreateVideoForm
                onSubmit={(data) => createMutation.mutate(data)}
                isLoading={createMutation.isPending}
              />
            </DialogContent>
          </Dialog>
          <ThemeToggle />
        </div>
      </header>

      <ScrollArea className="flex-1">
        <div className="p-6 max-w-4xl mx-auto">
          {isLoading ? (
            <div className="text-center py-12 text-muted-foreground">Loading videos...</div>
          ) : videos.length === 0 ? (
            <Card className="text-center py-12">
              <CardContent>
                <Video className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-muted-foreground mb-4">No videos yet</p>
                <Button onClick={() => setIsCreateOpen(true)} data-testid="button-create-first">
                  <Plus className="h-4 w-4 mr-2" />
                  Create your first video
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {videos.map((video) => (
                <Card
                  key={video.id}
                  className="hover-elevate cursor-pointer"
                  onClick={() => setSelectedVideo(video)}
                  data-testid={`card-video-${video.id}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium truncate">{video.title}</h3>
                        <p className="text-sm text-muted-foreground truncate mt-1">
                          {video.hook}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {video.youtubeUrl && (
                          <Youtube className="h-4 w-4 text-red-500" />
                        )}
                        {video.tiktokUrl && (
                          <SiTiktok className="h-4 w-4" />
                        )}
                        {getStatusBadge(video.status)}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function CreateVideoForm({
  onSubmit,
  isLoading,
}: {
  onSubmit: (data: { title: string; hook: string }) => void;
  isLoading: boolean;
}) {
  const [title, setTitle] = useState("");
  const [hook, setHook] = useState("");

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          placeholder="What's this video about?"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          data-testid="input-video-title"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="hook">Hook</Label>
        <Textarea
          id="hook"
          placeholder="The attention-grabbing opening line..."
          value={hook}
          onChange={(e) => setHook(e.target.value)}
          rows={3}
          data-testid="input-video-hook"
        />
      </div>
      <Button
        className="w-full"
        onClick={() => onSubmit({ title, hook })}
        disabled={!title || !hook || isLoading}
        data-testid="button-submit-video"
      >
        {isLoading ? "Creating..." : "Create Video"}
      </Button>
    </div>
  );
}

function VideoEditor({
  video,
  onBack,
  onSave,
  onDelete,
  isSaving,
}: {
  video: ScienceStanVideo;
  onBack: () => void;
  onSave: (data: Partial<ScienceStanVideo>) => void;
  onDelete: () => void;
  isSaving: boolean;
}) {
  const [formData, setFormData] = useState({
    title: video.title,
    hook: video.hook,
    status: video.status,
    youtubeUrl: video.youtubeUrl || "",
    tiktokUrl: video.tiktokUrl || "",
    clip1Prompt: video.clip1Prompt || "",
    clip1Vo: video.clip1Vo || "",
    clip2Prompt: video.clip2Prompt || "",
    clip2Vo: video.clip2Vo || "",
    clip3Prompt: video.clip3Prompt || "",
    clip3Vo: video.clip3Vo || "",
    clip4Prompt: video.clip4Prompt || "",
    clip4Vo: video.clip4Vo || "",
    clip5Prompt: video.clip5Prompt || "",
    clip5Vo: video.clip5Vo || "",
  });

  const updateField = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    onSave(formData);
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="flex items-center justify-between p-4 border-b gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onBack} data-testid="button-back-list">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-xl font-semibold truncate">{video.title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" data-testid="button-delete-video">
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this video?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently remove all prompts and voice-overs.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={onDelete} data-testid="button-confirm-delete">
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button onClick={handleSave} disabled={isSaving} data-testid="button-save-video">
            {isSaving ? "Saving..." : "Save"}
          </Button>
          <ThemeToggle />
        </div>
      </header>

      <ScrollArea className="flex-1">
        <div className="p-6 max-w-4xl mx-auto space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Video Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="edit-title">Title</Label>
                  <Input
                    id="edit-title"
                    value={formData.title}
                    onChange={(e) => updateField("title", e.target.value)}
                    data-testid="input-edit-title"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="status">Status</Label>
                  <Select
                    value={formData.status}
                    onValueChange={(value) => updateField("status", value)}
                  >
                    <SelectTrigger id="status" data-testid="select-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-hook">Hook</Label>
                <Textarea
                  id="edit-hook"
                  value={formData.hook}
                  onChange={(e) => updateField("hook", e.target.value)}
                  rows={2}
                  data-testid="input-edit-hook"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="youtube-url" className="flex items-center gap-2">
                    <Youtube className="h-4 w-4 text-red-500" />
                    YouTube URL
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="youtube-url"
                      placeholder="https://youtube.com/shorts/..."
                      value={formData.youtubeUrl}
                      onChange={(e) => updateField("youtubeUrl", e.target.value)}
                      data-testid="input-youtube-url"
                    />
                    {formData.youtubeUrl && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => window.open(formData.youtubeUrl, "_blank")}
                        data-testid="button-open-youtube"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tiktok-url" className="flex items-center gap-2">
                    <SiTiktok className="h-4 w-4" />
                    TikTok URL
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="tiktok-url"
                      placeholder="https://tiktok.com/..."
                      value={formData.tiktokUrl}
                      onChange={(e) => updateField("tiktokUrl", e.target.value)}
                      data-testid="input-tiktok-url"
                    />
                    {formData.tiktokUrl && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => window.open(formData.tiktokUrl, "_blank")}
                        data-testid="button-open-tiktok"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Clock className="h-5 w-5" />
                5-Clip Structure
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {CLIP_LABELS.map((clip) => {
                const promptKey = `clip${clip.key}Prompt` as keyof typeof formData;
                const voKey = `clip${clip.key}Vo` as keyof typeof formData;
                return (
                  <div key={clip.key} className="space-y-3 pb-6 border-b last:border-0 last:pb-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-mono">
                        {clip.key}
                      </Badge>
                      <span className="font-medium">{clip.name}</span>
                      <span className="text-sm text-muted-foreground">- {clip.description}</span>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor={`prompt-${clip.key}`}>VEO3 Prompt</Label>
                        <Textarea
                          id={`prompt-${clip.key}`}
                          placeholder="Describe what happens in this 8s clip..."
                          value={formData[promptKey] || ""}
                          onChange={(e) => updateField(promptKey, e.target.value)}
                          rows={4}
                          data-testid={`input-clip${clip.key}-prompt`}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`vo-${clip.key}`} className="flex items-center justify-between">
                          <span>Voice-Over</span>
                          <span className="text-xs text-muted-foreground font-mono">
                            {(formData[voKey] || "").length}/500
                          </span>
                        </Label>
                        <Textarea
                          id={`vo-${clip.key}`}
                          placeholder="What Stan says..."
                          value={formData[voKey] || ""}
                          onChange={(e) => {
                            if (e.target.value.length <= 500) {
                              updateField(voKey, e.target.value);
                            }
                          }}
                          rows={4}
                          data-testid={`input-clip${clip.key}-vo`}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </div>
  );
}
