const Groq = require('groq-sdk');

/**
 * Analyze video frames using Groq Vision API (Llama 3.2 Multimodal)
 * @param {Array} frames - Array of frame objects with {timestamp, base64, mimeType}
 * @param {string} productContext - Context about the product being advertised
 * @returns {Promise<Object>} - Detailed visual analysis
 */
async function analyzeVideoFrames(frames, productContext = '', transcript = '') {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('Groq API Key is missing for Vision Analysis');
  }

  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  // Prepare contents for Groq Multimodal
  const messages = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `You are an Elite Direct-Response Creative Director analyzing a TikTok ad. 
${productContext ? `Product Context: ${productContext}` : ''}
${transcript ? `SPOKEN TRANSCRIPT (AUDIO DNA): "${transcript}"` : 'No audio transcript detected.'}

I'm providing you with ${frames.length} frames extracted across the video.

Analyze the visual structure AND how it aligns with the spoken script:

1. **Eugene Schwartz's Level of Awareness**: Identify which level this ad targets.
2. **Ogilvy's "Big Idea"**: What is the core concept?
3. **Hook Power (0-3s)**: Grade the stop-rate potential (1-10) of both the visual hook and the spoken hook.
4. **Retention Score**: Grade the frame-by-frame pacing and audio/visual synergy.
5. **Conversion Trigger**: Grade the strength of the CTA and offer logic.
6. **The Vibe**: Is it "Guerilla UGC" or "High-Production"? How does the audio tone match the visuals?

Output as JSON with this EXACT structure:
{
  "metrics": {
    "hook_power": 8.5,
    "retention_score": 7.2,
    "conversion_trigger": 9.0
  },
  "niche": "...",
  "awareness_level": "Problem-Aware",
  "big_idea": "...",
  "vibe_assessment": {
    "style": "Guerilla UGC",
    "emotional_arc": "...",
    "critique": "..."
  },
  "hook_analysis": {
    "critique": "...",
    "suggestion": "..."
  },
  "pacing_analysis": {
    "critique": "..."
  },
  "cta_analysis": {
    "critique": "..."
  },
  "psychology_breakdown": {
    "trigger": "...",
    "explanation": "..."
  },
  "viral_checklist": [
    { "label": "Pattern Interrupt", "passed": true },
    { "label": "Big Idea Present", "passed": true },
    { "label": "Awareness Sync", "passed": true },
    { "label": "Strong CTA", "passed": false }
  ],
  "actionable_directions": [
    "Tip 1...",
    "Tip 2..."
  ]
}
`
        },
        ...frames.map(frame => ({
          type: 'image_url',
          image_url: {
            url: `data:${frame.mimeType};base64,${frame.base64}`
          }
        }))
      ]
    }
  ];

  try {
    const completion = await groq.chat.completions.create({
      messages,
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      response_format: { type: 'json_object' },
      temperature: 0.2,
    });

    const responseText = completion.choices[0]?.message?.content;
    if (!responseText) throw new Error('Empty response from Groq Vision');

    return JSON.parse(responseText);

  } catch (error) {
    console.error('Groq Vision analysis error:', error);
    throw new Error(`Video analysis failed: ${error.message}`);
  }
}

module.exports = { analyzeVideoFrames };
