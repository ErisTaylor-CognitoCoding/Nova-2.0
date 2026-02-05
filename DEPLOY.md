# Deploying Nova to Your Server

## Step 1: Set Up the LLM Stack (Ollama with Qwen)

```bash
# Create the shared network first
docker network create llm-network

# Start Ollama
docker compose -f docker-compose.ollama.yml up -d

# Pull Qwen 2.5 (pick your size based on your GPU)
docker exec ollama ollama pull qwen2.5:7b      # 7B - needs ~8GB VRAM
docker exec ollama ollama pull qwen2.5:14b     # 14B - needs ~16GB VRAM  
docker exec ollama ollama pull qwen2.5:32b     # 32B - needs ~24GB VRAM
```

## Step 2: Set Up Nova Stack

```bash
# Clone the repo
git clone https://github.com/CognitoCoding/Nova.git
cd Nova

# Copy and edit your environment file
cp .env.example .env
nano .env  # Fill in your secrets

# Build and start Nova
docker compose up -d --build

# Run database migrations
docker exec nova npm run db:push
```

## Step 3: Updating Nova

When you make changes on Replit:

```bash
cd Nova
git pull
docker compose up -d --build
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `POSTGRES_PASSWORD` | Database password (pick something secure) |
| `LLM_BASE_URL` | Points to Ollama: `http://ollama:11434/v1` |
| `LLM_API_KEY` | Usually `none` for local Ollama |
| `DISCORD_BOT_TOKEN` | From Discord Developer Portal |
| `ZERO_DISCORD_ID` | Your Discord user ID |
| `ELEVENLABS_API_KEY` | For Nova's voice (TTS) |
| `TAVILY_API_KEY` | For web search |
| `GMAIL_*` | For Nova's email access |

## Checking Logs

```bash
# Nova logs
docker logs -f nova

# Database logs
docker logs -f nova-db

# Ollama logs
docker logs -f ollama
```

## Voice Chat

Voice will work on your server since Docker has full UDP access.
Just type `!join` in Discord when you're in a voice channel.
