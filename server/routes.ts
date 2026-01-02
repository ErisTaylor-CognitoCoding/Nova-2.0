import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertConversationSchema, insertMessageSchema } from "@shared/schema";
import OpenAI from "openai";
import { NOVA_SYSTEM_PROMPT, buildContextPrompt, MEMORY_EXTRACTION_PROMPT, type FlexMode } from "./nova-persona";

// Use Replit's AI integration for chat (cheaper/faster)
const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// Use direct OpenAI API for TTS (not supported by Replit proxy)
const openaiDirect = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
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

      // Build the system prompt with context including traits
      const systemPrompt = NOVA_SYSTEM_PROMPT + buildContextPrompt(memoryStrings, recentContext, traitData, flexMode);

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

      const mp3 = await openaiDirect.audio.speech.create({
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
          
          const transcription = await openaiDirect.audio.transcriptions.create({
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
