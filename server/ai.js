import OpenAI from 'openai';
import config from './config.js';
import { getAllSettings } from './db.js';
import logger from './logger.js';
import { sendAlert } from './alerts.js';

export const openai = new OpenAI({ apiKey: config.openaiApiKey });

// FEATURE 1: alert once (not spam) after 3+ consecutive OpenAI failures, and
// clear the streak on the next success so a future run of failures alerts again.
const CONSECUTIVE_FAILURE_ALERT_THRESHOLD = 3;
let consecutiveFailures = 0;
let failureAlertSent = false;

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

function buildMessages({ systemPrompt, history, incomingBody, isFirstReply, languageHint }) {
  const messages = [{ role: 'system', content: systemPrompt }];

  for (const entry of history) {
    messages.push({
      role: entry.direction === 'in' ? 'user' : 'assistant',
      content: entry.body
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

  messages.push({ role: 'user', content: incomingBody });
  return messages;
}

export async function generateReply({ contactId, incomingBody, history = [], isFirstReply = history.length === 0 }) {
  const settings = getAllSettings();
  const languageHint = detectLanguageHint(incomingBody);

  const messages = buildMessages({
    systemPrompt: settings.systemPrompt,
    history,
    incomingBody,
    isFirstReply,
    languageHint
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

    consecutiveFailures = 0;
    failureAlertSent = false;

    return {
      reply,
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
      fallback: false
    };
  } catch (err) {
    logger.error({ err: err.message, contactId }, 'OpenAI request failed, using fallback message');

    consecutiveFailures += 1;
    if (consecutiveFailures >= CONSECUTIVE_FAILURE_ALERT_THRESHOLD && !failureAlertSent) {
      failureAlertSent = true;
      sendAlert(
        `🟠 OpenAI API has failed ${consecutiveFailures} times in a row. Sheuli is using fallback replies until it recovers.`
      ).catch((alertErr) => {
        logger.warn({ err: alertErr?.message || alertErr }, 'Failed to send consecutive-failure alert');
      });
    }

    return {
      reply: config.defaults.fallbackMessage,
      promptTokens: 0,
      completionTokens: 0,
      fallback: true
    };
  }
}

export default { generateReply };
