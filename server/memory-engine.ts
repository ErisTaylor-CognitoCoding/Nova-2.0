import OpenAI from "openai";
import { storage } from "./storage";
import { MEMORY_EXTRACTION_PROMPT } from "./nova-persona";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || undefined,
});
const LLM_MODEL_MINI = process.env.LLM_MODEL_MINI || 'gpt-4o-mini';

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

const recentMemoryHashes = new Set<string>();
const MAX_RECENT_HASHES = 100;

export async function extractMemories(
  userMessage: string,
  assistantResponse: string,
  sourceMessageId: number,
  source: string = "web"
): Promise<void> {
  try {
    if (userMessage.length < 10 && assistantResponse.length < 50) {
      return;
    }

    const freshMemories = await storage.getAllMemories();

    const conversationContext = `User said: "${userMessage}"\n\nNova responded: "${assistantResponse}"`;

    const existingMemorySummary = freshMemories.length > 0
      ? `\n\nExisting memories (check for updates/duplicates - DO NOT create duplicates):\n${freshMemories.slice(0, 30).map(m => `- [${m.category}] ${m.content}`).join('\n')}`
      : '';

    const response = await openai.chat.completions.create({
      model: LLM_MODEL_MINI,
      messages: [
        { role: "system", content: MEMORY_EXTRACTION_PROMPT + existingMemorySummary },
        { role: "user", content: conversationContext }
      ],
      temperature: 0.2,
      max_tokens: 800,
    });

    const responseText = response.choices[0]?.message?.content || '{}';

    let extracted;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        extracted = JSON.parse(jsonMatch[0]);
      } else {
        return;
      }
    } catch (parseError) {
      console.error(`[Memory:${source}] Failed to parse extraction response:`, parseError);
      return;
    }

    if (extracted.newMemories && Array.isArray(extracted.newMemories)) {
      const memoriesToAdd = extracted.newMemories.slice(0, 3);

      for (const mem of memoriesToAdd) {
        if (mem.category && mem.content && mem.importance >= 5) {
          const contentHash = simpleHash(mem.content);

          if (recentMemoryHashes.has(contentHash)) {
            continue;
          }

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

          recentMemoryHashes.add(contentHash);
          if (recentMemoryHashes.size > MAX_RECENT_HASHES) {
            const first = recentMemoryHashes.values().next().value;
            if (first) recentMemoryHashes.delete(first);
          }
        }
      }
    }

    if (extracted.updateMemories && Array.isArray(extracted.updateMemories)) {
      for (const update of extracted.updateMemories.slice(0, 2)) {
        if (update.existingContent && update.newContent) {
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
    console.error(`[Memory:${source}] Extraction error:`, error);
  }
}

export function getRelevantMemories(
  allMemories: { id: number; category: string; content: string; importance: number; project: string | null; createdAt: Date }[],
  userMessage: string,
  limit: number = 20
): typeof allMemories {
  const messageLower = userMessage.toLowerCase();
  const words = messageLower.split(/\s+/).filter(w => w.length > 3);

  const scored = allMemories.map(m => {
    let score = 0;

    if (m.importance >= 8) score += 30;
    else if (m.importance >= 6) score += 15;
    else score += m.importance;

    const contentLower = m.content.toLowerCase();
    for (const word of words) {
      if (contentLower.includes(word)) {
        score += 10;
      }
    }

    if (messageLower.includes('work') || messageLower.includes('cognito') || messageLower.includes('business')) {
      if (m.category === 'business') score += 8;
    }
    if (messageLower.includes('feel') || messageLower.includes('stress') || messageLower.includes('tired') || messageLower.includes('happy')) {
      if (m.category === 'feeling') score += 8;
    }
    if (m.project) {
      if (messageLower.includes(m.project.toLowerCase())) {
        score += 15;
      }
    }

    const ageHours = (Date.now() - new Date(m.createdAt).getTime()) / (1000 * 60 * 60);
    if (ageHours < 24) score += 12;
    else if (ageHours < 72) score += 6;
    else if (ageHours < 168) score += 3;

    return { memory: m, score };
  });

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map(s => s.memory);
}
