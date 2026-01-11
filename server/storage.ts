import {
  type User,
  type InsertUser,
  type Conversation,
  type InsertConversation,
  type Message,
  type InsertMessage,
  type Memory,
  type InsertMemory,
  type NovaTrait,
  type InsertNovaTrait,
  type ScienceStanVideo,
  type InsertScienceStanVideo,
  users,
  conversations,
  messages,
  memories,
  novaTraits,
  scienceStanVideos,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, like, or } from "drizzle-orm";

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Conversations
  getConversation(id: number): Promise<Conversation | undefined>;
  getConversationByTitle(title: string): Promise<Conversation | undefined>;
  getAllConversations(): Promise<Conversation[]>;
  createConversation(data: InsertConversation): Promise<Conversation>;
  updateConversation(id: number, data: Partial<InsertConversation>): Promise<Conversation | undefined>;
  deleteConversation(id: number): Promise<void>;

  // Messages
  getMessagesByConversation(conversationId: number): Promise<Message[]>;
  createMessage(data: InsertMessage): Promise<Message>;
  getRecentMessages(limit: number): Promise<Message[]>;

  // Memories
  getAllMemories(): Promise<Memory[]>;
  getMemoriesByCategory(category: string): Promise<Memory[]>;
  createMemory(data: InsertMemory): Promise<Memory>;
  updateMemory(id: number, data: Partial<InsertMemory>): Promise<Memory | undefined>;
  deleteMemory(id: number): Promise<void>;
  findMemoryByContent(searchText: string): Promise<Memory | undefined>;

  // Nova Traits
  getAllNovaTraits(): Promise<NovaTrait[]>;
  createNovaTrait(data: InsertNovaTrait): Promise<NovaTrait>;
  updateNovaTrait(id: number, data: Partial<InsertNovaTrait>): Promise<NovaTrait | undefined>;
  findTraitByTopic(topic: string): Promise<NovaTrait | undefined>;

  // Science Stan Videos
  getAllScienceStanVideos(): Promise<ScienceStanVideo[]>;
  getScienceStanVideo(id: number): Promise<ScienceStanVideo | undefined>;
  createScienceStanVideo(data: InsertScienceStanVideo): Promise<ScienceStanVideo>;
  updateScienceStanVideo(id: number, data: Partial<InsertScienceStanVideo>): Promise<ScienceStanVideo | undefined>;
  deleteScienceStanVideo(id: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  // Users
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  // Conversations
  async getConversation(id: number): Promise<Conversation | undefined> {
    const [conversation] = await db.select().from(conversations).where(eq(conversations.id, id));
    return conversation;
  }

  async getConversationByTitle(title: string): Promise<Conversation | undefined> {
    const [conversation] = await db.select().from(conversations).where(eq(conversations.title, title));
    return conversation;
  }

  async getAllConversations(): Promise<Conversation[]> {
    return db.select().from(conversations).orderBy(desc(conversations.updatedAt));
  }

  async createConversation(data: InsertConversation): Promise<Conversation> {
    const [conversation] = await db.insert(conversations).values(data).returning();
    return conversation;
  }

  async updateConversation(id: number, data: Partial<InsertConversation>): Promise<Conversation | undefined> {
    const [conversation] = await db
      .update(conversations)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(conversations.id, id))
      .returning();
    return conversation;
  }

  async deleteConversation(id: number): Promise<void> {
    await db.delete(messages).where(eq(messages.conversationId, id));
    await db.delete(conversations).where(eq(conversations.id, id));
  }

  // Messages
  async getMessagesByConversation(conversationId: number): Promise<Message[]> {
    return db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.createdAt);
  }

  async createMessage(data: InsertMessage): Promise<Message> {
    const [message] = await db.insert(messages).values(data).returning();
    // Update conversation's updatedAt
    await db
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, data.conversationId));
    return message;
  }

  async getRecentMessages(limit: number): Promise<Message[]> {
    return db.select().from(messages).orderBy(desc(messages.createdAt)).limit(limit);
  }

  // Memories
  async getAllMemories(): Promise<Memory[]> {
    return db.select().from(memories).orderBy(desc(memories.importance));
  }

  async getMemoriesByCategory(category: string): Promise<Memory[]> {
    return db.select().from(memories).where(eq(memories.category, category));
  }

  async createMemory(data: InsertMemory): Promise<Memory> {
    const [memory] = await db.insert(memories).values(data).returning();
    return memory;
  }

  async updateMemory(id: number, data: Partial<InsertMemory>): Promise<Memory | undefined> {
    const [memory] = await db
      .update(memories)
      .set(data)
      .where(eq(memories.id, id))
      .returning();
    return memory;
  }

  async deleteMemory(id: number): Promise<void> {
    await db.delete(memories).where(eq(memories.id, id));
  }

  async findMemoryByContent(searchText: string): Promise<Memory | undefined> {
    const allMems = await db.select().from(memories);
    const searchLower = searchText.toLowerCase();
    return allMems.find(m => 
      m.content.toLowerCase().includes(searchLower) || 
      searchLower.includes(m.content.toLowerCase().slice(0, 30))
    );
  }

  // Nova Traits
  async getAllNovaTraits(): Promise<NovaTrait[]> {
    return db.select().from(novaTraits).orderBy(desc(novaTraits.strength));
  }

  async createNovaTrait(data: InsertNovaTrait): Promise<NovaTrait> {
    const [trait] = await db.insert(novaTraits).values(data).returning();
    return trait;
  }

  async updateNovaTrait(id: number, data: Partial<InsertNovaTrait>): Promise<NovaTrait | undefined> {
    const [trait] = await db
      .update(novaTraits)
      .set(data)
      .where(eq(novaTraits.id, id))
      .returning();
    return trait;
  }

  async findTraitByTopic(topic: string): Promise<NovaTrait | undefined> {
    const allTraits = await db.select().from(novaTraits);
    const topicLower = topic.toLowerCase();
    return allTraits.find(t => t.topic.toLowerCase() === topicLower);
  }

  // Science Stan Videos
  async getAllScienceStanVideos(): Promise<ScienceStanVideo[]> {
    return db.select().from(scienceStanVideos).orderBy(desc(scienceStanVideos.updatedAt));
  }

  async getScienceStanVideo(id: number): Promise<ScienceStanVideo | undefined> {
    const [video] = await db.select().from(scienceStanVideos).where(eq(scienceStanVideos.id, id));
    return video;
  }

  async createScienceStanVideo(data: InsertScienceStanVideo): Promise<ScienceStanVideo> {
    const [video] = await db.insert(scienceStanVideos).values(data).returning();
    return video;
  }

  async updateScienceStanVideo(id: number, data: Partial<InsertScienceStanVideo>): Promise<ScienceStanVideo | undefined> {
    const [video] = await db
      .update(scienceStanVideos)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(scienceStanVideos.id, id))
      .returning();
    return video;
  }

  async deleteScienceStanVideo(id: number): Promise<void> {
    await db.delete(scienceStanVideos).where(eq(scienceStanVideos.id, id));
  }
}

export const storage = new DatabaseStorage();
