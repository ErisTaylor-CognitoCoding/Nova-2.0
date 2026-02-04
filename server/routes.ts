import type { Express, Request, Response } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { insertConversationSchema } from "@shared/schema";
import OpenAI from "openai";
import { NOVA_SYSTEM_PROMPT, buildContextPrompt, MEMORY_EXTRACTION_PROMPT, type FlexMode } from "./nova-persona";

import { listRepositories, getRepositoryContent, searchCode, getRecentCommits } from "./github-client";
import { searchWeb, formatSearchResultsForNova } from "./tavily-client";

import { 
  findGrindTracker, 
  findSocialMediaSchedule, 
  updateGrindTaskStatus,
  addGrindTask,
  getAccountsSummary,
  addSubscription,
  addIncome,
  addExpense
} from "./notion-client";
import { 
  getRecentEmails, 
  getSubscriptionEmails, 
  searchEmails, 
  getEmailDetail, 
  getUnreadCount,
  testConnection as testGmailConnection,
  sendEmail,
  getAuthUrl,
  exchangeCodeForTokens,
  isConfigured,
  isAuthorized
} from "./gmail-client";

// Constants
const MAX_IMAGE_SIZE = 500 * 1024; // ~500KB base64 which is ~375KB actual image
const MAX_TTS_LENGTH = 4000;
const AI_SPENDING_ALERT_THRESHOLD = 300;

