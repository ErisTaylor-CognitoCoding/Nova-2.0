import { Client, GatewayIntentBits, Events, Message, Partials } from 'discord.js';
import OpenAI from 'openai';
import { storage } from './storage';
import { NOVA_SYSTEM_PROMPT, buildContextPrompt } from './nova-persona';
import { log } from './index';

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

let discordClient: Client | null = null;

const discordConversationMap = new Map<string, number>();

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
    });

    discordClient.on(Events.MessageCreate, handleMessage);

    await discordClient.login(token);
    log('Discord bot initialized successfully', 'discord');
  } catch (error) {
    log(`Failed to initialize Discord bot: ${error}`, 'discord');
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
