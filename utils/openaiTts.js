/**
 * Fast cloud TTS via OpenAI (ChatGPT-class latency for short voice replies).
 * Used when TTS_PROVIDER=openai (or auto + OPENAI_API_KEY is set).
 */
const axios = require('axios');

const OPENAI_VOICES = new Set(['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer']);

/** Map Kokoro / legacy voice ids → OpenAI voices */
function mapOpenAiVoice(voice) {
  const v = (voice || '').toLowerCase();
  if (OPENAI_VOICES.has(v)) return v;
  const aliases = {
    af_heart: 'nova',
    af_bella: 'shimmer',
    af_sarah: 'coral',
    am_adam: 'onyx',
    am_michael: 'echo',
    bf_emma: 'alloy',
    bm_george: 'ash',
  };
  return aliases[v] || process.env.OPENAI_TTS_VOICE || 'nova';
}

function useOpenAiTts() {
  // Custom Kokoro is the default product voice. OpenAI only if explicitly opted in.
  const provider = (process.env.TTS_PROVIDER || 'kokoro').toLowerCase();
  return provider === 'openai' && Boolean(process.env.OPENAI_API_KEY);
}

/**
 * @param {{ text: string, voice?: string }} opts
 * @returns {Promise<{ buffer: Buffer, contentType: string, provider: string }>}
 */
async function synthesizeOpenAiSpeech({ text, voice }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const model = process.env.OPENAI_TTS_MODEL || 'tts-1'; // tts-1 = lowest latency
  const mappedVoice = mapOpenAiVoice(voice);

  const response = await axios({
    method: 'post',
    url: 'https://api.openai.com/v1/audio/speech',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    data: {
      model,
      input: text,
      voice: mappedVoice,
      response_format: 'mp3',
      speed: 1.0,
    },
    responseType: 'arraybuffer',
    timeout: 30000,
  });

  return {
    buffer: Buffer.from(response.data),
    contentType: 'audio/mpeg',
    provider: 'openai',
    voice: mappedVoice,
    model,
  };
}

module.exports = {
  useOpenAiTts,
  synthesizeOpenAiSpeech,
  mapOpenAiVoice,
};
