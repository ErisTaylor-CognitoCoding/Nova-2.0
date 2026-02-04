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
- **User ID**: Uses `ZERO_DISCORD_ID` (numeric snowflake ID: 1419053327798243338) for proactive DMs
- **Full Feature Parity**: Discord Nova now has the SAME integrations as Web Nova:
  - **Grind Tracker**: "check my tasks", "what's on my plate", "grind tracker"
  - **Social Media**: "linkedin posts", "content calendar", "what's scheduled"
  - **Accounts/Finances**: "how are we doing", "check accounts", "income/expenses"
  - **CRM/Database Queries**: "find X from CRM", "check leads tracker"
  - **Calendar**: "what's on the calendar", "upcoming events", date queries
  - **Email**: "check emails", "any new emails", "did they reply"
  - **Web Search**: "news about X", "look up X", "F1 results"
- **Anti-Hallucination**: All integrations include explicit warnings to only report actual data
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
- **Mark Read**: Nova can mark all emails as read using [MARK_ALL_READ] command
- **Client**: `server/gmail-client.ts` handles OAuth authentication, reading, sending, and marking as read
- **Endpoints**: `/api/gmail/emails`, `/api/gmail/subscriptions`, `/api/gmail/unread`, `/api/gmail/status`, `/api/gmail/send`
- **OAuth Setup**: Uses GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN secrets

### Google Calendar Integration
- **API**: Uses Replit Google Calendar connection for the Cognito Coding Calendar
- **Read Features**: Nova can check upcoming events, show schedule
- **Write Features**: Nova can create new calendar events
- **Calendar Triggers**: "calendar", "Cognito Calendar", "what's on my schedule", "upcoming events", "what's happening", date mentions like "10th February"
- **Create Triggers**: "schedule a meeting", "add to calendar", "create an event", "book a call"
- **Client**: `server/calendar-client.ts` handles authentication, reading, and creating events
- **Endpoints**: `/api/calendar/events`, `/api/calendar/calendars`
- **Calendar**: Cognito Coding Calendar (auto-detected by name)

### Notion Document Collaboration
- **Read Features**: Nova can open and read any Notion page, list recent pages
- **Write Features**: Nova can add content to pages, create new pages
- **Read Triggers**: "open [page name]", "show me [page] document", "recent pages", "what pages do we have"
- **Write Triggers**: "add to [page] document", "update [page] page", "create a new page called X"
- **Functions**: `listRecentPages`, `getPageByName`, `appendToPage`, `createPage` in notion-client.ts

### Notion Database Queries (CRM, Leads, etc.)
- **Query Features**: Nova can search and query any database in the teamspace
- **Supported Databases**: Companies CRM, Leads Tracker, Free POCs, Linkedin Proposals, Upwork Proposals, Other Proposals, Social Media Hooks, Workflow Automation Proposals
- **Triggers**: "find [name] from CRM", "check leads tracker", "show linkedin proposals", "what's in free POCs", "upwork proposals", "workflow automation"
- **Functions**: `queryDatabaseByName(databaseName, searchTerm)` in notion-client.ts
- **Anti-hallucination**: Results include explicit warnings to only report actual data

### Scheduled Messaging (Proactive)
- **Scheduler**: `server/scheduler.ts` using node-cron for timed tasks
- **Zero's Schedule**: Mornings free, tutoring 11:30am-7:30pm, Cognito work 7:30pm-12am
- **Weekday Schedule**:
  - Subscription Reminders (8:30am): Checks subscriptions due within 3 days
  - Morning Grind (9am): Checks grind tracker, suggests what to start with
  - Daily Email Summary (10am): Summarizes subscription/newsletter emails
  - Friendly Check-in (3:30pm): 50% chance of light personal message (during tutoring)
  - Work Mode Start (7:30pm): Email catch-up + suggested jobs for Cognito session
  - Evening Wrap-up (11pm): End of work session check-in
- **Weekend Schedule** (Zero sleeps in, works until 2am):
  - Morning Grind (10am): Later start
  - Subscription Reminders (10:30am): Later start
  - Email Summary (11am): Later start
  - Evening Wrap-up (1am): Later wrap-up for night owl sessions
- **Weekly Review (Sunday 11am UK)**: Reviews grind tracker progress and plans week ahead
- **Requires**: `ZERO_DISCORD_ID` environment variable to send proactive Discord DMs
- **Export**: `sendProactiveMessage(userId, content)` for ad-hoc proactive messages