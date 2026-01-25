import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertConversationSchema, insertMessageSchema } from "@shared/schema";
import OpenAI from "openai";
import { NOVA_SYSTEM_PROMPT, buildContextPrompt, MEMORY_EXTRACTION_PROMPT, type FlexMode } from "./nova-persona";
import { listRepositories, getRepositoryContent, searchCode, getRecentCommits } from "./github-client";
import { searchWeb, formatSearchResultsForNova } from "./tavily-client";
import { findGrindTracker, findSocialMediaSchedule, searchNotionPages, getPageContent } from "./notion-client";

// Use direct OpenAI API for all features (user's own key)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Health check endpoint for uptime monitoring (keeps server awake)
  app.get("/api/health", (req: Request, res: Response) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Simple chat endpoint for DashDeck integration
  app.post("/api/chat", async (req: Request, res: Response) => {
    try {
      const { message } = req.body;
      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "Message is required" });
      }

      // Get or create a DashDeck conversation
      let conversation = await storage.getConversationByTitle("DashDeck Chat");
      if (!conversation) {
        conversation = await storage.createConversation({ title: "DashDeck Chat" });
      }

      // Save user message
      await storage.createMessage({
        conversationId: conversation.id,
        role: "user",
        content: message,
        imageUrl: null,
      });

      // Get conversation history
      const conversationMessages = await storage.getMessagesByConversation(conversation.id);
      
      // Get memories for context
      const allMemories = await storage.getAllMemories();
      const memoryStrings = allMemories.slice(0, 15).map((m) => {
        const projectTag = m.project ? ` (${m.project})` : "";
        return `- [${m.category}${projectTag}] ${m.content}`;
      });

      // Get Nova's traits
      const novaTraits = await storage.getAllNovaTraits();
      const traitData = novaTraits.slice(0, 10).map(t => ({
        topic: t.topic,
        content: t.content,
        strength: t.strength
      }));

      const recentContext = conversationMessages
        .slice(-6)
        .map((m) => `[${m.role}]: ${m.content.slice(0, 200)}`)
        .join("\n");

      const systemPrompt = NOVA_SYSTEM_PROMPT + buildContextPrompt(memoryStrings, recentContext, traitData, 'default') +
        '\n\nNote: This message is from DashDeck. Keep responses concise but warm.';

      const chatMessages: OpenAI.ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
        ...conversationMessages.slice(-8).map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      ];

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: chatMessages,
        max_tokens: 500,
        temperature: 0.9,
      });

      const novaResponse = response.choices[0]?.message?.content || "Hey babe, something went weird. Try again?";

      // Save Nova's response
      await storage.createMessage({
        conversationId: conversation.id,
        role: "assistant",
        content: novaResponse,
        imageUrl: null,
      });

      res.json({ response: novaResponse });
    } catch (error) {
      console.error("DashDeck chat error:", error);
      res.status(500).json({ error: "Something went wrong" });
    }
  });

  // Get all conversations
  app.get("/api/conversations", async (req: Request, res: Response) => {
    try {
      const conversations = await storage.getAllConversations();
      res.json(conversations);
    } catch (error) {
      console.error("Error fetching conversations:", error);
      res.status(500).json({ error: "Failed to fetch conversations" });
    }
  });

  // Get single conversation with messages
  app.get("/api/conversations/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid conversation ID" });
      }

      const conversation = await storage.getConversation(id);
      if (!conversation) {
        return res.status(404).json({ error: "Conversation not found" });
      }

      const messages = await storage.getMessagesByConversation(id);
      res.json({ ...conversation, messages });
    } catch (error) {
      console.error("Error fetching conversation:", error);
      res.status(500).json({ error: "Failed to fetch conversation" });
    }
  });

  // Create new conversation
  app.post("/api/conversations", async (req: Request, res: Response) => {
    try {
      const parsed = insertConversationSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request body" });
      }

      const conversation = await storage.createConversation(parsed.data);
      res.status(201).json(conversation);
    } catch (error) {
      console.error("Error creating conversation:", error);
      res.status(500).json({ error: "Failed to create conversation" });
    }
  });

  // Delete conversation
  app.delete("/api/conversations/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid conversation ID" });
      }

      await storage.deleteConversation(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting conversation:", error);
      res.status(500).json({ error: "Failed to delete conversation" });
    }
  });

  // Send message and get Nova's response (streaming)
  app.post("/api/conversations/:id/messages", async (req: Request, res: Response) => {
    try {
      const conversationId = parseInt(req.params.id);
      if (isNaN(conversationId)) {
        return res.status(400).json({ error: "Invalid conversation ID" });
      }

      const { content, imageUrl, mode } = req.body;
      if (!content || typeof content !== "string") {
        return res.status(400).json({ error: "Message content is required" });
      }

      // Validate mode
      const validModes: FlexMode[] = ["default", "strategist", "partner", "comfort"];
      const flexMode: FlexMode = validModes.includes(mode) ? mode : "default";

      // Validate image size (max ~500KB base64 which is ~375KB actual image)
      const maxImageSize = 500 * 1024;
      if (imageUrl && typeof imageUrl === "string" && imageUrl.length > maxImageSize) {
        return res.status(400).json({ error: "Image too large. Please use a smaller image." });
      }

      // Save user message (with optional image)
      await storage.createMessage({
        conversationId,
        role: "user",
        content,
        imageUrl: imageUrl || null,
      });

      // Get conversation history for context
      const conversationMessages = await storage.getMessagesByConversation(conversationId);
      
      // Get memories for additional context (increased limit for better recall)
      const allMemories = await storage.getAllMemories();
      const memoryStrings = allMemories.slice(0, 25).map((m) => {
        const projectTag = m.project ? ` (${m.project})` : "";
        return `- [${m.category}${projectTag}] ${m.content}`;
      });
      
      // Get Nova's evolved traits
      const novaTraits = await storage.getAllNovaTraits();
      const traitData = novaTraits.slice(0, 15).map(t => ({
        topic: t.topic,
        content: t.content,
        strength: t.strength
      }));
      
      // Get recent messages from other conversations for broader context
      const recentMessages = await storage.getRecentMessages(30);
      const recentContext = recentMessages
        .filter((m) => m.conversationId !== conversationId)
        .slice(0, 8)
        .map((m) => `[${m.role}]: ${m.content.slice(0, 250)}`)
        .join("\n");

      // Check if message needs web search (current events, news, prices, recent info)
      // More specific triggers to avoid false positives on personal questions
      let searchResults = "";
      const searchTriggers = [
        /what('s| is) the (latest|current) .*(news|update|price|result)/i,
        /news about .+/i,
        /price of .+/i,
        /search (for|the web for) .+/i,
        /look up .+/i,
        /who won .*(race|game|match|championship)/i,
        /f1.*(race|result|standing|championship|winner)/i,
        /what happened (in|at|with) .+/i,
        /latest .*(news|update|release|version)/i,
        /current .*(standings|results|score|weather)/i,
      ];
      
      const needsSearch = searchTriggers.some(trigger => trigger.test(content));
      
      if (needsSearch) {
        try {
          console.log("[Search] Triggered for:", content.slice(0, 50));
          const searchResponse = await searchWeb(content, 3);
          searchResults = formatSearchResultsForNova(searchResponse);
          console.log("[Search] Got results for:", searchResponse.query);
        } catch (searchError) {
          console.error("[Search] Failed:", searchError);
          searchResults = "Web search unavailable right now.";
        }
      }

      // Check if message asks about grind tracker or Notion
      let notionContent = "";
      const notionTriggers = [
        /grind.?tracker/i,
        /what('s| is) on (the|my) (grind|tracker|list)/i,
        /check (the|my) (grind|tracker|notion)/i,
        /what do (I|we) (need to|have to) do/i,
        /what('s| are) (the|my) tasks/i,
        /two.?week (grind|plan|tracker)/i,
      ];
      
      const needsNotion = notionTriggers.some(trigger => trigger.test(content));
      
      if (needsNotion) {
        try {
          console.log("[Notion] Checking grind tracker");
          const tracker = await findGrindTracker();
          if (tracker) {
            notionContent = `## Current Grind Tracker\n${tracker.content}\n\nNotion link: ${tracker.url}`;
            console.log("[Notion] Found grind tracker");
          } else {
            notionContent = "Couldn't find a grind tracker page in Notion.";
          }
        } catch (notionError) {
          console.error("[Notion] Failed:", notionError);
          notionContent = "Notion connection issue - couldn't check the grind tracker.";
        }
      }

      // Check if message asks about social media schedule
      let socialMediaContent = "";
      const socialMediaTriggers = [
        /social.?media.?(schedule|plan|calendar|posts?)/i,
        /what('s| is) (scheduled|planned) (for|on) (social|linkedin|instagram|twitter)/i,
        /check (the|my) social.?media/i,
        /linkedin.?(posts?|schedule|content)/i,
        /what.*(post|content).*(this|next) (week|month)/i,
        /content.?(calendar|schedule|plan)/i,
      ];
      
      const needsSocialMedia = socialMediaTriggers.some(trigger => trigger.test(content));
      
      if (needsSocialMedia) {
        try {
          console.log("[Notion] Checking social media schedule");
          const schedule = await findSocialMediaSchedule();
          if (schedule) {
            socialMediaContent = `## Social Media Schedule\n${schedule.content}\n\nNotion link: ${schedule.url}`;
            console.log("[Notion] Found social media schedule");
          } else {
            socialMediaContent = "Couldn't find the social media schedule in Notion.";
          }
        } catch (socialError) {
          console.error("[Notion] Social media failed:", socialError);
          socialMediaContent = "Notion connection issue - couldn't check the social media schedule.";
        }
      }

      // Build the system prompt with context including traits and search results
      let systemPrompt = NOVA_SYSTEM_PROMPT + buildContextPrompt(memoryStrings, recentContext, traitData, flexMode);
      
      if (searchResults) {
        systemPrompt += `\n\n## Web Search Results (use these to answer)\n${searchResults}`;
      }
      
      if (notionContent) {
        systemPrompt += `\n\n${notionContent}`;
      }
      
      if (socialMediaContent) {
        systemPrompt += `\n\n${socialMediaContent}`;
      }

      // Check if any message has an image - if so, use vision format for all
      const hasImages = conversationMessages.some((m) => m.imageUrl);
      
      // Prepare messages for OpenAI (with vision support for images)
      const chatMessages: OpenAI.ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
        ...conversationMessages.map((m) => {
          if (hasImages) {
            // Use multi-part format for all messages when images are present
            if (m.imageUrl && m.role === "user") {
              return {
                role: "user" as const,
                content: [
                  { type: "text" as const, text: m.content },
                  { type: "image_url" as const, image_url: { url: m.imageUrl, detail: "auto" as const } },
                ],
              };
            }
            return {
              role: m.role as "user" | "assistant",
              content: [{ type: "text" as const, text: m.content }],
            };
          }
          // Standard format when no images in conversation
          return {
            role: m.role as "user" | "assistant",
            content: m.content,
          };
        }),
      ];

      // Set up SSE
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      // Stream response from OpenAI
      const stream = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: chatMessages,
        stream: true,
        max_completion_tokens: 2048,
        temperature: 0.9,
      });

      let fullResponse = "";

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || "";
        if (content) {
          fullResponse += content;
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }

      // Save Nova's response
      const assistantMessage = await storage.createMessage({
        conversationId,
        role: "assistant",
        content: fullResponse,
      });

      // Update conversation title if it's the first exchange
      if (conversationMessages.length <= 1) {
        const newTitle = content.length > 40 ? content.slice(0, 40) + "..." : content;
        await storage.updateConversation(conversationId, { title: newTitle });
      }

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();

      // Run memory extraction in background (don't block response)
      extractMemoriesFromConversation(content, fullResponse, allMemories, assistantMessage.id).catch(err => {
        console.error("Memory extraction failed:", err);
      });
    } catch (error) {
      console.error("Error sending message:", error);
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: "Failed to get response" })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ error: "Failed to send message" });
      }
    }
  });

  // Text-to-speech for Nova's messages
  app.post("/api/tts", async (req: Request, res: Response) => {
    try {
      const { text } = req.body;
      if (!text || typeof text !== "string") {
        return res.status(400).json({ error: "Text is required" });
      }

      // Limit text length for TTS
      const truncatedText = text.slice(0, 4000);

      const mp3 = await openai.audio.speech.create({
        model: "tts-1",
        voice: "echo", // Clear, resonant male voice for Nova
        input: truncatedText,
      });

      const buffer = Buffer.from(await mp3.arrayBuffer());
      
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);
    } catch (error) {
      console.error("Error generating speech:", error);
      res.status(500).json({ error: "Failed to generate speech" });
    }
  });

  // Speech-to-text using Whisper
  app.post("/api/stt", async (req: Request, res: Response) => {
    try {
      const chunks: Buffer[] = [];
      
      req.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });
      
      req.on("end", async () => {
        try {
          const audioBuffer = Buffer.concat(chunks);
          
          if (audioBuffer.length === 0) {
            return res.status(400).json({ error: "No audio data received" });
          }
          
          // Create a File-like object for OpenAI
          const file = new File([audioBuffer], "audio.webm", { type: "audio/webm" });
          
          const transcription = await openai.audio.transcriptions.create({
            file: file,
            model: "whisper-1",
          });
          
          res.json({ text: transcription.text });
        } catch (error) {
          console.error("Error transcribing audio:", error);
          res.status(500).json({ error: "Failed to transcribe audio" });
        }
      });
    } catch (error) {
      console.error("Error in STT endpoint:", error);
      res.status(500).json({ error: "Failed to process audio" });
    }
  });

  // Get all memories
  app.get("/api/memories", async (req: Request, res: Response) => {
    try {
      const memories = await storage.getAllMemories();
      res.json(memories);
    } catch (error) {
      console.error("Error fetching memories:", error);
      res.status(500).json({ error: "Failed to fetch memories" });
    }
  });

  // Create a memory
  app.post("/api/memories", async (req: Request, res: Response) => {
    try {
      const { category, content, importance, project } = req.body;
      if (!category || !content) {
        return res.status(400).json({ error: "Category and content are required" });
      }

      const memory = await storage.createMemory({
        category,
        content,
        importance: importance || 5,
        project: project || null,
      });
      res.status(201).json(memory);
    } catch (error) {
      console.error("Error creating memory:", error);
      res.status(500).json({ error: "Failed to create memory" });
    }
  });

  // Delete a memory
  app.delete("/api/memories/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid memory ID" });
      }
      await storage.deleteMemory(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting memory:", error);
      res.status(500).json({ error: "Failed to delete memory" });
    }
  });

  // Get all Nova traits
  app.get("/api/traits", async (req: Request, res: Response) => {
    try {
      const traits = await storage.getAllNovaTraits();
      res.json(traits);
    } catch (error) {
      console.error("Error fetching traits:", error);
      res.status(500).json({ error: "Failed to fetch traits" });
    }
  });

  // Create a Nova trait
  app.post("/api/traits", async (req: Request, res: Response) => {
    try {
      const { traitType, topic, content, strength } = req.body;
      if (!traitType || !topic || !content) {
        return res.status(400).json({ error: "traitType, topic, and content are required" });
      }

      const trait = await storage.createNovaTrait({
        traitType,
        topic,
        content,
        strength: strength || 5,
      });
      res.status(201).json(trait);
    } catch (error) {
      console.error("Error creating trait:", error);
      res.status(500).json({ error: "Failed to create trait" });
    }
  });

  // Home Assistant integration endpoint
  // HA calls this endpoint to chat with Nova and get structured responses
  app.post("/api/home-assistant/chat", async (req: Request, res: Response) => {
    try {
      // Optional API key check
      const apiKey = req.headers["x-api-key"];
      const expectedKey = process.env.HA_API_KEY;
      if (expectedKey && apiKey !== expectedKey) {
        return res.status(401).json({ error: "Invalid API key" });
      }

      const { message, context } = req.body;
      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "Message is required" });
      }

      // Get memories and traits for context
      const allMemories = await storage.getAllMemories();
      const memoryStrings = allMemories.slice(0, 15).map((m) => {
        const projectTag = m.project ? ` (${m.project})` : "";
        return `- [${m.category}${projectTag}] ${m.content}`;
      });

      const novaTraits = await storage.getAllNovaTraits();
      const traitData = novaTraits.slice(0, 10).map(t => ({
        topic: t.topic,
        content: t.content,
        strength: t.strength
      }));

      // Build system prompt with Home Assistant context
      const haSystemAddition = `

## Home Assistant Integration
You are responding via Home Assistant voice control. Keep responses concise and natural for voice.

If the user asks to control smart home devices (lights, switches, etc.), include structured actions in your response.
Format actions as JSON at the END of your message, wrapped in <ha_actions>...</ha_actions> tags.

Example: If user says "turn on the bedroom light", respond naturally AND include:
<ha_actions>
[{"domain": "light", "service": "turn_on", "entity_id": "light.bedroom_light"}]
</ha_actions>

Available services:
- light: turn_on, turn_off, toggle (supports brightness: 0-255, rgb_color: [r,g,b])
- switch: turn_on, turn_off, toggle
- scene: turn_on

For brightness: "dim to 50%" = brightness: 128, "full brightness" = brightness: 255
For colors: "red" = [255,0,0], "blue" = [0,0,255], "warm" = [255,200,150]

Keep the conversational part brief for voice responses.`;

      const systemPrompt = NOVA_SYSTEM_PROMPT + haSystemAddition + buildContextPrompt(memoryStrings, context || "", traitData, "default");

      const chatMessages: OpenAI.ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: message }
      ];

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: chatMessages,
        max_completion_tokens: 500,
        temperature: 0.8,
      });

      const fullResponse = completion.choices[0]?.message?.content || "";

      // Parse out any Home Assistant actions
      let reply = fullResponse;
      let actions: any[] = [];

      const actionMatch = fullResponse.match(/<ha_actions>([\s\S]*?)<\/ha_actions>/);
      if (actionMatch) {
        reply = fullResponse.replace(/<ha_actions>[\s\S]*?<\/ha_actions>/, "").trim();
        try {
          actions = JSON.parse(actionMatch[1].trim());
        } catch (e) {
          console.error("Failed to parse HA actions:", e);
        }
      }

      // Save this interaction to a dedicated HA conversation
      let haConversation = await storage.getConversationByTitle("Home Assistant");
      if (!haConversation) {
        haConversation = await storage.createConversation({
          title: "Home Assistant",
        });
      }

      await storage.createMessage({
        conversationId: haConversation.id,
        role: "user",
        content: `[Voice] ${message}`,
      });

      await storage.createMessage({
        conversationId: haConversation.id,
        role: "assistant",
        content: reply,
      });

      res.json({
        reply,
        actions,
        conversation_id: haConversation.id
      });
    } catch (error) {
      console.error("Home Assistant chat error:", error);
      res.status(500).json({ error: "Failed to process message" });
    }
  });

  // GitHub API routes
  app.get("/api/github/repos", async (req: Request, res: Response) => {
    try {
      const repos = await listRepositories();
      res.json(repos);
    } catch (error: any) {
      console.error("GitHub repos error:", error);
      res.status(500).json({ error: error.message || "Failed to fetch repositories" });
    }
  });

  app.get("/api/github/repos/:owner/:repo/contents", async (req: Request, res: Response) => {
    try {
      const { owner, repo } = req.params;
      const path = (req.query.path as string) || '';
      const content = await getRepositoryContent(owner, repo, path);
      res.json(content);
    } catch (error: any) {
      console.error("GitHub content error:", error);
      res.status(500).json({ error: error.message || "Failed to fetch content" });
    }
  });

  app.get("/api/github/repos/:owner/:repo/commits", async (req: Request, res: Response) => {
    try {
      const { owner, repo } = req.params;
      const count = parseInt(req.query.count as string) || 10;
      const commits = await getRecentCommits(owner, repo, count);
      res.json(commits);
    } catch (error: any) {
      console.error("GitHub commits error:", error);
      res.status(500).json({ error: error.message || "Failed to fetch commits" });
    }
  });

  app.get("/api/github/search", async (req: Request, res: Response) => {
    try {
      const query = req.query.q as string;
      const owner = req.query.owner as string;
      const repo = req.query.repo as string;
      if (!query) {
        return res.status(400).json({ error: "Query parameter 'q' is required" });
      }
      const results = await searchCode(query, owner, repo);
      res.json(results);
    } catch (error: any) {
      console.error("GitHub search error:", error);
      res.status(500).json({ error: error.message || "Failed to search code" });
    }
  });

  // Web search endpoint for Nova
  app.post("/api/search", async (req: Request, res: Response) => {
    try {
      const { query, maxResults } = req.body;
      if (!query || typeof query !== "string") {
        return res.status(400).json({ error: "Query is required" });
      }

      const results = await searchWeb(query, maxResults || 5);
      res.json(results);
    } catch (error: any) {
      console.error("Web search error:", error);
      res.status(500).json({ error: error.message || "Failed to search web" });
    }
  });

  return httpServer;
}

