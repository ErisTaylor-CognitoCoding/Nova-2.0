import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { 
  joinVoiceChannel, 
  createAudioPlayer, 
  createAudioResource,
  VoiceConnection,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType
} from '@discordjs/voice';
import { VoiceBasedChannel, Guild } from 'discord.js';
import { Readable } from 'stream';
import { log } from './index';

const elevenlabs = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY
});

const NOVA_VOICE_ID = 'pNInz6obpgDQGcFmaJgB'; // Adam - deep male voice

const activeConnections = new Map<string, VoiceConnection>();
const audioPlayers = new Map<string, ReturnType<typeof createAudioPlayer>>();

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
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    
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