// Track last database context per conversation for follow-up questions
const conversationDbContext: Map<number, { dbName: string; timestamp: number }> = new Map();

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
      
      // Check for Replit receipt (forwarded email)
      let notionWriteResult = "";
      const isReplitReceiptDash = /(?:receipt\s+from\s+replit|replit\s+receipt|your\s+replit\s+receipt)/i.test(message);
      const replitAmountMatchDash = message.match(/\$(\d+\.\d+)/);
      if (isReplitReceiptDash && replitAmountMatchDash) {
        const amount = parseFloat(replitAmountMatchDash[1]);
        if (!isNaN(amount)) {
          const today = new Date().toISOString().split('T')[0];
          const result = await addExpense('Replit credits', amount, today);
          notionWriteResult = result.message;
        }
      }

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

      let systemPrompt = NOVA_SYSTEM_PROMPT + buildContextPrompt(memoryStrings, recentContext, traitData, 'default') +
        '\n\nNote: This message is from DashDeck. Keep responses concise but warm.';
      
      if (notionWriteResult) {
        systemPrompt += `\n\n**NOTION UPDATE COMPLETED:** ${notionWriteResult}. Confirm this to Zero briefly.`;
      }

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

      // Validate image size
      if (imageUrl && typeof imageUrl === "string" && imageUrl.length > MAX_IMAGE_SIZE) {
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
          const searchResponse = await searchWeb(content, 3);
          searchResults = formatSearchResultsForNova(searchResponse);
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
          const tracker = await findGrindTracker();
          if (tracker) {
            notionContent = `## Current Grind Tracker\n${tracker.content}\n\nNotion link: ${tracker.url}`;
          } else {
            notionContent = "Couldn't find a grind tracker page in Notion.";
          }
        } catch (notionError) {
          console.error("[Notion] Failed:", notionError);
          notionContent = "Notion connection issue - couldn't check the grind tracker.";
        }
      }

      // Check for document collaboration (read/write Notion pages)
      let documentContent = "";
      const documentReadTriggers = [
        /(?:open|read|show|check|look at|pull up|find)\s+(?:the\s+)?(?:notion\s+)?(?:page|doc|document)\s+(?:called\s+|named\s+)?["']?(.+?)["']?$/i,
        /what('s| is) (?:in|on) (?:the\s+)?["']?(.+?)["']?\s+(?:page|doc|document)/i,
        /(?:can you\s+)?(?:read|check)\s+["']?(.+?)["']?\s+(?:in|on|from)\s+notion/i,
        /show me\s+(?:the\s+)?["']?(.+?)["']?\s+(?:page|document)/i,
        /recent\s+(?:notion\s+)?(?:pages|documents)/i,
        /what\s+(?:notion\s+)?pages\s+(?:do\s+)?(?:we|I)\s+have/i,
        /(?:our|the|eris|taylor'?s?)\s*(?:notion\s+)?(?:teamspace|workspace|team\s*space|work\s*space)/i,
        /notion\s+(?:teamspace|workspace|team\s*space|work\s*space)/i,
        /what('s| is) in (?:our\s+)?(?:notion|teamspace|workspace)/i,
      ];
      
      const documentWriteTriggers = [
        /add\s+(?:this\s+)?(?:to|on)\s+(?:the\s+)?["']?(.+?)["']?\s+(?:page|doc|document)/i,
        /(?:append|write|put)\s+(?:.+?)\s+(?:to|on|in)\s+(?:the\s+)?["']?(.+?)["']?\s+(?:page|doc)/i,
        /update\s+(?:the\s+)?["']?(.+?)["']?\s+(?:page|doc|document)\s+(?:with|to)/i,
        /create\s+(?:a\s+)?(?:new\s+)?(?:notion\s+)?(?:page|doc|document)\s+(?:called\s+|named\s+)?["']?(.+?)["']?/i,
        /make\s+(?:a\s+)?(?:new\s+)?(?:page|doc)\s+(?:for|about|called)\s+["']?(.+?)["']?/i,
        /(?:can you\s+)?add\s+(?:a\s+)?(?:new\s+)?(?:notion\s+)?(?:page|doc|document)/i,
        /(?:can you\s+)?create\s+(?:a\s+)?(?:new\s+)?(?:notion\s+)?(?:page|doc|document)/i,
      ];
      
      // Check if this is a create page request without a name (needs to ask for name)
      const isCreateRequest = /(?:add|create|make)\s+(?:a\s+)?(?:new\s+)?(?:notion\s+)?(?:page|doc|document)/i.test(content);
      
      const needsDocumentRead = documentReadTriggers.some(trigger => trigger.test(content));
      const needsDocumentWrite = documentWriteTriggers.some(trigger => trigger.test(content));
      
      if (needsDocumentRead || needsDocumentWrite) {
        try {
          const { listRecentPages, getPageByName, searchNotionPages } = await import('./notion-client');
          
          // Check if asking for recent pages
          if (/recent|list|what.*pages.*have|teamspace|workspace/i.test(content)) {
            const recentPages = await listRecentPages(15);
            documentContent = `## Notion Workspace - ACTUAL DATA FROM API\n`;
            for (const page of recentPages) {
              const date = new Date(page.lastEdited).toLocaleDateString('en-GB');
              const icon = page.type === 'database' ? '📊' : '📄';
              documentContent += `- ${icon} **${page.title}** (${date})\n`;
            }
            documentContent += `\nThese are the ONLY pages that exist. Do NOT make up other page names.`;
          } else if (isCreateRequest) {
            // Check if they provided a name with the create request
            const createMatch = content.match(/(?:create|add|make)\s+(?:a\s+)?(?:new\s+)?(?:notion\s+)?(?:page|doc|document)\s+(?:called|named|for|about)\s+["']?(.+?)["']?$/i);
            if (createMatch && createMatch[1]) {
              documentContent = `**Ready to create a new Notion page called "${createMatch[1]}".** Just tell me what content to put in it, or say "create it empty" to start with a blank page.`;
            } else {
              documentContent = `**I can create a new Notion page!** What should I call it?`;
            }
          } else {
            // Try to extract page name and fetch it
            let pageName = '';
            for (const trigger of [...documentReadTriggers, ...documentWriteTriggers]) {
              const match = content.match(trigger);
              if (match && match[1]) {
                pageName = match[1].replace(/["']/g, '').trim();
                break;
              }
            }
            
            if (pageName) {
              const page = await getPageByName(pageName);
              if (page) {
                documentContent = `## ${page.title}\n\n${page.content || '(Empty page)'}\n\n[Notion link](${page.url})`;
                
                if (needsDocumentWrite) {
                  documentContent += `\n\n**Ready to update this page.** Just tell me what to add!`;
                }
              } else {
                const suggestions = await searchNotionPages(pageName);
                if (suggestions.length > 0) {
                  documentContent = `Couldn't find "${pageName}" exactly. Did you mean:\n`;
                  for (const s of suggestions.slice(0, 5)) {
                    documentContent += `- ${s.title}\n`;
                  }
                } else {
                  documentContent = `Couldn't find a page called "${pageName}" in Notion.`;
                }
              }
            }
          }
        } catch (docError) {
          console.error("[Notion] Document error:", docError);
          documentContent = "Had trouble accessing Notion documents.";
        }
      }

      // Check if message asks about a specific database (CRM, Leads, Proposals, etc.)
      let databaseQueryContent = "";
      
      // Check for database lookups (CRM, Leads, Proposals, POCs, etc.)
      const databaseLookups = [
        { pattern: /(?:companies?\s*)?crm|what\s+companies|list\s+(?:of\s+)?companies|show\s+(?:me\s+)?companies/i, dbName: 'Companies CRM' },
        { pattern: /leads?\s*(?:tracker)?/i, dbName: 'Leads Tracker' },
        { pattern: /free\s*pocs?/i, dbName: 'Free POCs' },
        { pattern: /linkedin\s*proposals?/i, dbName: 'Linkedin Proposals' },
        { pattern: /upwork\s*proposals?/i, dbName: 'Upwork Proposals' },
        { pattern: /other\s*proposals?/i, dbName: 'Other Proposals' },
        { pattern: /social\s*media\s*hooks?/i, dbName: 'Social Media Hooks' },
        { pattern: /workflow\s*automation/i, dbName: 'Workflow Automation Proposals' },
      ];
      
      let targetDb = '';
      let searchTerm = '';
      
      // Try to match database lookup patterns
      for (const lookup of databaseLookups) {
        if (lookup.pattern.test(content)) {
          targetDb = lookup.dbName;
          
          // Extract search term - look for common patterns
          // Pattern: "for X from CRM" or "for X in CRM"
          const forPattern = /(?:for|about)\s+["']?([^"']+?)["']?\s+(?:from|in)\s+(?:the\s+)?(?:our\s+)?(?:companies?\s*)?(?:crm|leads|proposals|pocs|tracker)/i;
          const forMatch = content.match(forPattern);
          
          if (forMatch) {
            searchTerm = forMatch[1].trim();
          } else {
            // Pattern: "CRM for X" or "check CRM for X"
            const afterPattern = /(?:crm|leads|proposals|pocs|tracker)\s+(?:for|about)\s+["']?([^"']+?)["']?$/i;
            const afterMatch = content.match(afterPattern);
            if (afterMatch) {
              searchTerm = afterMatch[1].trim();
            }
          }
          
          // Save context for follow-up questions
          if (conversationId) {
            conversationDbContext.set(conversationId, { dbName: targetDb, timestamp: Date.now() });
          }
          break;
        }
      }
      
      // Check for follow-up questions using saved context (within 10 minutes)
      if (!targetDb && conversationId) {
        const context = conversationDbContext.get(conversationId);
        const tenMinutes = 10 * 60 * 1000;
        
        if (context && (Date.now() - context.timestamp) < tenMinutes) {
          // Patterns that suggest a follow-up question about the same database
          const followUpPatterns = [
            /what(?:'s| is| are)?\s+(?:on\s+there|in\s+there|in\s+it)/i,
            /show\s+(?:me\s+)?(?:all|everything|the\s+list)/i,
            /list\s+(?:them|all|everything)/i,
            /find\s+["']?([^"']+?)["']?$/i,
            /search\s+(?:for\s+)?["']?([^"']+?)["']?$/i,
            /(?:any|got)\s+(?:entries|records|data)/i,
            /what\s+(?:else|other)/i,
          ];
          
          for (const pattern of followUpPatterns) {
            const match = content.match(pattern);
            if (match) {
              targetDb = context.dbName;
              // Extract search term if present
              if (match[1]) {
                searchTerm = match[1].trim();
              }
              break;
            }
          }
        }
      }
      
      if (targetDb) {
        try {
          const { queryDatabaseByName } = await import('./notion-client');
          const result = await queryDatabaseByName(targetDb, searchTerm || undefined);
          
          if (result.found && result.data.length > 0) {
            if (searchTerm) {
              databaseQueryContent = `## ${result.dbName} - Results for "${searchTerm}"\n\n`;
            } else {
              databaseQueryContent = `## ${result.dbName} - All Entries (${result.data.length})\n\n`;
            }
            
            // Limit to 10 entries max to avoid huge responses
            const entries = result.data.slice(0, 10);
            for (const entry of entries) {
              for (const [key, value] of Object.entries(entry)) {
                if (key !== 'id' && value) {
                  databaseQueryContent += `- **${key}**: ${value}\n`;
                }
              }
              databaseQueryContent += '\n';
            }
            
            if (result.data.length > 10) {
              databaseQueryContent += `\n(Showing 10 of ${result.data.length} entries)\n`;
            }
            
            databaseQueryContent += `\n**CRITICAL: This is the ACTUAL data from Notion. Do NOT make up or invent any other details. Only report what is shown above.**`;
          } else if (result.found) {
            databaseQueryContent = `No entries found${searchTerm ? ` for "${searchTerm}"` : ''} in ${result.dbName}.`;
          } else {
            databaseQueryContent = `Could not find database "${targetDb}" in your workspace.`;
          }
        } catch (dbError) {
          console.error("[Notion] Database error:", dbError);
          databaseQueryContent = `Had trouble querying ${targetDb}.`;
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
          const schedule = await findSocialMediaSchedule();
          if (schedule) {
            socialMediaContent = `## Social Media Schedule\n${schedule.content}\n\nNotion link: ${schedule.url}`;
          } else {
            socialMediaContent = "Couldn't find the social media schedule in Notion.";
          }
        } catch (socialError) {
          console.error("[Notion] Social media failed:", socialError);
          socialMediaContent = "Notion connection issue - couldn't check the social media schedule.";
        }
      }

      // Check for accounts/finances queries
      let accountsContent = "";
      const accountsTriggers = [
        /accounts?/i,
        /financ(e|es|ial)/i,
        /income/i,
        /expenses?/i,
        /profit/i,
        /money/i,
        /how.*(we|the company|cognito).*(doing|making)/i,
        /check.*(the|our|company).*(books|accounts|financ)/i,
      ];
      
      // AI tools / credits triggers
      const aiToolsTriggers = [
        /ai\s*(tools?|spend|spending|credits?)/i,
        /replit\s*(credits?|spend|spending|cost)/i,
        /openai\s*(credits?|spend|spending|cost)/i,
        /anthropic\s*(credits?|spend|spending|cost)/i,
        /claude\s*(credits?|spend|spending|cost)/i,
        /how\s+much\s+(am\s+I|are\s+we|have\s+I|have\s+we)\s+(spend|spent|using)/i,
        /credit\s*(usage|spend|spending)/i,
        /£\d+.*credits?/i,
        /credits?.*£\d+/i,
      ];
      
      const needsAccounts = accountsTriggers.some(trigger => trigger.test(content));
      const needsAITools = aiToolsTriggers.some(trigger => trigger.test(content));
      
      if (needsAccounts || needsAITools) {
        try {
          accountsContent = await getAccountsSummary();
          
          // Also get AI tools spending if specifically asked
          if (needsAITools) {
            const { getAIToolsSpending } = await import('./notion-client');
            const aiSpending = await getAIToolsSpending();
            if (aiSpending.tools.length > 0) {
              accountsContent += "\n\n## AI Tools Spending This Month\n";
              for (const [tool, amount] of Object.entries(aiSpending.currentMonthCredits)) {
                accountsContent += `- ${tool}: £${amount.toFixed(2)} in credits this month\n`;
              }
              accountsContent += `\n**Summary:**\n`;
              accountsContent += `- Total monthly subscriptions: £${aiSpending.summary.totalSubscriptions.toFixed(2)}\n`;
              accountsContent += `- Average monthly credits: £${aiSpending.summary.avgMonthlyCredits.toFixed(2)}\n`;
              accountsContent += `- Estimated total monthly: £${aiSpending.summary.estimatedTotal.toFixed(2)}\n`;
              
              // Check for high spending
              const totalThisMonth = Object.values(aiSpending.currentMonthCredits).reduce((a, b) => a + b, 0);
              if (totalThisMonth > AI_SPENDING_ALERT_THRESHOLD) {
                accountsContent += `\n⚠️ **HIGH SPENDING ALERT**: £${totalThisMonth.toFixed(2)} in credits this month!`;
              }
            }
          }
        } catch (accountsError) {
          console.error("[Notion] Accounts failed:", accountsError);
          accountsContent = "Notion connection issue - couldn't check the accounts.";
        }
      }

      // Check for calendar queries
      let calendarContent = "";
      const calendarTriggers = [
        /calendar/i,
        /cognito\s*calendar/i,
        /what('s| is)\s+(on|in)\s+(my\s+|our\s+|the\s+)?(calendar|schedule)/i,
        /schedule\s+(a\s+|an\s+)?(meeting|call|event)/i,
        /add\s+(to\s+)?(the\s+)?calendar/i,
        /create\s+(a\s+|an\s+)?(calendar\s+)?(event|meeting|appointment)/i,
        /upcoming\s+(events?|meetings?)/i,
        /what('s| is)\s+(happening|scheduled)/i,
        /free\s+(time|slot)/i,
        /book\s+(a\s+|an\s+)?(time|meeting|call)/i,
        /when\s+(am\s+I|are\s+we)\s+(free|busy|available)/i,
        /what('s| is)\s+on\s+(the\s+)?(\d{1,2}(st|nd|rd|th)?|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)/i,
        /what('s| is)\s+on\s+\w+\s+\d{1,2}/i,
        /what\s+do\s+(I|we)\s+have\s+on/i,
        /(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}/i,
        /\d{1,2}(st|nd|rd|th)?\s+(of\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)/i,
      ];
      
      // Check for calendar write requests
      const calendarWriteTriggers = [
        /schedule\s+(a\s+|an\s+)?(meeting|call|event|appointment)/i,
        /add\s+(to\s+)?(the\s+)?calendar/i,
        /create\s+(a\s+|an\s+)?(calendar\s+)?(event|meeting|appointment)/i,
        /book\s+(a\s+|an\s+)?(time|meeting|call)/i,
        /put\s+(it\s+)?(on|in)\s+(the\s+)?calendar/i,
      ];
      
      const needsCalendar = calendarTriggers.some(trigger => trigger.test(content));
      const needsCalendarWrite = calendarWriteTriggers.some(trigger => trigger.test(content));
      
      if (needsCalendar) {
        try {
          const { getUpcomingEvents, formatEventsForDisplay, listCalendars } = await import('./calendar-client');
          
          // First make sure we can find the calendar
          const calendars = await listCalendars();
          const cognitoCal = calendars.find(c => c.name.toLowerCase().includes('cognito'));
          
          if (!cognitoCal) {
            calendarContent = `## Calendar\nCouldn't find Cognito Coding Calendar. Available calendars: ${calendars.map(c => c.name).join(', ')}`;
          } else {
            const events = await getUpcomingEvents(14);
            calendarContent = `## Cognito Coding Calendar\n${formatEventsForDisplay(events)}\n\n[Calendar: ${cognitoCal.name}]`;
            
            if (needsCalendarWrite) {
              calendarContent += `\n\n**To add an event, I need:** title, date/time (and optionally: end time, location, description). Just tell me the details!`;
            }
          }
        } catch (calendarError) {
          console.error("[Calendar] Failed:", calendarError);
          calendarContent = "Calendar connection issue - couldn't check events.";
        }
      }

      // Check for email/Gmail queries
      let emailContent = "";
      const emailTriggers = [
        /check\s+(my\s+|your\s+)?emails?/i,
        /check\s+(your\s+)?inbox/i,
        /what('s| is) in\s+(my\s+|your\s+)?inbox/i,
        /any\s+(new\s+)?emails?/i,
        /unread\s+emails?/i,
        /email\s+summary/i,
        /subscription\s+emails?/i,
        /newsletter(s)?/i,
        /what\s+did\s+I\s+(get|receive)/i,
        /did\s+(he|she|they)\s+reply/i,
        /any\s+replies?/i,
        /got\s+a\s+reply/i,
        /receive\s+(a\s+)?reply/i,
        /hear\s+back/i,
        /response\s+from/i,
      ];
      
      const needsEmail = emailTriggers.some(trigger => trigger.test(content));
      
      if (needsEmail) {
        try {
          const unreadCount = await getUnreadCount();
          const recentEmails = await getRecentEmails(10);
          
          if (recentEmails.length > 0) {
            emailContent = `## Nova's Inbox (novaspire@cognitocoding.com)\nThis is YOUR email account, Nova. You have ${unreadCount} unread emails.\n\n**CRITICAL: These are your ONLY emails. Do NOT invent, fabricate, or make up any other emails. Only report what's listed here.**\n\nRecent emails:\n`;
            
            const emailsNeedingReply: string[] = [];
            
            for (const email of recentEmails.slice(0, 8)) {
              const unreadMark = email.isUnread ? "[UNREAD] " : "";
              const fromName = email.from.split('<')[0].trim();
              const fromEmail = email.from.match(/<(.+)>/)?.[1] || email.from;
              
              // Detect emails that likely need a reply
              const isAutoReply = /noreply|no-reply|donotreply|automated|notification/i.test(fromEmail);
              const isNewsletter = email.labels.some(l => /promotions|updates|social/i.test(l));
              const isPersonal = !isAutoReply && !isNewsletter;
              const hasQuestion = /\?/.test(email.snippet);
              const needsReply = isPersonal && (hasQuestion || email.isUnread);
              
              const replyFlag = needsReply ? " [MIGHT NEED REPLY]" : "";
              if (needsReply) {
                emailsNeedingReply.push(`${email.subject} from ${fromName}`);
              }
              
              emailContent += `- ${unreadMark}**${email.subject}** from ${fromName}${replyFlag}\n  "${email.snippet.slice(0, 150)}..."\n`;
            }
            
            if (emailsNeedingReply.length > 0) {
              emailContent += `\n**Emails that might need a reply:**\n`;
              for (const e of emailsNeedingReply) {
                emailContent += `- ${e}\n`;
              }
              emailContent += `\nYou can read the full content of any email and help Zero draft a reply. Ask which one to look at.`;
            }
          } else {
            emailContent = "## Nova's Inbox\nNo recent emails found. Do NOT make up fake emails - your inbox is empty.";
          }
        } catch (emailError) {
          console.error("[Gmail] Failed:", emailError);
          emailContent = "Gmail connection issue - couldn't check emails.";
        }
      }
      
      // Check for reading a specific email
      const readEmailPatterns = [
        /(?:read|show|open|what('s| does| did))\s+(?:the\s+)?(?:email|message)\s+(?:from|about)\s+["']?(.+?)["']?$/i,
        /(?:what did|what's)\s+(.+?)\s+(?:say|send|write)/i,
      ];
      
      for (const pattern of readEmailPatterns) {
        const match = content.match(pattern);
        if (match && !needsEmail) {
          const searchTerm = match[1] || match[2];
          if (searchTerm && searchTerm.length > 2) {
            try {
              const foundEmails = await searchEmails(searchTerm, 3);
              if (foundEmails.length > 0) {
                const detail = await getEmailDetail(foundEmails[0].id);
                if (detail) {
                  emailContent = `## Email from ${detail.from}\n**Subject:** ${detail.subject}\n**Date:** ${detail.date}\n\n${detail.body.slice(0, 2000)}`;
                  if (detail.body.length > 2000) {
                    emailContent += "\n\n[Email truncated - it's quite long]";
                  }
                  emailContent += `\n\n**You can reply to this email.** If Zero wants to respond, draft the reply.`;
                }
              }
            } catch (searchError) {
              console.error("[Gmail] Email search failed:", searchError);
            }
          }
          break;
        }
      }

      // Check for email SEND requests
      let emailSendResult = "";
      const sendEmailPatterns = [
        /send\s+(?:an?\s+)?email\s+to\s+([^\s]+@[^\s]+)\s+(?:about|saying|with\s+subject|subject)?\s*[:\s]?\s*(.+)/i,
        /email\s+([^\s]+@[^\s]+)\s+(?:about|saying|with\s+subject|subject)?\s*[:\s]?\s*(.+)/i,
        /send\s+(?:an?\s+)?email\s+to\s+([^\s]+@[^\s]+)/i,
      ];

      let emailSendRequest: { to: string; subject?: string; body?: string } | null = null;
      
      for (const pattern of sendEmailPatterns) {
        const match = content.match(pattern);
        if (match) {
          emailSendRequest = {
            to: match[1],
            subject: match[2] || undefined,
            body: match[2] || undefined
          };
          break;
        }
      }

      // If user wants to send email, Nova will draft and send it
      if (emailSendRequest) {
        emailSendResult = `USER_WANTS_TO_SEND_EMAIL_TO: ${emailSendRequest.to}`;
        if (emailSendRequest.subject) {
          emailSendResult += `\nTOPIC: ${emailSendRequest.subject}`;
        }
        emailSendResult += `\n\nYou can send emails as Nova from novaspire@cognitocoding.com. When the user confirms the email content, use the format:\n[SEND_EMAIL]\nTO: email@example.com\nSUBJECT: Subject line\nBODY: Email body content\n[/SEND_EMAIL]`;
      }

      // Check for Notion WRITE commands (task updates, additions)
      let notionWriteResult = "";
      
      // Patterns for updating grind tracker tasks
      const markDonePatterns = [
        /mark\s+(?:the\s+)?["']?(.+?)["']?\s+(?:as\s+)?(done|complete|completed|finished)/i,
        /(?:the\s+)?["']?(.+?)["']?\s+is\s+(done|complete|completed|finished)/i,
        /(?:i|we)\s+(?:have\s+)?(?:just\s+)?(?:finished|completed|done)\s+(?:the\s+)?["']?(.+?)["']?/i,
      ];
      
      const updateStatusPatterns = [
        /(?:update|change|set)\s+(?:the\s+)?["']?(.+?)["']?\s+(?:status\s+)?to\s+["']?(.+?)["']?/i,
        /(?:move|put)\s+(?:the\s+)?["']?(.+?)["']?\s+to\s+["']?(.+?)["']?/i,
      ];
      
      const addTaskPatterns = [
        /add\s+["']?(.+?)["']?\s+to\s+(?:the\s+)?(?:grind\s*)?tracker/i,
        /(?:create|new)\s+(?:grind\s+)?task[:\s]+["']?(.+?)["']?/i,
      ];
      
      const addSocialMediaPatterns = [
        /add\s+["']?(.+?)["']?\s+to\s+(?:the\s+)?social\s*media/i,
        /schedule\s+(?:a\s+)?["']?(.+?)["']?\s+(?:for|on)\s+(?:the\s+)?(\d{4}-\d{2}-\d{2}|\w+\s+\d+)/i,
      ];
      
      // Accounts write patterns
      const addSubscriptionPatterns = [
        /add\s+(?:a\s+)?subscription\s+(?:for\s+)?["']?(.+?)["']?\s+(?:at\s+|for\s+)?£?([\d.]+)\s*(?:per\s+)?(monthly|yearly|weekly|quarterly)?/i,
        /track\s+(?:a\s+)?subscription\s+(?:for\s+)?["']?(.+?)["']?\s+(?:at\s+|for\s+)?£?([\d.]+)/i,
        /new\s+subscription[:\s]+["']?(.+?)["']?\s+(?:at\s+|for\s+)?£?([\d.]+)/i,
      ];
      
      const addIncomePatterns = [
        /(?:add|log|record)\s+(?:an?\s+)?income\s+(?:of\s+)?£?([\d.]+)\s+(?:from\s+)?["']?(.+?)["']?/i,
        /(?:we|i)\s+(?:got|received|earned)\s+£?([\d.]+)\s+(?:from\s+)?["']?(.+?)["']?/i,
        /["']?(.+?)["']?\s+paid\s+(?:us\s+)?£?([\d.]+)/i,
      ];
      
      const addExpensePatterns = [
        /(?:add|log|record)\s+(?:an?\s+)?expense\s+(?:of\s+)?£?([\d.]+)\s+(?:for\s+)?["']?(.+?)["']?/i,
        /(?:we|i)\s+(?:spent|paid)\s+£?([\d.]+)\s+(?:on|for)\s+["']?(.+?)["']?/i,
        /["']?(.+?)["']?\s+cost\s+(?:us\s+)?£?([\d.]+)/i,
      ];
      
      // Replit receipt detection - forwarded emails
      // Matches if "receipt from replit" or "replit receipt" is present
      const isReplitReceipt = /(?:receipt\s+from\s+replit|replit\s+receipt|your\s+replit\s+receipt)/i.test(content);
      // Extract dollar amount like $60.55
      const replitAmountMatch = content.match(/\$(\d+\.\d+)/);
      
      // Check for mark as done
      for (const pattern of markDonePatterns) {
        const match = content.match(pattern);
        if (match) {
          const taskTitle = match[1] || match[2];
          if (taskTitle && taskTitle.length > 2) {
            const result = await updateGrindTaskStatus(taskTitle, 'Done');
            notionWriteResult = result.message;
            break;
          }
        }
      }
      
      // Check for status update
      if (!notionWriteResult) {
        for (const pattern of updateStatusPatterns) {
          const match = content.match(pattern);
          if (match) {
            const taskTitle = match[1];
            const newStatus = match[2];
            if (taskTitle && newStatus && taskTitle.length > 2) {
              const result = await updateGrindTaskStatus(taskTitle, newStatus);
              notionWriteResult = result.message;
              break;
            }
          }
        }
      }
      
      // Check for add task
      if (!notionWriteResult) {
        for (const pattern of addTaskPatterns) {
          const match = content.match(pattern);
          if (match) {
            const taskTitle = match[1];
            if (taskTitle && taskTitle.length > 2) {
              const result = await addGrindTask(taskTitle);
              notionWriteResult = result.message;
              break;
            }
          }
        }
      }
      
      // Check for add subscription
      if (!notionWriteResult) {
        for (const pattern of addSubscriptionPatterns) {
          const match = content.match(pattern);
          if (match) {
            const name = match[1];
            const amount = parseFloat(match[2]);
            const frequency = match[3] || 'monthly';
            if (name && !isNaN(amount)) {
              const today = new Date().getDate().toString();
              const result = await addSubscription(name, amount, frequency, today);
              notionWriteResult = result.message;
              break;
            }
          }
        }
      }
      
      // Check for Replit receipt (forwarded email)
      if (!notionWriteResult && isReplitReceipt && replitAmountMatch) {
        const amount = parseFloat(replitAmountMatch[1]);
        if (!isNaN(amount)) {
          const today = new Date().toISOString().split('T')[0];
          const result = await addExpense('Replit credits', amount, today);
          notionWriteResult = result.message;
        }
      }
      
      // Check for add income
      if (!notionWriteResult) {
        for (const pattern of addIncomePatterns) {
          const match = content.match(pattern);
          if (match) {
            // Handle different match group orders
            let amount: number, description: string;
            if (match[1].match(/^\d/)) {
              amount = parseFloat(match[1]);
              description = match[2];
            } else {
              description = match[1];
              amount = parseFloat(match[2]);
            }
            if (description && !isNaN(amount)) {
              const today = new Date().toISOString().split('T')[0];
              const result = await addIncome(description, amount, today);
              notionWriteResult = result.message;
              break;
            }
          }
        }
      }
      
      // Check for add expense
      if (!notionWriteResult) {
        for (const pattern of addExpensePatterns) {
          const match = content.match(pattern);
          if (match) {
            let amount: number, description: string;
            if (match[1].match(/^\d/)) {
              amount = parseFloat(match[1]);
              description = match[2];
            } else {
              description = match[1];
              amount = parseFloat(match[2]);
            }
            if (description && !isNaN(amount)) {
              const today = new Date().toISOString().split('T')[0];
              const result = await addExpense(description, amount, today);
              notionWriteResult = result.message;
              break;
            }
          }
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
      
      if (documentContent) {
        systemPrompt += `\n\n${documentContent}\n\n**CRITICAL: ONLY mention the pages/databases listed above. Do NOT invent, fabricate, or make up any other page names. If a page is not in this list, say you couldn't find it.**`;
      }
      
      if (databaseQueryContent) {
        systemPrompt += `\n\n${databaseQueryContent}`;
      }
      
      if (socialMediaContent) {
        systemPrompt += `\n\n${socialMediaContent}`;
      }
      
      if (accountsContent) {
        systemPrompt += `\n\n${accountsContent}`;
      }
      
      if (notionWriteResult) {
        systemPrompt += `\n\n## Notion Update Result\n${notionWriteResult}\n\nAcknowledge this update naturally in your response.`;
      }
      
      if (emailContent) {
        systemPrompt += `\n\n${emailContent}`;
      }
      
      if (emailSendResult) {
        systemPrompt += `\n\n## Email Send Request\n${emailSendResult}`;
      }
      
      if (calendarContent) {
        systemPrompt += `\n\n${calendarContent}`;
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

      // Check if Nova wants to send an email (parse [SEND_EMAIL] blocks)
      const emailBlockMatch = fullResponse.match(/\[SEND_EMAIL\]([\s\S]+?)\[\/SEND_EMAIL\]/i);
      if (emailBlockMatch) {
        const emailBlock = emailBlockMatch[1];
        
        // Extract TO, SUBJECT, BODY from the block
        const toMatch = emailBlock.match(/TO:\s*(.+?)(?:\n|SUBJECT:)/i);
        const subjectMatch = emailBlock.match(/SUBJECT:\s*(.+?)(?:\n|BODY:)/i);
        const bodyMatch = emailBlock.match(/BODY:\s*([\s\S]+?)$/i);
        
        if (toMatch && subjectMatch && bodyMatch) {
          const emailTo = toMatch[1].trim();
          const emailSubject = subjectMatch[1].trim();
          const emailBody = bodyMatch[1].trim();
          
          try {
            const result = await sendEmail(emailTo, emailSubject, emailBody);
            if (!result.success) {
              console.error("[Gmail] Email send failed:", result.error);
            }
          } catch (emailError) {
            console.error("[Gmail] Email send error:", emailError);
          }
        } else {
          console.error("[Gmail] Could not parse email block - missing TO/SUBJECT/BODY");
        }
      }

      // Check if Nova wants to mark all emails as read
      if (fullResponse.includes('[MARK_ALL_READ]')) {
        try {
          const { markAllAsRead } = await import('./gmail-client');
          await markAllAsRead();
        } catch (markError) {
          console.error("[Gmail] Mark as read error:", markError);
        }
      }

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
      const truncatedText = text.slice(0, MAX_TTS_LENGTH);

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

  // Test Discord endpoint
  app.post("/api/test-discord", async (req: Request, res: Response) => {
    try {
      const { sendProactiveMessage } = await import('./discord-bot');
      const zeroId = process.env.ZERO_DISCORD_ID;
      if (!zeroId) {
        return res.status(400).json({ error: "ZERO_DISCORD_ID not configured" });
      }
      const success = await sendProactiveMessage(zeroId, "Hey! Just testing the connection. Everything's working on my end. 💙");
      res.json({ success, message: success ? "Message sent!" : "Failed to send" });
    } catch (error) {
      console.error("Test Discord error:", error);
      res.status(500).json({ error: "Failed to send test message" });
    }
  });

  // Gmail endpoints
  app.get("/api/gmail/status", async (req: Request, res: Response) => {
    try {
      const configured = isConfigured();
      const authorized = isAuthorized();
      
      if (!configured) {
        return res.json({ connected: false, reason: 'not_configured' });
      }
      
      if (!authorized) {
        return res.json({ connected: false, reason: 'not_authorized', authUrl: getAuthUrl() });
      }
      
      const connected = await testGmailConnection();
      res.json({ connected, reason: connected ? 'connected' : 'connection_failed' });
    } catch (error: any) {
      res.json({ connected: false, reason: 'error', error: error.message });
    }
  });

  app.get("/api/gmail/oauth/authorize", (req: Request, res: Response) => {
    try {
      const authUrl = getAuthUrl();
      res.redirect(authUrl);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to generate auth URL" });
    }
  });

  app.get("/api/gmail/oauth/callback", async (req: Request, res: Response) => {
    try {
      const code = req.query.code as string;
      if (!code) {
        return res.status(400).send("Missing authorization code");
      }
      
      const tokens = await exchangeCodeForTokens(code);
      
      res.send(`
        <html>
          <head><title>Gmail Authorization Complete</title></head>
          <body style="font-family: sans-serif; padding: 40px; text-align: center;">
            <h1>Gmail Authorization Successful!</h1>
            <p>Copy this refresh token and add it as a secret called <code>GMAIL_REFRESH_TOKEN</code>:</p>
            <textarea readonly style="width: 100%; height: 100px; font-family: monospace; padding: 10px;">${tokens.refreshToken}</textarea>
            <p style="margin-top: 20px;">After adding the secret, restart the application.</p>
          </body>
        </html>
      `);
    } catch (error: any) {
      console.error("Gmail OAuth callback error:", error);
      res.status(500).send(`Authorization failed: ${error.message}`);
    }
  });

  app.get("/api/gmail/emails", async (req: Request, res: Response) => {
    try {
      const maxResults = parseInt(req.query.maxResults as string) || 20;
      const query = req.query.q as string;
      const emails = await getRecentEmails(maxResults, query);
      res.json(emails);
    } catch (error: any) {
      console.error("Gmail fetch error:", error);
      res.status(500).json({ error: error.message || "Failed to fetch emails" });
    }
  });

  app.get("/api/gmail/emails/:id", async (req: Request, res: Response) => {
    try {
      const email = await getEmailDetail(req.params.id);
      if (!email) {
        return res.status(404).json({ error: "Email not found" });
      }
      res.json(email);
    } catch (error: any) {
      console.error("Gmail detail error:", error);
      res.status(500).json({ error: error.message || "Failed to fetch email" });
    }
  });

  app.get("/api/gmail/subscriptions", async (req: Request, res: Response) => {
    try {
      const hours = parseInt(req.query.hours as string) || 24;
      const emails = await getSubscriptionEmails(hours);
      res.json(emails);
    } catch (error: any) {
      console.error("Gmail subscriptions error:", error);
      res.status(500).json({ error: error.message || "Failed to fetch subscriptions" });
    }
  });

  app.get("/api/gmail/unread", async (req: Request, res: Response) => {
    try {
      const count = await getUnreadCount();
      res.json({ count });
    } catch (error: any) {
      console.error("Gmail unread error:", error);
      res.status(500).json({ error: error.message || "Failed to get unread count" });
    }
  });

  // Notion accounts test endpoint
  app.get("/api/notion/accounts", async (req: Request, res: Response) => {
    try {
      const summary = await getAccountsSummary();
      res.json({ success: true, data: summary });
    } catch (error: any) {
      console.error("Accounts fetch error:", error);
      res.status(500).json({ error: error.message || "Failed to get accounts" });
    }
  });

  // AI tools spending endpoint
  app.get("/api/notion/ai-tools", async (req: Request, res: Response) => {
    try {
      const { getAIToolsSpending } = await import('./notion-client');
      const spending = await getAIToolsSpending();
      res.json({ success: true, data: spending });
    } catch (error: any) {
      console.error("AI tools fetch error:", error);
      res.status(500).json({ error: error.message || "Failed to get AI tools spending" });
    }
  });

  app.post("/api/gmail/send", async (req: Request, res: Response) => {
    try {
      const { to, subject, body, isHtml } = req.body;
      if (!to || !subject || !body) {
        return res.status(400).json({ error: "to, subject, and body are required" });
      }
      
      const result = await sendEmail(to, subject, body, isHtml || false);
      if (result.success) {
        res.json({ success: true, messageId: result.messageId });
      } else {
        res.status(500).json({ success: false, error: result.error });
      }
    } catch (error: any) {
      console.error("Gmail send error:", error);
      res.status(500).json({ error: error.message || "Failed to send email" });
    }
  });

  // Calendar endpoints
  app.get("/api/calendar/events", async (req: Request, res: Response) => {
    try {
      const { getUpcomingEvents } = await import('./calendar-client');
      const days = parseInt(req.query.days as string) || 14;
      const events = await getUpcomingEvents(days);
      res.json({ success: true, data: events });
    } catch (error: any) {
      console.error("Calendar events error:", error);
      res.status(500).json({ error: error.message || "Failed to get calendar events" });
    }
  });

  app.get("/api/calendar/calendars", async (req: Request, res: Response) => {
    try {
      const { listCalendars } = await import('./calendar-client');
      const calendars = await listCalendars();
      res.json({ success: true, data: calendars });
    } catch (error: any) {
      console.error("List calendars error:", error);
      res.status(500).json({ error: error.message || "Failed to list calendars" });
    }
  });

  app.post("/api/calendar/events", async (req: Request, res: Response) => {
    try {
      const { createEvent } = await import('./calendar-client');
      const { title, startDateTime, endDateTime, description, location, allDay } = req.body;
      
      if (!title || !startDateTime) {
        return res.status(400).json({ error: "title and startDateTime are required" });
      }
      
      const result = await createEvent({
        title,
        startDateTime,
        endDateTime,
        description,
        location,
        allDay
      });
      
      if (result.success) {
        res.json(result);
      } else {
        res.status(500).json(result);
      }
    } catch (error: any) {
      console.error("Create event error:", error);
      res.status(500).json({ error: error.message || "Failed to create event" });
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
            continue;
          }
          
          // Check if similar memory exists in DB
          const existingMem = freshMemories.find(m => 
            simpleHash(m.content) === contentHash ||
            m.content.toLowerCase().includes(mem.content.toLowerCase().slice(0, 40))
          );
          
          if (existingMem) {
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
          }
        }
      }
    }
  } catch (error) {
    console.error("Memory extraction error:", error);
  }
}
