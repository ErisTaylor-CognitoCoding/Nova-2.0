import { sql } from "drizzle-orm";
import { pgTable, text, varchar, serial, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Users table (kept for future auth)
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Conversations - each chat thread with Nova
export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull().default("New Conversation"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const conversationsRelations = relations(conversations, ({ many }) => ({
  messages: many(messages),
}));

export const insertConversationSchema = createInsertSchema(conversations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Conversation = typeof conversations.$inferSelect;

// Messages - individual messages in conversations
export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // "user" or "assistant"
  content: text("content").notNull(),
  imageUrl: text("image_url"), // Optional base64 data URL for attached images
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}));

export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  createdAt: true,
});

export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messages.$inferSelect;

// Memories - things Nova remembers about the user
export const memories = pgTable("memories", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(), // "preference", "fact", "feeling", "event", "business"
  content: text("content").notNull(),
  importance: integer("importance").notNull().default(5), // 1-10 scale
  project: text("project"), // Optional project tag: "DashDeck", "LessonFlow", "LessonCrafter", etc.
  sourceMessageId: integer("source_message_id").references(() => messages.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMemorySchema = createInsertSchema(memories).omit({
  id: true,
  createdAt: true,
});

export type InsertMemory = z.infer<typeof insertMemorySchema>;
export type Memory = typeof memories.$inferSelect;

// Nova's personality traits - his own opinions, preferences, quirks
export const novaTraits = pgTable("nova_traits", {
  id: serial("id").primaryKey(),
  traitType: text("trait_type").notNull(), // "opinion", "preference", "quirk", "value"
  topic: text("topic").notNull(),
  content: text("content").notNull(),
  strength: integer("strength").notNull().default(5), // 1-10 how strongly held
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertNovaTraitSchema = createInsertSchema(novaTraits).omit({
  id: true,
  createdAt: true,
});

export type InsertNovaTrait = z.infer<typeof insertNovaTraitSchema>;
export type NovaTrait = typeof novaTraits.$inferSelect;