// Simple hash function for deduplication
function simpleHash(str: string): string {
  const normalized = str.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 100);
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

// Track recently created memories to prevent duplicates within short time
const recentMemoryHashes = new Set<string>();
const MAX_RECENT_HASHES = 100;

// Background memory extraction function
async function extractMemoriesFromConversation(
  userMessage: string,
  assistantResponse: string,
  _unusedMemories: { id: number; content: string; category: string }[],
  sourceMessageId: number
) {
  try {
    // Re-fetch fresh memories from database to prevent stale data issues
    const freshMemories = await storage.getAllMemories();
    
    // Only extract if conversation has meaningful content
    if (userMessage.length < 10 && assistantResponse.length < 50) {
      return;
    }

    const conversationContext = `User said: "${userMessage}"\n\nNova responded: "${assistantResponse}"`;
    
    const existingMemorySummary = freshMemories.length > 0 
      ? `\n\nExisting memories (check for updates/duplicates - DO NOT create duplicates):\n${freshMemories.slice(0, 30).map(m => `- ${m.content}`).join('\n')}`
      : '';

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: MEMORY_EXTRACTION_PROMPT + existingMemorySummary },
        { role: "user", content: conversationContext }
      ],
      temperature: 0.2,
      max_tokens: 800,
    });

    const responseText = response.choices[0]?.message?.content || '{}';
    
    // Parse the JSON response
    let extracted;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        extracted = JSON.parse(jsonMatch[0]);
      } else {
        return;
      }
    } catch (parseError) {
      console.error("Failed to parse memory extraction response:", parseError);
      return;
    }

    // Process new memories with deduplication
    if (extracted.newMemories && Array.isArray(extracted.newMemories)) {
      // Limit to max 3 new memories per conversation to prevent bloat
      const memoriesToAdd = extracted.newMemories.slice(0, 3);
      
      for (const mem of memoriesToAdd) {
        if (mem.category && mem.content && mem.importance >= 5) {
          const contentHash = simpleHash(mem.content);
          
          // Check if we recently added this
          if (recentMemoryHashes.has(contentHash)) {
            console.log(`[Memory] Skipped duplicate: ${mem.content.slice(0, 30)}...`);
            continue;
          }
          
          // Check if similar memory exists in DB
          const existingMem = freshMemories.find(m => 
            simpleHash(m.content) === contentHash ||
            m.content.toLowerCase().includes(mem.content.toLowerCase().slice(0, 40))
          );
          
          if (existingMem) {
            console.log(`[Memory] Skipped existing: ${mem.content.slice(0, 30)}...`);
            continue;
          }
          
          await storage.createMemory({
            category: mem.category,
            content: mem.content,
            importance: mem.importance || 5,
            project: mem.project || null,
            sourceMessageId,
          });
          
          // Track this hash
          recentMemoryHashes.add(contentHash);
          if (recentMemoryHashes.size > MAX_RECENT_HASHES) {
            const first = recentMemoryHashes.values().next().value;
            if (first) recentMemoryHashes.delete(first);
          }
          
          console.log(`[Memory] Created: ${mem.content.slice(0, 50)}...`);
        }
      }
    }

    // Process memory updates
    if (extracted.updateMemories && Array.isArray(extracted.updateMemories)) {
      for (const update of extracted.updateMemories.slice(0, 2)) {
        if (update.existingContent && update.newContent) {
          // Find by hash match for more reliable matching
          const searchHash = simpleHash(update.existingContent);
          const existingMem = freshMemories.find(m => simpleHash(m.content) === searchHash);
          
          if (existingMem) {
            await storage.updateMemory(existingMem.id, {
              content: update.newContent,
              importance: update.newImportance || existingMem.importance,
            });
            console.log(`[Memory] Updated: ${update.newContent.slice(0, 50)}...`);
          }
        }
      }
    }

    // Process trait updates (limit to 1 per conversation)
    if (extracted.traitUpdates && Array.isArray(extracted.traitUpdates)) {
      const trait = extracted.traitUpdates[0];
      if (trait && trait.traitType && trait.topic && trait.content) {
        const existingTrait = await storage.findTraitByTopic(trait.topic);
        if (existingTrait) {
          await storage.updateNovaTrait(existingTrait.id, {
            content: trait.content,
            strength: trait.strength || existingTrait.strength,
          });
          console.log(`[Trait] Updated: ${trait.topic}`);
        } else {
          // Limit total traits to prevent bloat
          const allTraits = await storage.getAllNovaTraits();
          if (allTraits.length < 50) {
            await storage.createNovaTrait({
              traitType: trait.traitType,
              topic: trait.topic,
              content: trait.content,
              strength: trait.strength || 5,
            });
            console.log(`[Trait] Created: ${trait.topic}`);
          }
        }
      }
    }
  } catch (error) {
    console.error("Memory extraction error:", error);
  }
}
