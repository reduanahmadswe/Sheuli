import OpenAI from 'openai';
import config from './config.js';
import { getAllSettings } from './db.js';
import logger from './logger.js';

export const openai = new OpenAI({ apiKey: config.openaiApiKey });

const BANGLA_UNICODE_RANGE = /[ঀ-৿]/;
const BANGLISH_WORDS = [
  'ami', 'tumi', 'tui', 'apni', 'kemon', 'ache', 'achi', 'acho', 'achen', 'kothay', 'korbo',
  'korte', 'koro', 'korchi', 'hobe', 'hocche', 'keno', 'bhalo', 'valo', 'lagbe', 'dite', 'diben',
  'parbo', 'parben', 'parbi', 'bhai', 'tomar', 'tor', 'amar', 'apnar', 'ki', 'na', 'hae', 'jabo',
  'asbe', 'ashbe', 'ekhon', 'ekhono', 'busy', 'kaj', 'shomoy', 'somoy', 'bolo', 'bolun', 'bolen'
];

function detectLanguageHint(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return 'english';
  if (BANGLA_UNICODE_RANGE.test(trimmed)) return 'bangla';

  const words = trimmed.toLowerCase().match(/[a-z]+/g) || [];
  const banglishHits = words.filter((w) => BANGLISH_WORDS.includes(w)).length;
  if (banglishHits > 0) return 'banglish';

  return 'english';
}

// Used when OpenAI cannot be reached, so the reply still reflects the active
// mode and the sender's language instead of one fixed line.
export function buildFallbackMessage(activity, languageHint) {
  if (activity?.type !== 'mode') return config.defaults.fallbackMessage;
  const mode = activity.info?.name || activity.title;
  const owner = config.ownerName;
  if (languageHint === 'english') {
    return `${owner} is not available right now (${mode}) and will reply later. — Sheuli 🌸`;
  }
  if (languageHint === 'banglish') {
    return `${owner} ekhon available nei (${mode}), pore reply korbe. — Sheuli 🌸`;
  }
  return `${owner} এখন available নেই (${mode}), পরে reply করবে। — Sheuli 🌸`;
}

function buildMessages({ systemPrompt, history, incomingBody, isFirstReply, languageHint, activityContext, modeContext, scheduleContext }) {
  const messages = [{ role: 'system', content: systemPrompt }];

  if (scheduleContext) {
    messages.push({
      role: 'system',
      content: `CALENDAR & SCHEDULE INFORMATION:\n${scheduleContext}`
    });
  }

  for (const entry of history) {
    messages.push({
      role: entry.direction === 'in' ? 'user' : 'assistant',
      content: entry.body
    });
  }

  const liveContext = activityContext || modeContext;
  if (liveContext) {
    messages.push({
      role: 'system',
      content: `CURRENT STATUS & PRIORITY INSTRUCTION (MUST FOLLOW FOR THIS REPLY):\n${liveContext}`
    });
  }

  messages.push({
    role: 'system',
    content: isFirstReply
      ? 'This is the first reply in this conversation. Introduce yourself briefly before answering.'
      : 'You have already introduced yourself earlier in this conversation. Do NOT repeat the introduction — answer directly.'
  });

  messages.push({
    role: 'system',
    content: `The user's latest message appears to be in: ${languageHint}. Reply in ${languageHint}.`
  });

  if (incomingBody.startsWith('[Voice Note Transcribed]:')) {
    messages.push({
      role: 'system',
      content: 'The user sent a voice message. The transcribed text of their voice message is provided. Answer their voice message content directly and naturally.'
    });
  } else if (incomingBody.includes('[Voice Note Received]')) {
    messages.push({
      role: 'system',
      content: 'The user sent a voice message. Inform them warmly that you received their voice note and Reduan will listen to it soon.'
    });
  }

  messages.push({ role: 'user', content: incomingBody });
  return messages;
}

export async function generateReply({
  contactId,
  incomingBody,
  history = [],
  isFirstReply = history.length === 0,
  currentActivity = null,
  activityContext = null,
  modeContext = null,
  scheduleContext = null
}) {
  const settings = getAllSettings();
  const languageHint = detectLanguageHint(incomingBody);

  const messages = buildMessages({
    systemPrompt: settings.systemPrompt,
    history,
    incomingBody,
    isFirstReply,
    languageHint,
    activityContext,
    modeContext,
    scheduleContext
  });

  try {
    const completion = await openai.chat.completions.create({
      model: settings.model || config.defaults.model,
      messages,
      max_tokens: config.defaults.maxTokens,
      temperature: config.defaults.temperature
    });

    const reply = completion.choices?.[0]?.message?.content?.trim();
    const usage = completion.usage || {};

    if (!reply) {
      throw new Error('Empty completion from OpenAI');
    }

    return {
      reply,
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
      fallback: false
    };
  } catch (err) {
    logger.error({ err: err.message, contactId }, 'OpenAI request failed, using fallback message');

    return {
      reply: buildFallbackMessage(currentActivity, languageHint),
      promptTokens: 0,
      completionTokens: 0,
      fallback: true
    };
  }
}

export default { generateReply };
