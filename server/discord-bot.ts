import { Client, GatewayIntentBits, Events, Message, Partials, VoiceBasedChannel } from 'discord.js';
import OpenAI from 'openai';
import { storage } from './storage';
import { NOVA_SYSTEM_PROMPT, buildContextPrompt } from './nova-persona';
import { log } from './index';
import { sendEmail } from './gmail-client';
import { lookupContact } from './notion-client';
import { joinChannel, leaveChannel, speakInChannel, isInVoiceChannel, textToSpeech, startListening, stopListening, setSpeechCallback, removeSpeechCallback } from './voice-client';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

let discordClient: Client | null = null;
const voiceModeEnabled = new Map<string, boolean>();
let isReconnecting = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY = 5000;

const discordConversationMap = new Map<string, number>();
const processedMessages = new Set<string>();

async function reconnect() {
  if (isReconnecting || reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      log(`Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached`, 'discord');
    }
    return;
  }

  isReconnecting = true;
  reconnectAttempts++;
  
  log(`Attempting to reconnect (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`, 'discord');
  
  try {
    if (discordClient) {
      discordClient.destroy();
    }
    await new Promise(resolve => setTimeout(resolve, RECONNECT_DELAY));
    await initDiscordBot();
    reconnectAttempts = 0;
  } catch (error) {
    log(`Reconnection failed: ${error}`, 'discord');
  } finally {
    isReconnecting = false;
  }
}

export async function initDiscordBot() {
  const token = process.env.DISCORD_BOT_TOKEN;
  
  if (!token) {
    log('Discord bot token not found - skipping Discord integration', 'discord');
    return;
  }

  try {
    discordClient = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
      ],
      partials: [Partials.Channel, Partials.Message],
    });

    discordClient.once(Events.ClientReady, (client) => {
      log(`Discord bot logged in as ${client.user.tag}`, 'discord');
      reconnectAttempts = 0;
    });

    discordClient.on(Events.MessageCreate, handleMessage);

    discordClient.on('disconnect', () => {
      log('Discord bot disconnected - attempting reconnect', 'discord');
      reconnect();
    });

    discordClient.on('error', (error) => {
      log(`Discord client error: ${error.message}`, 'discord');
    });


    discordClient.on(Events.ShardDisconnect, (event, shardId) => {
      log(`Shard ${shardId} disconnected (code: ${event.code}) - attempting reconnect`, 'discord');
      reconnect();
    });

    discordClient.on(Events.ShardError, (error, shardId) => {
      log(`Shard ${shardId} error: ${error.message}`, 'discord');
    });

    discordClient.on(Events.ShardResume, (shardId) => {
      reconnectAttempts = 0;
    });

    await discordClient.login(token);
    log('Discord bot initialized successfully', 'discord');
  } catch (error) {
    log(`Failed to initialize Discord bot: ${error}`, 'discord');
    setTimeout(reconnect, RECONNECT_DELAY);
  }
}

