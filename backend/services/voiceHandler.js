import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { toFile } from 'openai';
import { openai } from '../ai.js';
import logger from '../logger.js';

export async function transcribeAudioMedia(media) {
  if (!media || !media.data) {
    throw new Error('No media data received for voice transcription');
  }

  const cleanMime = (media.mimetype || 'audio/ogg').split(';')[0].trim();
  let extension = 'ogg';
  if (cleanMime.includes('mp3') || cleanMime.includes('mpeg')) extension = 'mp3';
  else if (cleanMime.includes('wav')) extension = 'wav';
  else if (cleanMime.includes('m4a') || cleanMime.includes('mp4')) extension = 'm4a';

  try {
    const buffer = Buffer.from(media.data, 'base64');
    logger.info({ mimetype: cleanMime, bufferLength: buffer.length }, 'Transcribing voice note with OpenAI Whisper API...');

    // Method 1: In-memory upload via toFile
    try {
      const fileObj = await toFile(buffer, `voice_note.${extension}`, { type: cleanMime });
      const transcription = await openai.audio.transcriptions.create({
        file: fileObj,
        model: 'whisper-1'
      });

      const transcript = transcription?.text?.trim() || '';
      if (transcript) {
        logger.info({ transcriptLength: transcript.length }, 'Voice transcription successful (toFile)');
        return transcript;
      }
    } catch (toFileErr) {
      logger.warn({ err: toFileErr?.message || toFileErr }, 'toFile transcription attempt failed, trying temp file fallback');
    }

    // Method 2: Disk temp file fallback
    const tempPath = path.join(os.tmpdir(), `voice_${Date.now()}.${extension}`);
    await fs.promises.writeFile(tempPath, buffer);

    try {
      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(tempPath),
        model: 'whisper-1'
      });

      const transcript = transcription?.text?.trim() || '';
      logger.info({ transcriptLength: transcript.length }, 'Voice transcription successful (disk fallback)');
      return transcript;
    } finally {
      try {
        if (fs.existsSync(tempPath)) await fs.promises.unlink(tempPath);
      } catch {}
    }
  } catch (err) {
    logger.error({ err: err?.message || err }, 'Voice transcription completely failed');
    return null;
  }
}

export async function generateVoiceReplyAudio(text, voice = 'nova') {
  if (!text) return null;

  const selectedVoice = voice || 'nova';
  const tempPath = path.join(os.tmpdir(), `reply_tts_${Date.now()}.${selectedVoice}.mp3`);

  try {
    const mp3Response = await openai.audio.speech.create({
      model: 'tts-1-hd',
      voice: selectedVoice,
      input: text
    });

    const buffer = Buffer.from(await mp3Response.arrayBuffer());
    await fs.promises.writeFile(tempPath, buffer);

    return {
      filePath: tempPath,
      base64: buffer.toString('base64'),
      mimetype: 'audio/mp3'
    };
  } catch (err) {
    logger.error({ err: err?.message || err }, 'Failed to generate voice reply with OpenAI TTS');
    return null;
  }
}

export default {
  transcribeAudioMedia,
  generateVoiceReplyAudio
};
