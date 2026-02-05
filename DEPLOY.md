# Deploying Nova Stack

Everything Nova needs in one stack - app, database, and LLM.

## Quick Start

```bash
# Clone the repo
git clone https://github.com/CognitoCoding/Nova.git
cd Nova

# Copy and edit your environment file
cp .env.example .env
nano .env  # Fill in your secrets

# Start the stack
docker compose up -d --build

# Pull Qwen for Nova's brain (pick your size)
docker exec nova-ollama ollama pull qwen2.5:7b    # 7B - needs ~8GB VRAM
# OR
docker exec nova-ollama ollama pull qwen2.5:14b   # 14B - needs ~16GB VRAM

# Run database migrations
docker exec nova npm run db:push
```

## What's In The Stack

| Container | Purpose |
|-----------|---------|
| `nova` | The main app (web + Discord bot) |
| `nova-db` | Postgres database |
| `nova-ollama` | Qwen 2.5 LLM |

## Updating Nova

When you make changes on Replit:

```bash
cd Nova
git pull
docker compose up -d --build
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Description |
|----------|-------------|
| `POSTGRES_PASSWORD` | Database password (pick something secure) |
| `LLM_API_KEY` | Usually `none` for Ollama |
| `DISCORD_BOT_TOKEN` | From Discord Developer Portal |
| `ZERO_DISCORD_ID` | Your Discord user ID |
| `ELEVENLABS_API_KEY` | For Nova's voice (TTS) |
| `TAVILY_API_KEY` | For web search |
| `GMAIL_*` | For Nova's email access |

## Checking Logs

```bash
docker logs -f nova          # App logs
docker logs -f nova-db       # Database logs  
docker logs -f nova-ollama   # LLM logs
```

## Voice Chat

Voice works on your server (Docker has full UDP access).
Type `!join` in Discord when you're in a voice channel.

## Stopping Everything

```bash
docker compose down           # Stop containers
docker compose down -v        # Stop and delete data (careful!)
```
