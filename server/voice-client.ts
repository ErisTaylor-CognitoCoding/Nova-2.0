import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { 
  joinVoiceChannel, 
  createAudioPlayer, 
  createAudioResource,
  VoiceConnection,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType,
  EndBehaviorType
} from '@discordjs/voice';
import { VoiceBasedChannel, Guild } from 'discord.js';
import { Readable, PassThrough } from 'stream';
import { log } from './index';
import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import * as prism from 'prism-media';

const elevenlabs = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY
});

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY || 'sk-not-set',
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || undefined,
});

const whisperClient = new OpenAI({
  apiKey: process.env.OPENAI_WHISPER_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY || 'sk-not-set',
});

const NOVA_VOICE_ID = 'pNInz6obpgDQGcFmaJgB'; // Adam - deep male voice

const activeConnections = new Map<string, VoiceConnection>();
const audioPlayers = new Map<string, ReturnType<typeof createAudioPlayer>>();
const speechCallbacks = new Map<string, (userId: string, text: string) => void>();
const activeListeners = new Map<string, Set<string>>(); // guildId -> Set of userIds being listened to

export async function textToSpeech(text: string): Promise<Buffer> {
  try {
    const audioStream = await elevenlabs.textToSpeech.convert(NOVA_VOICE_ID, {
      text,
      modelId: 'eleven_turbo_v2_5',
      voiceSettings: {
        stability: 0.5,
        similarityBoost: 0.75,
        style: 0.3,
        useSpeakerBoost: true
      }
    });

    const chunks: Buffer[] = [];
    if (audioStream instanceof ReadableStream) {
      const reader = audioStream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(Buffer.from(value));
      }
    } else {
      for await (const chunk of audioStream as AsyncIterable<Uint8Array>) {
        chunks.push(Buffer.from(chunk));
      }
    }
    return Buffer.concat(chunks);
  } catch (error) {
    log(`ElevenLabs TTS error: ${error}`, 'voice');
    throw error;
  }
}

export async function joinChannel(channel: VoiceBasedChannel): Promise<VoiceConnection | null> {
  try {
    // Create adapter with proper handling for Replit environment
    const adapterCreator = channel.guild.voiceAdapterCreator;
    
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: adapterCreator,
      selfDeaf: false,
      selfMute: false,
      debug: true
    });

    // Handle connection state changes with more patience
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        // Try to reconnect
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        // If we can't reconnect, destroy the connection
        connection.destroy();
        activeConnections.delete(channel.guild.id);
        audioPlayers.delete(channel.guild.id);
      }
    });

    connection.on('error', (error) => {
      log(`Voice connection error: ${error}`, 'voice');
    });

    connection.on('debug', (message) => {
      log(`Voice debug: ${message}`, 'voice');
    });

    // Wait longer for connection (60 seconds)
    await entersState(connection, VoiceConnectionStatus.Ready, 60_000);
    
    activeConnections.set(channel.guild.id, connection);
    
    const player = createAudioPlayer();
    audioPlayers.set(channel.guild.id, player);
    connection.subscribe(player);

    log(`Joined voice channel: ${channel.name}`, 'voice');
    return connection;
  } catch (error) {
    log(`Failed to join voice channel: ${error}`, 'voice');
    return null;
  }
}

export function leaveChannel(guildId: string): boolean {
  const connection = activeConnections.get(guildId);
  if (connection) {
    connection.destroy();
    activeConnections.delete(guildId);
    audioPlayers.delete(guildId);
    log(`Left voice channel in guild ${guildId}`, 'voice');
    return true;
  }
  return false;
}

export async function speakInChannel(guildId: string, text: string): Promise<boolean> {
  const connection = activeConnections.get(guildId);
  const player = audioPlayers.get(guildId);
  
  if (!connection || !player) {
    log(`No active voice connection for guild ${guildId}`, 'voice');
    return false;
  }

  try {
    const audioBuffer = await textToSpeech(text);
    
    const audioStream = Readable.from(audioBuffer);
    const resource = createAudioResource(audioStream, {
      inputType: StreamType.Arbitrary
    });
    
    player.play(resource);
    
    await new Promise<void>((resolve, reject) => {
      player.once(AudioPlayerStatus.Idle, () => resolve());
      player.once('error', (error) => reject(error));
      setTimeout(() => resolve(), 60000);
    });
    
    return true;
  } catch (error) {
    log(`Failed to speak in channel: ${error}`, 'voice');
    return false;
  }
}

