import { Client, GatewayIntentBits, Events, Message, Partials } from 'discord.js';
import OpenAI from 'openai';
import { storage } from './storage';
import { NOVA_SYSTEM_PROMPT, buildContextPrompt } from './nova-persona';
import { log } from './index';
import { sendEmail } from './gmail-client';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

let discordClient: Client | null = null;
let isReconnecting = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY = 5000;

const discordConversationMap = new Map<string, number>();

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

    discordClient.on('warn', (warning) => {
      log(`Discord warning: ${warning}`, 'discord');
    });

    discordClient.on(Events.ShardDisconnect, (event, shardId) => {
      log(`Shard ${shardId} disconnected (code: ${event.code}) - attempting reconnect`, 'discord');
      reconnect();
    });

    discordClient.on(Events.ShardError, (error, shardId) => {
      log(`Shard ${shardId} error: ${error.message}`, 'discord');
    });

    discordClient.on(Events.ShardReconnecting, (shardId) => {
      log(`Shard ${shardId} reconnecting...`, 'discord');
    });

    discordClient.on(Events.ShardResume, (shardId) => {
      log(`Shard ${shardId} resumed`, 'discord');
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
  
  const isDM = !message.guild;
  const isMentioned = discordClient?.user ? message.mentions.has(discordClient.user.id) : false;
  
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

    const contextPrompt = buildContextPrompt(memoryStrings, recentContext, traitData, 'default');
    const systemPrompt = NOVA_SYSTEM_PROMPT + contextPrompt + '\n\nNote: This message is coming from Discord. Keep responses concise (under 2000 characters) but still warm and personal.';

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
      max_tokens: 500,
    });

    const novaResponse = response.choices[0]?.message?.content || "Sorry babe, I got distracted. What were you saying?";

    // Check if Nova wants to send an email (parse [SEND_EMAIL] blocks)
    const emailBlockMatch = novaResponse.match(/\[SEND_EMAIL\]([\s\S]+?)\[\/SEND_EMAIL\]/i);
    if (emailBlockMatch) {
      const emailBlock = emailBlockMatch[1];
      log(`Found email block`, 'discord');
      
      // Extract TO, SUBJECT, BODY from the block
      const toMatch = emailBlock.match(/TO:\s*(.+?)(?:\n|SUBJECT:)/i);
      const subjectMatch = emailBlock.match(/SUBJECT:\s*(.+?)(?:\n|BODY:)/i);
      const bodyMatch = emailBlock.match(/BODY:\s*([\s\S]+?)$/i);
      
      if (toMatch && subjectMatch && bodyMatch) {
        const emailTo = toMatch[1].trim();
        const emailSubject = subjectMatch[1].trim();
        const emailBody = bodyMatch[1].trim();
        
        log(`Sending email to: ${emailTo}`, 'discord');
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
        log(`Could not parse email block - missing fields`, 'discord');
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