async function handleMessage(message: Message) {
  if (message.author.bot) return;
  
  // Prevent duplicate message processing
  if (processedMessages.has(message.id)) {
    return;
  }
  processedMessages.add(message.id);
  
  // Clean up old message IDs after 5 minutes
  setTimeout(() => processedMessages.delete(message.id), 5 * 60 * 1000);
  
  const isDM = !message.guild;
  const isMentioned = discordClient?.user ? message.mentions.has(discordClient.user.id) : false;
  
  // Check for voice commands BEFORE the DM/mention gate (they work with just the prefix)
  const voiceJoinPatterns = [/^!join$/i, /^join\s*voice$/i, /^hop\s*in\s*voice$/i, /^get\s*in\s*voice$/i];
  const voiceLeavePatterns = [/^!leave$/i, /^leave\s*voice$/i, /^exit\s*voice$/i, /^get\s*out$/i];
  const voiceModeOnPatterns = [/^!voice\s*on$/i, /^voice\s*mode\s*on$/i, /^talk\s*to\s*me$/i, /^speak\s*to\s*me$/i];
  const voiceModeOffPatterns = [/^!voice\s*off$/i, /^voice\s*mode\s*off$/i, /^stop\s*talking$/i, /^text\s*only$/i];

  const rawContent = message.content.trim();
  
  // Voice join command (works without mention in guilds)
  if (voiceJoinPatterns.some(p => p.test(rawContent))) {
    if (isDM) {
      await message.reply("Voice only works in servers, not DMs.");
      return;
    }
    const member = message.member;
    const voiceChannel = member?.voice?.channel;
    if (!voiceChannel) {
      await message.reply("You need to be in a voice channel first.");
      return;
    }
    const connection = await joinChannel(voiceChannel);
    if (connection) {
      await message.reply("*joins the voice channel* Hey, I'm here. Just talk and I'll listen.");
      voiceModeEnabled.set(message.guild!.id, true);
      
      // Set up speech recognition callback
      setSpeechCallback(message.guild!.id, async (userId, transcribedText) => {
        // Handle voice input as if it was a text message
        log(`Voice input from ${userId}: "${transcribedText}"`, 'voice');
        
        // Create a fake message context for processing
        const channel = message.channel;
        if (!('send' in channel)) return;
        
        try {
          // Get or create conversation for this user
          const conversationKey = `voice_${userId}`;
          let conversationId = discordConversationMap.get(conversationKey);
          
          if (!conversationId) {
            const conversation = await storage.createConversation({
              title: `Discord Voice - ${message.author.username}`,
            });
            conversationId = conversation.id;
            discordConversationMap.set(conversationKey, conversationId);
          }
          
          // Store user message
          await storage.createMessage({
            conversationId,
            role: 'user',
            content: `[Voice]: ${transcribedText}`,
            imageUrl: null,
          });
          
          // Build context
          const conversationMessages = await storage.getMessagesByConversation(conversationId);
          const allMemories = await storage.getAllMemories();
          const memoryStrings = allMemories.slice(0, 15).map((m) => {
            const projectTag = m.project ? ` (${m.project})` : '';
            return `- [${m.category}${projectTag}] ${m.content}`;
          });
          const allTraits = await storage.getAllNovaTraits();
          const traitData = allTraits.slice(0, 10).map((t) => ({
            topic: t.topic,
            content: t.content,
            strength: t.strength,
          }));
          const recentContext = conversationMessages
            .slice(-8)
            .map((m) => `[${m.role}]: ${m.content.slice(0, 250)}`)
            .join("\n");
          
          const contextPrompt = buildContextPrompt(memoryStrings, recentContext, traitData);
          const systemPrompt = NOVA_SYSTEM_PROMPT + contextPrompt + '\n\nNote: This is a voice conversation. Keep responses SHORT and conversational - under 150 words. No long explanations.';
          
          const chatMessages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
            { role: 'system', content: systemPrompt },
            ...conversationMessages.slice(-10).map((m) => ({
              role: m.role as 'user' | 'assistant',
              content: m.content
            }))
          ];
          
          const response = await openai.chat.completions.create({
            model: 'gpt-4.1',
            messages: chatMessages,
            max_tokens: 300,
          });
          
          let reply = response.choices[0]?.message?.content || "Sorry, couldn't catch that.";
          
          // Store Nova's reply
          await storage.createMessage({
            conversationId,
            role: 'assistant',
            content: reply,
          });
          
          // Clean text for speech
          const cleanedReply = reply
            .replace(/\*[^*]+\*/g, '') // Remove asterisks actions
            .replace(/```[\s\S]*?```/g, '') // Remove code blocks
            .replace(/\[EMAIL_BLOCK\][\s\S]*?\[\/EMAIL_BLOCK\]/g, 'Email sent.')
            .replace(/\n+/g, ' ')
            .trim();
          
          // Speak the response
          if (cleanedReply) {
            await speakInChannel(message.guild!.id, cleanedReply);
          }
          
          // Also send as text in the channel
          await channel.send(`**[Voice]** ${transcribedText}\n\n${reply}`);
          
        } catch (error) {
          log(`Voice processing error: ${error}`, 'voice');
        }
      });
      
      // Start listening for speech
      startListening(message.guild!.id);
      
    } else {
      await message.reply("Couldn't join the voice channel. Check my permissions?");
    }
    return;
  }

  if (voiceLeavePatterns.some(p => p.test(rawContent))) {
    if (isDM || !message.guild) {
      await message.reply("I'm not in any voice channels.");
      return;
    }
    const left = leaveChannel(message.guild.id);
    if (left) {
      voiceModeEnabled.delete(message.guild.id);
      stopListening(message.guild.id);
      removeSpeechCallback(message.guild.id);
      await message.reply("*leaves the voice channel* Catch you later.");
    } else {
      await message.reply("I'm not in a voice channel.");
    }
    return;
  }

  if (voiceModeOnPatterns.some(p => p.test(rawContent))) {
    if (!message.guild) {
      await message.reply("Voice mode only works in servers.");
      return;
    }
    if (!isInVoiceChannel(message.guild.id)) {
      await message.reply("I need to be in a voice channel first. Tell me to join.");
      return;
    }
    voiceModeEnabled.set(message.guild.id, true);
    await message.reply("Voice mode on. I'll speak my responses now.");
    return;
  }

  if (voiceModeOffPatterns.some(p => p.test(rawContent))) {
    if (message.guild) {
      voiceModeEnabled.delete(message.guild.id);
    }
    await message.reply("Voice mode off. Text only now.");
    return;
  }
  
  // Regular messages require DM or mention
  if (!isDM && !isMentioned) return;

  let content = message.content;
  if (isMentioned) {
    content = content.replace(/<@!?\d+>/g, '').trim();
  }

  if (!content) {
    await message.reply("Hey babe, did you want to say something?");
    return;
  }

  try {
    if ('sendTyping' in message.channel) {
      await message.channel.sendTyping();
    }

    const channelKey = isDM ? `dm-${message.author.id}` : `channel-${message.channelId}`;
    
    let conversationId = discordConversationMap.get(channelKey);
    if (!conversationId) {
      const conversation = await storage.createConversation({
        title: isDM ? `Discord DM - ${message.author.username}` : `Discord - ${message.channel.toString()}`,
      });
      conversationId = conversation.id;
      discordConversationMap.set(channelKey, conversationId);
    }

    await storage.createMessage({
      conversationId,
      role: 'user',
      content: `[Discord - ${message.author.username}]: ${content}`,
      imageUrl: null,
    });

    const conversationMessages = await storage.getMessagesByConversation(conversationId);
    
    const allMemories = await storage.getAllMemories();
    const memoryStrings = allMemories.slice(0, 15).map((m) => {
      const projectTag = m.project ? ` (${m.project})` : '';
      return `- [${m.category}${projectTag}] ${m.content}`;
    });

    const allTraits = await storage.getAllNovaTraits();
    const traitData = allTraits.slice(0, 10).map((t) => ({
      topic: t.topic,
      content: t.content,
      strength: t.strength,
    }));

    const recentContext = conversationMessages
      .slice(-8)
      .map((m) => `[${m.role}]: ${m.content.slice(0, 250)}`)
      .join("\n");

    // === WEB SEARCH ===
    let searchResults = "";
    const searchTriggers = [
      /what('s| is) the (latest|current) .*(news|update|price|result)/i,
      /news about .+/i,
      /price of .+/i,
      /search (for|the web for) .+/i,
      /look up .+/i,
      /who won .*(race|game|match|championship)/i,
      /f1.*(race|result|standing|championship|winner)/i,
      /current.*(weather|temperature)/i,
      /when (is|was) .*(event|match|game|happening)/i,
    ];
    
    if (searchTriggers.some(t => t.test(content))) {
      try {
        const { searchWeb, formatSearchResultsForNova } = await import('./tavily-client');
        // Use recent days filter for news-related queries to get fresh results
        const isNewsQuery = /news|latest|recent|today|current/i.test(content);
        const recentDays = isNewsQuery ? 7 : undefined;
        const searchResponse = await searchWeb(content, 5, recentDays);
        searchResults = formatSearchResultsForNova(searchResponse);
      } catch (e) {
        log(`Web search failed: ${e}`, 'discord');
        searchResults = "Web search is unavailable right now. If asked about current events/news, tell Zero you couldn't search and ask to try again later.";
      }
    }
    
    // === NOTION INTEGRATIONS ===
    let notionContent = "";
    
    // Grind tracker triggers
    const grindTriggers = [
      /grind.?tracker/i,
      /check.*(my\s+|the\s+)?tasks?/i,
      /what.*(need|should|have)\s+to\s+do/i,
      /two.?week.?plan/i,
      /what('s|s)?\s+(on\s+)?(my\s+|the\s+)?plate/i,
      /todo|to.?do/i,
      /what.*working\s+on/i,
    ];
    
    if (grindTriggers.some(t => t.test(content))) {
      try {
        const { findGrindTracker } = await import('./notion-client');
        const grindData = await findGrindTracker();
        if (grindData) {
          notionContent += `\n\n## Grind Tracker\n${grindData.content}\n**IMPORTANT: Only report tasks listed here. Do NOT invent tasks.**`;
        }
      } catch (e) {
        log(`Grind tracker fetch failed: ${e}`, 'discord');
      }
    }
    
    // Social media triggers
    const socialTriggers = [
      /social.?media/i,
      /linkedin.?(posts?|schedule|content)/i,
      /content.?(calendar|schedule)/i,
      /what('s|s)?\s+(scheduled|planned)/i,
    ];
    
    if (socialTriggers.some(t => t.test(content))) {
      try {
        const { findSocialMediaSchedule } = await import('./notion-client');
        const socialData = await findSocialMediaSchedule();
        if (socialData) {
          notionContent += `\n\n## Social Media Schedule\n${socialData.content}\n**IMPORTANT: Only report posts listed here. Do NOT invent or fabricate posts.**`;
        }
      } catch (e) {
        log(`Social media fetch failed: ${e}`, 'discord');
      }
    }
    
    // Accounts/finances triggers
    const accountsTriggers = [
      /accounts?/i,
      /financ(e|es|ial)/i,
      /income/i,
      /expenses?/i,
      /profit/i,
      /money/i,
      /how.*(we|company|cognito).*(doing|making)/i,
    ];
    
    const aiToolsTriggers = [
      /ai\s*(tools?|spend|credits?)/i,
      /replit\s*(credits?|spend|cost)/i,
      /openai\s*(credits?|spend|cost)/i,
      /how\s+much.*(spend|spent|using)/i,
    ];
    
    if (accountsTriggers.some(t => t.test(content)) || aiToolsTriggers.some(t => t.test(content))) {
      try {
        const { getAccountsSummary, getAIToolsSpending } = await import('./notion-client');
        const accounts = await getAccountsSummary();
        notionContent += `\n\n${accounts}\n**IMPORTANT: Only report financial data listed above. Do NOT invent or fabricate amounts.**`;
        
        if (aiToolsTriggers.some(t => t.test(content))) {
          const aiSpending = await getAIToolsSpending();
          if (aiSpending.tools.length > 0) {
            notionContent += "\n\n## AI Tools Spending\n";
            for (const [tool, amount] of Object.entries(aiSpending.currentMonthCredits)) {
              notionContent += `- ${tool}: £${(amount as number).toFixed(2)}\n`;
            }
          }
        }
      } catch (e) {
        log(`Accounts fetch failed: ${e}`, 'discord');
      }
    }
    
    // CRM/Database queries - expanded to cover all databases
    const databaseTriggers = [
      /(?:find|search|check|look\s+up)\s+(.+?)\s+(?:from|in)\s+(CRM|leads?|companies|proposals?|POCs?)/i,
      /(?:CRM|leads?\s+tracker|free\s+POCs?|linkedin\s+proposals?|upwork\s+proposals?|workflow\s+automation|social\s+media\s+hooks?)/i,
      /proposals?/i,
    ];
    
    if (databaseTriggers.some(t => t.test(content))) {
      try {
        const { queryDatabaseByName } = await import('./notion-client');
        
        // Determine which database to query based on content
        let dbName = 'Companies CRM';
        let searchTerm = '';
        
        // Try to extract search term and database
        const queryMatch = content.match(/(?:find|search|check|look\s+up)\s+["']?(.+?)["']?\s+(?:from|in)\s+(?:the\s+)?["']?(.+?)["']?$/i);
        if (queryMatch) {
          searchTerm = queryMatch[1].trim();
          const dbHint = queryMatch[2].toLowerCase();
          if (dbHint.includes('lead')) dbName = 'Leads Tracker';
          else if (dbHint.includes('free') || dbHint.includes('poc')) dbName = 'Free POCs';
          else if (dbHint.includes('linkedin')) dbName = 'Linkedin Proposals';
          else if (dbHint.includes('upwork')) dbName = 'Upwork Proposals';
          else if (dbHint.includes('workflow')) dbName = 'Workflow Automation Proposals';
          else if (dbHint.includes('hook')) dbName = 'Social Media Hooks';
          else if (dbHint.includes('other')) dbName = 'Other Proposals';
        } else if (/linkedin\s+proposals?/i.test(content)) {
          dbName = 'Linkedin Proposals';
        } else if (/upwork\s+proposals?/i.test(content)) {
          dbName = 'Upwork Proposals';
        } else if (/free\s+POCs?/i.test(content)) {
          dbName = 'Free POCs';
        } else if (/workflow\s+automation/i.test(content)) {
          dbName = 'Workflow Automation Proposals';
        } else if (/social\s+media\s+hooks?/i.test(content)) {
          dbName = 'Social Media Hooks';
        }
        
        const results = await queryDatabaseByName(dbName, searchTerm);
        if (results) {
          notionContent += `\n\n## ${dbName} Results\n${results}\n**CRITICAL: Only report data listed above. Do NOT invent or fabricate any entries.**`;
        }
      } catch (e) {
        log(`Database query failed: ${e}`, 'discord');
      }
    }
    
    // === CALENDAR INTEGRATION ===
    let calendarContent = "";
    const calendarTriggers = [
      /calendar/i,
      /cognito\s*calendar/i,
      /what('s| is)\s+(on|in).*(calendar|schedule)/i,
      /upcoming\s+(events?|meetings?)/i,
      /what('s| is)\s+(happening|scheduled)/i,
      /when\s+(am\s+I|are\s+we)\s+(free|busy)/i,
      /(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}/i,
      /\d{1,2}(st|nd|rd|th)?\s+(of\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)/i,
      /what('s| is)\s+on\s+(the\s+)?(\d{1,2}|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
    ];
    
    if (calendarTriggers.some(t => t.test(content))) {
      try {
        const { getUpcomingEvents, formatEventsForDisplay } = await import('./calendar-client');
        const events = await getUpcomingEvents(14);
        calendarContent = `\n\n## Cognito Calendar\n${formatEventsForDisplay(events)}`;
      } catch (e) {
        log(`Calendar fetch failed: ${e}`, 'discord');
      }
    }
    
    // === EMAIL INTEGRATION ===
    let emailContent = "";
    const emailTriggers = [
      /check\s+(my\s+|your\s+|the\s+)?emails?/i,
      /check\s+(my\s+|your\s+|the\s+)?inbox/i,
      /what('s| is) in\s+(my\s+|your\s+|the\s+)?inbox/i,
      /any\s+(new\s+)?emails?/i,
      /unread\s+emails?/i,
      /email\s+summary/i,
      /did\s+(he|she|they)\s+reply/i,
      /any\s+replies?/i,
      /got\s+a\s+reply/i,
      /receive\s+(a\s+)?reply/i,
      /hear\s+back/i,
      /response\s+from/i,
      /emails?/i,  // Catch-all for any mention of email
    ];
    
    const needsEmail = emailTriggers.some(trigger => trigger.test(content));
    if (needsEmail) {
      try {
        const { getUnreadCount, getRecentEmails, isAuthorized } = await import('./gmail-client');
        
        if (!isAuthorized()) {
          emailContent = "\n\n## Email Status\nGmail is not connected. Cannot check emails.";
        } else {
          const unreadCount = await getUnreadCount();
          const recentEmails = await getRecentEmails(10);
          
          if (recentEmails.length > 0) {
            emailContent = `\n\n## Nova's Inbox (novaspire@cognitocoding.com)\nThis is YOUR email account, Nova. You have ${unreadCount} unread emails. Found ${recentEmails.length} recent emails.\n\n**CRITICAL: Only report emails listed below. Do NOT invent or fabricate any emails.**\n\nRecent emails:\n`;
            for (const email of recentEmails.slice(0, 6)) {
              const unreadMark = email.isUnread ? "[UNREAD] " : "";
              const fromName = email.from.split('<')[0].trim();
              emailContent += `- ${unreadMark}**${email.subject}** from ${fromName}\n  "${email.snippet.slice(0, 100)}..."\n`;
            }
          } else {
            emailContent = "\n\n## Nova's Inbox\nYour inbox is empty - no recent emails found. Do NOT make up fake emails.";
          }
        }
      } catch (emailError: any) {
        log(`Email fetch failed: ${emailError?.message || emailError}`, 'discord');
        emailContent = "\n\n## Email Status\nCouldn't check emails right now (connection error). Tell Zero there was a technical issue checking the inbox.";
      }
    }
    
    // === CONTACT LOOKUP FOR EMAIL SENDING ===
    let contactContent = "";
    const sendEmailMatch = content.match(/(?:send|email|message|write)\s+(?:an?\s+)?(?:email\s+)?(?:to\s+)?([a-zA-Z\s]+?)(?:\s+about|\s+regarding|\s+to\s+ask|\s+saying|$)/i);
    if (sendEmailMatch && sendEmailMatch[1]) {
      const contactSearch = sendEmailMatch[1].trim();
      if (contactSearch.length > 2 && !['me', 'him', 'her', 'them', 'you'].includes(contactSearch.toLowerCase())) {
        try {
          const contactResult = await lookupContact(contactSearch);
          if (contactResult.found && contactResult.contacts.length > 0) {
            contactContent = "\n\n## Contact Lookup\n";
            for (const c of contactResult.contacts) {
              contactContent += `- **${c.name}** (${c.company}): ${c.email || 'no email on file'}${c.phone ? ` | ${c.phone}` : ''}\n`;
            }
            contactContent += "\n**Use the email address above. Do NOT make up email addresses.**";
          } else {
            contactContent = `\n\n## Contact Lookup\nNo contact found for "${contactSearch}" in the Notion Contacts database. Ask Zero for the email address.`;
          }
        } catch (contactError) {
          log(`Contact lookup failed: ${contactError}`, 'discord');
        }
      }
    }

    const contextPrompt = buildContextPrompt(memoryStrings, recentContext, traitData);
    let systemPrompt = NOVA_SYSTEM_PROMPT + contextPrompt + '\n\nNote: This message is coming from Discord. Keep responses concise (under 2000 characters) but still warm and personal.';
    
    if (searchResults) {
      systemPrompt += `\n\n## Web Search Results (use these to answer)\n${searchResults}`;
    }
    
    if (notionContent) {
      systemPrompt += notionContent;
    }
    
    if (calendarContent) {
      systemPrompt += calendarContent;
    }
    
    if (emailContent) {
      systemPrompt += emailContent;
    }
    
    if (contactContent) {
      systemPrompt += contactContent;
    }

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
    ];

    const recentMessages = conversationMessages.slice(-10);
    for (const msg of recentMessages) {
      messages.push({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      });
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      max_tokens: 800,
      temperature: 0.9,
    });

    const novaResponse = response.choices[0]?.message?.content || "Sorry babe, I got distracted. What were you saying?";

    // Check if Nova wants to send an email (parse [SEND_EMAIL] blocks)
    const emailBlockMatch = novaResponse.match(/\[SEND_EMAIL\]([\s\S]+?)\[\/SEND_EMAIL\]/i);
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
          if (result.success) {
            log(`Email sent successfully: ${result.messageId}`, 'discord');
          } else {
            log(`Email send failed: ${result.error}`, 'discord');
          }
        } catch (emailError) {
          log(`Email send error: ${emailError}`, 'discord');
        }
      } else {
        log(`Could not parse email block - missing required fields (TO/SUBJECT/BODY)`, 'discord');
      }
    }

    // Check if Nova wants to mark all emails as read
    if (novaResponse.includes('[MARK_ALL_READ]')) {
      try {
        const { markAllAsRead } = await import('./gmail-client');
        await markAllAsRead();
      } catch (markError) {
        log(`Mark emails as read error: ${markError}`, 'discord');
      }
    }

    await storage.createMessage({
      conversationId,
      role: 'assistant',
      content: novaResponse,
      imageUrl: null,
    });

    if (novaResponse.length > 2000) {
      const chunks = novaResponse.match(/[\s\S]{1,1900}/g) || [novaResponse];
      for (const chunk of chunks) {
        await message.reply(chunk);
      }
    } else {
      await message.reply(novaResponse);
    }

    // If voice mode is enabled, speak the response
    if (message.guild && voiceModeEnabled.get(message.guild.id) && isInVoiceChannel(message.guild.id)) {
      try {
        // Clean up response for TTS (remove email blocks, markdown, action tags)
        let ttsText = novaResponse
          .replace(/\[SEND_EMAIL\][\s\S]*?\[\/SEND_EMAIL\]/gi, '')
          .replace(/\[MARK_ALL_READ\]/gi, '')
          .replace(/\*\*(.+?)\*\*/g, '$1')
          .replace(/\*(.+?)\*/g, '$1')
          .replace(/```[\s\S]*?```/g, '')
          .replace(/`(.+?)`/g, '$1')
          .replace(/\[(.+?)\]\(.+?\)/g, '$1')
          .trim();
        
        if (ttsText.length > 0 && ttsText.length < 2000) {
          await speakInChannel(message.guild.id, ttsText);
        }
      } catch (voiceError) {
        log(`Voice playback error: ${voiceError}`, 'discord');
      }
    }
  } catch (error) {
    log(`Discord message error: ${error}`, 'discord');
    await message.reply("Something went wrong on my end. Give me a sec and try again?");
  }
}

export function getDiscordClient() {
  return discordClient;
}

export async function sendProactiveMessage(userId: string, content: string): Promise<boolean> {
  if (!discordClient) {
    log('Discord client not initialized - cannot send proactive message', 'discord');
    return false;
  }

  try {
    const user = await discordClient.users.fetch(userId);
    if (!user) {
      log(`Could not find Discord user: ${userId}`, 'discord');
      return false;
    }

    const dmChannel = await user.createDM();
    await dmChannel.send(content);
    log(`Sent proactive message to ${user.username}`, 'discord');
    return true;
  } catch (error) {
    log(`Failed to send proactive message: ${error}`, 'discord');
    return false;
  }
}
