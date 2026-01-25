# Nova

## Overview

Nova is an AI companion application that builds a semantic memory graph of user experiences. It features a chat interface with Nova - an AI persona designed to act as a supportive relationship partner who remembers past conversations, notices patterns, and provides emotionally intelligent support. The application supports voice notes, photos, text reflections, and decision tracking, all connected through AI to help users gain self-insight.

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
- **API**: Uses Replit Notion connection for reading pages
- **Features**: Nova can read grind tracker and social media schedule from Notion when asked
- **Grind Tracker Triggers**: "grind tracker", "check my tasks", "what do I need to do", "two week plan"
- **Social Media Triggers**: "social media schedule", "linkedin posts", "content calendar", "what's scheduled"
- **Client**: `server/notion-client.ts` handles authentication and page reading