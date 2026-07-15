import OpenAI from 'openai';
import config from './config.js';
import { getAllSettings } from './db.js';
import logger from './logger.js';

const openai = new OpenAI({ apiKey: config.openaiApiKey });

function buildMessages({ systemPrompt, history, incomingBody, isFirstReply }) {
  const messages = [{ role: 'system', content: systemPrompt }];

  for (const entry of history) {
    messages.push({
      role: entry.direction === 'in' ? 'user' : 'assistant',
      content: entry.body
    });
  }

  if (isFirstReply) {
    messages.push({
      role: 'system',
      content: 'এটি এই contact-এর সাথে প্রথম কথোপকথন। প্রথম reply-তে নিজের পরিচয় দাও।'
    });
  }

  messages.push({ role: 'user', content: incomingBody });
  return messages;
}

export async function generateReply({ contactId, incomingBody, history = [] }) {
  const settings = getAllSettings();
  const isFirstReply = history.length === 0;

  const messages = buildMessages({
    systemPrompt: settings.systemPrompt,
    history,
    incomingBody,
    isFirstReply
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
      reply: config.defaults.fallbackMessage,
      promptTokens: 0,
      completionTokens: 0,
      fallback: true
    };
  }
}

export default { generateReply };
