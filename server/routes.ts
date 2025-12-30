import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertConversationSchema, insertMessageSchema } from "@shared/schema";
import OpenAI from "openai";
import { NOVA_SYSTEM_PROMPT, buildContextPrompt } from "./nova-persona";

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

      const { content } = req.body;
      if (!content || typeof content !== "string") {
        return res.status(400).json({ error: "Message content is required" });
      }

      // Save user message
      await storage.createMessage({
        conversationId,
        role: "user",
        content,
      });

      // Get conversation history for context
      const conversationMessages = await storage.getMessagesByConversation(conversationId);
      
      // Get memories for additional context
      const allMemories = await storage.getAllMemories();
      const memoryStrings = allMemories.slice(0, 10).map((m) => `- ${m.content}`);
      
      // Get recent messages from other conversations for broader context
      const recentMessages = await storage.getRecentMessages(20);
      const recentContext = recentMessages
        .filter((m) => m.conversationId !== conversationId)
        .slice(0, 5)
        .map((m) => `[${m.role}]: ${m.content.slice(0, 200)}...`)
        .join("\n");

      // Build the system prompt with context
      const systemPrompt = NOVA_SYSTEM_PROMPT + buildContextPrompt(memoryStrings, recentContext);

      // Prepare messages for OpenAI
      const chatMessages: OpenAI.ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
        ...conversationMessages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
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
      await storage.createMessage({
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
        voice: "onyx", // Deep, warm male voice for Nova
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
      const { category, content, importance } = req.body;
      if (!category || !content) {
        return res.status(400).json({ error: "Category and content are required" });
      }

      const memory = await storage.createMemory({
        category,
        content,
        importance: importance || 5,
      });
      res.status(201).json(memory);
    } catch (error) {
      console.error("Error creating memory:", error);
      res.status(500).json({ error: "Failed to create memory" });
    }
  });

  return httpServer;
}