export function isInVoiceChannel(guildId: string): boolean {
  return activeConnections.has(guildId);
}

export function getConnection(guildId: string): VoiceConnection | undefined {
  return activeConnections.get(guildId);
}

// Speech recognition functions
export function setSpeechCallback(guildId: string, callback: (userId: string, text: string) => void): void {
  speechCallbacks.set(guildId, callback);
}

export function removeSpeechCallback(guildId: string): void {
  speechCallbacks.delete(guildId);
}

async function transcribeAudio(audioBuffer: Buffer): Promise<string | null> {
  try {
    // Create a temporary file for the audio
    const tempDir = '/tmp/voice_recordings';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const tempFile = path.join(tempDir, `recording_${Date.now()}.wav`);
    
    // Write raw PCM to WAV format
    const wavHeader = createWavHeader(audioBuffer.length, 48000, 2, 16);
    const wavBuffer = Buffer.concat([wavHeader, audioBuffer]);
    fs.writeFileSync(tempFile, wavBuffer);
    
    // Transcribe with Whisper
    const transcription = await whisperClient.audio.transcriptions.create({
      file: fs.createReadStream(tempFile),
      model: 'whisper-1',
      language: 'en'
    });
    
    // Clean up temp file
    fs.unlinkSync(tempFile);
    
    return transcription.text || null;
  } catch (error) {
    log(`Whisper transcription error: ${error}`, 'voice');
    return null;
  }
}

function createWavHeader(dataLength: number, sampleRate: number, channels: number, bitsPerSample: number): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * bitsPerSample / 8;
  const blockAlign = channels * bitsPerSample / 8;
  
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // Subchunk1Size
  header.writeUInt16LE(1, 20); // AudioFormat (PCM)
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);
  
  return header;
}

export function startListening(guildId: string, targetUserId?: string): void {
  const connection = activeConnections.get(guildId);
  if (!connection) {
    log(`No connection found for guild ${guildId}`, 'voice');
    return;
  }
  
  const receiver = connection.receiver;
  
  // Listen for when users start speaking
  receiver.speaking.on('start', (userId) => {
    // If targetUserId is set, only listen to that user
    if (targetUserId && userId !== targetUserId) {
      return;
    }
    
    // Check if already listening to this user
    let listeners = activeListeners.get(guildId);
    if (!listeners) {
      listeners = new Set();
      activeListeners.set(guildId, listeners);
    }
    
    if (listeners.has(userId)) {
      return; // Already listening
    }
    
    listeners.add(userId);
    log(`User ${userId} started speaking`, 'voice');
    
    const audioChunks: Buffer[] = [];
    
    // Subscribe to their audio stream
    const opusStream = receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: 1000 // End after 1 second of silence
      }
    });
    
    // Decode opus to PCM
    const decoder = new prism.opus.Decoder({
      rate: 48000,
      channels: 2,
      frameSize: 960
    });
    
    const pcmStream = opusStream.pipe(decoder);
    
    pcmStream.on('data', (chunk: Buffer) => {
      audioChunks.push(chunk);
    });
    
    pcmStream.on('end', async () => {
      listeners?.delete(userId);
      
      if (audioChunks.length === 0) {
        return;
      }
      
      const audioBuffer = Buffer.concat(audioChunks);
      
      // Only process if we have enough audio (at least 0.5 seconds)
      // 48000 samples/sec * 2 channels * 2 bytes = 192000 bytes/sec
      if (audioBuffer.length < 96000) {
        log(`Audio too short (${audioBuffer.length} bytes), skipping`, 'voice');
        return;
      }
      
      log(`Processing audio from user ${userId} (${audioBuffer.length} bytes)`, 'voice');
      
      const transcription = await transcribeAudio(audioBuffer);
      
      if (transcription && transcription.trim()) {
        log(`Transcribed: "${transcription}"`, 'voice');
        
        const callback = speechCallbacks.get(guildId);
        if (callback) {
          callback(userId, transcription);
        }
      }
    });
    
    pcmStream.on('error', (error: Error) => {
      log(`PCM stream error: ${error}`, 'voice');
      listeners?.delete(userId);
    });
  });
  
  log(`Started listening for speech in guild ${guildId}`, 'voice');
}

export function stopListening(guildId: string): void {
  activeListeners.delete(guildId);
  log(`Stopped listening for speech in guild ${guildId}`, 'voice');
}
