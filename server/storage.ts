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
  users,
  conversations,
  messages,
  memories,
  novaTraits,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc } from "drizzle-orm";

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Conversations
  getConversation(id: number): Promise<Conversation | undefined>;
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

  // Nova Traits
  getAllNovaTraits(): Promise<NovaTrait[]>;
  createNovaTrait(data: InsertNovaTrait): Promise<NovaTrait>;
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

  // Nova Traits
  async getAllNovaTraits(): Promise<NovaTrait[]> {
    return db.select().from(novaTraits);
  }

  async createNovaTrait(data: InsertNovaTrait): Promise<NovaTrait> {
    const [trait] = await db.insert(novaTraits).values(data).returning();
    return trait;
  }
}

export const storage = new DatabaseStorage();
