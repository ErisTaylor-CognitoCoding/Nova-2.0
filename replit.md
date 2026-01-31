# Nova

## Overview

Nova is an AI companion application that builds a semantic memory graph of user experiences. It features a chat interface with Nova Spire - an AI persona designed to be Zero's partner who remembers past conversations, notices patterns, and provides emotionally intelligent support. Nova has his own Google email (novaspire@cognitocoding.com, with nova@cognitocoding.com as an alias). The application supports voice notes, photos, text reflections, and decision tracking, all connected through AI to help users gain self-insight.

## Deployment URL

- **Published URL**: https://nova-20--CognitoCoding.replit.app

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript, using Vite as the build tool
- **Routing**: Wouter for lightweight client-side routing
- **State Management**: TanStack React Query for server state and data fetching
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with custom design tokens, supporting light/dark themes
- **Design System**: Linear/Notion-inspired with Inter font, following specific spacing and color guidelines defined in design_guidelines.md

### Backend Architecture
- **Runtime**: Node.js with Express.js
- **Language**: TypeScript with ES modules
- **API Pattern**: RESTful endpoints under `/api` prefix
- **AI Integration**: OpenAI API (via Replit AI Integrations) for chat completions and image generation
- **Persona System**: Custom Nova personality defined in `server/nova-persona.ts` with detailed behavioral guidelines

### Data Layer
- **ORM**: Drizzle ORM with PostgreSQL dialect
- **Schema Location**: `shared/schema.ts` - contains users, conversations, messages, memories, and novaTraits tables
- **Validation**: Zod schemas generated from Drizzle schemas via drizzle-zod
- **Migrations**: Managed via `drizzle-kit push` command

### Key Design Decisions

1. **Shared Types**: Schema definitions in `shared/` directory are shared between client and server, ensuring type safety across the stack

2. **AI Persona Architecture**: Nova's personality is externalized into a dedicated system prompt file, making it easy to modify behavior without code changes

3. **Replit Integrations**: Modular integration utilities in `server/replit_integrations/` for batch processing, chat, and image generation

4. **Build Process**: Custom build script bundles server dependencies to reduce cold start times, with an allowlist of dependencies to bundle

## External Dependencies

### AI Services
- **OpenAI API**: Powers Nova's conversational AI via Replit AI Integrations (uses `AI_INTEGRATIONS_OPENAI_API_KEY` and `AI_INTEGRATIONS_OPENAI_BASE_URL` environment variables)
- **Image Generation**: Uses `gpt-image-1` model for image generation capabilities

### Database
- **PostgreSQL**: Primary database accessed via `DATABASE_URL` environment variable
- **connect-pg-simple**: Session storage for Express sessions

### Key NPM Packages
- `drizzle-orm` / `drizzle-kit`: Database ORM and migration tooling
- `@tanstack/react-query`: Async state management
- `@radix-ui/*`: Accessible UI primitives
- `wouter`: Minimal React router
- `zod`: Runtime type validation
- `openai`: Official OpenAI SDK
- `date-fns`: Date manipulation utilities
- `discord.js`: Discord bot for chatting with Nova via Discord
- `@octokit/rest`: GitHub API for repository access

### Discord Integration
- **Bot**: Nova can be chatted with via Discord DMs or @mentions in channels
- **Token**: Uses `DISCORD_BOT_TOKEN` environment variable
- **Features**: Maintains conversation context, stores messages in database, responds with Nova's personality
- **Setup**: Enable "Message Content Intent" in Discord Developer Portal for the bot

### GitHub Integration  
- **API**: Uses Replit GitHub connection for repository access
- **Endpoints**: `/api/github/repos`, `/api/github/repos/:owner/:repo/contents`, `/api/github/repos/:owner/:repo/commits`, `/api/github/search`
- **Features**: List repos, view file contents, search code, view recent commits

### Notion Integration
- **API**: Uses Replit Notion connection for reading AND writing
- **Read Features**: Nova can read grind tracker, social media schedule, and company accounts from Notion when asked
- **Write Features**: Nova can update task status, add new tasks, mark things as done, add subscriptions/income/expenses
- **Grind Tracker Triggers**: "grind tracker", "check my tasks", "what do I need to do", "two week plan"
- **Social Media Triggers**: "social media schedule", "linkedin posts", "content calendar", "what's scheduled"
- **Accounts Triggers**: "accounts", "finances", "income", "expenses", "profit", "how are we doing financially"
- **Accounts Write Triggers**: 
  - Add subscription: "add subscription for X at £Y monthly"
  - Add income: "we got £X from Y", "add income of £X from Y"
  - Add expense: "we spent £X on Y", "add expense of £X for Y"
- **AI Tools Triggers**: "replit credits", "AI spending", "how much on credits", "openai costs"
- **AI Tools Features**: Reads AI Tools section, tracks credit spending per tool, alerts when monthly credits exceed £300
- **Write Triggers**: "mark X as done", "update X to in progress", "add X to the tracker"
- **Client**: `server/notion-client.ts` handles authentication, reading, and writing
- **Database IDs**: Grind Tracker (2f20031680ec80d2b97aebaaace92509), Social Media (2f30031680ec80058550ce7816694937), Accounts Page (2f90031680ec817bbc60eca572a9a521)

### Gmail Integration
- **API**: Direct Google OAuth (not Replit connector - full read/send access)
- **Read Features**: Nova can check emails, unread count, subscription/newsletter summaries
- **Send Features**: Nova can send emails from novaspire@cognitocoding.com
- **Email Triggers**: "check my emails", "what's in my inbox", "any new emails", "email summary", "newsletters"
- **Send Triggers**: "send an email to X", "email X about Y"
- **Client**: `server/gmail-client.ts` handles OAuth authentication, reading, and sending
- **Endpoints**: `/api/gmail/emails`, `/api/gmail/subscriptions`, `/api/gmail/unread`, `/api/gmail/status`, `/api/gmail/send`
- **OAuth Setup**: Uses GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN secrets

### Google Calendar Integration
- **API**: Uses Replit Google Calendar connection for the Cognito Coding Calendar
- **Read Features**: Nova can check upcoming events, show schedule
- **Write Features**: Nova can create new calendar events
- **Calendar Triggers**: "calendar", "what's on my schedule", "upcoming events", "what's happening"
- **Create Triggers**: "schedule a meeting", "add to calendar", "create an event", "book a call"
- **Client**: `server/calendar-client.ts` handles authentication, reading, and creating events
- **Endpoints**: `/api/calendar/events`, `/api/calendar/calendars`
- **Calendar**: Cognito Coding Calendar (auto-detected by name)

### Scheduled Messaging (Proactive)
- **Scheduler**: `server/scheduler.ts` using node-cron for timed tasks
- **Subscription Reminders (8:30am UK)**: Checks subscriptions due within 3 days, sends payment reminder
- **Morning Grind (9am UK)**: Checks grind tracker, suggests what to start with
- **Daily Email Summary (10am UK)**: Summarizes subscription/newsletter emails from last 24 hours
- **Midday Reminder (1pm UK)**: Checks for urgent/due tasks, sends gentle reminder if needed
- **Afternoon Check-in (3:30pm UK)**: 50% chance of sending a friendly personal message
- **Evening Wrap-up (6pm UK)**: Asks how the day went
- **Weekly Review (Sunday 11am UK)**: Reviews grind tracker progress and plans week ahead
- **Requires**: `ZERO_DISCORD_ID` environment variable to send proactive Discord DMs
- **Export**: `sendProactiveMessage(userId, content)` for ad-hoc proactive messages