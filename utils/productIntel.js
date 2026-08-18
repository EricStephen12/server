const { sql } = require('../db/index');

// Model routing by plan
const VISION_MODELS = {
  creator: 'qwen/qwen3-vl-32b-instruct',  // Qwen for Creator
  studio:  'anthropic/claude-sonnet-5',   // Premium Claude vision
  free:    'qwen/qwen3-vl-32b-instruct',  // Fallback
};

async function identifyProduct(frames, plan = 'free', transcript = '') {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OpenRouter API Key is missing for Product Identification');
  }

  const visionModel = VISION_MODELS[plan] || VISION_MODELS['free'];
  console.log(`[Product Intel] Using model: ${visionModel} for plan: ${plan}`);

  const selectKeyFrames = (allFrames) => {
    if (allFrames.length <= 5) return allFrames;
    const step = Math.floor(allFrames.length / 5);
    return [
      allFrames[0],
      allFrames[step],
      allFrames[step * 2],
      allFrames[step * 3],
      allFrames[allFrames.length - 1]
    ];
  };

  const keyFrames = selectKeyFrames(frames);

  const transcriptHint = transcript
    ? `\n\nAUDIO TRANSCRIPT (what is spoken in the video): "${transcript}"\nUse this to confirm or refine what you see visually. If the speaker mentions a specific product name, brand, or material, that takes priority over visual inference.`
    : '';

  const systemPrompt = `You are a product sourcing expert and market analyst.
Your only job is to look at these video frames and identify the physical product or digital service being shown or sold.${transcriptHint}

Output valid JSON ONLY. No markdown formatting, no backticks, no explanations.

REQUIRED JSON STRUCTURE:
{
  "productName": "The specific name of the product if visible, otherwise a highly descriptive generic name (e.g. 'Adjustable Posture Corrector Brace')",
  "category": "The broad e-commerce category (e.g. 'Health & Wellness', 'Tech Gadgets', 'Beauty')",
  "visualAttributes": ["List of 3-5 key visual descriptors, like color, shape, materials, or unique features"],
  "targetAudience": "Who is the obvious target market based on how it's presented?"
}`;

  const messages = [
    {
      role: 'user',
      content: [
        { type: 'text', text: systemPrompt },
        ...keyFrames.map((frame) => ({
          type: 'image_url',
          image_url: {
            url: `data:${frame.mimeType};base64,${frame.base64}`
          }
        }))
      ]
    }
  ];

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://eixora.com',
        'X-Title': 'Eixora Mobile',
      },
      body: JSON.stringify({
        model: visionModel,
        messages,
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 1000,
      })
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenRouter API error: ${response.status} - ${errText}`);
    }

    const completion = await response.json();
    const responseText = completion.choices[0]?.message?.content;
    
    if (!responseText) throw new Error('Empty response from AI');

    let cleanedText = responseText.trim();
    if (cleanedText.startsWith('\`\`\`json')) {
        cleanedText = cleanedText.replace(/^\`\`\`json/, '').replace(/\`\`\`$/, '').trim();
    } else if (cleanedText.startsWith('\`\`\`')) {
        cleanedText = cleanedText.replace(/^\`\`\`/, '').replace(/\`\`\`$/, '').trim();
    }

    return JSON.parse(cleanedText);

  } catch (error) {
    console.error('Product Identification error:', error);
    throw new Error(`Product Identification failed: ${error.message}`);
  }
}

async function performMarketResearch(productData) {
  if (!process.env.TAVILY_API_KEY) {
    console.warn('[Product Intel] TAVILY_API_KEY missing, skipping market research');
    return "Market research unavailable (API key missing).";
  }
  
  const productName = productData.productName || productData.category || "this product";
  console.log(`[Product Intel] Running Tavily search for: ${productName}`);

  const queries = [
    `${productName} competition and market saturation`,
    `${productName} tiktok trends viral products 2026`,
    `${productName} average price and target audience positioning`
  ];

  let combinedResearch = "";

  for (const query of queries) {
    try {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          api_key: process.env.TAVILY_API_KEY,
          query: query,
          search_depth: "basic",
          include_answer: true,
          max_results: 3
        })
      });

      if (response.ok) {
        const data = await response.json();
        combinedResearch += `\n\n--- SEARCH QUERY: ${query} ---\n`;
        combinedResearch += data.answer ? `Summary: ${data.answer}\n` : '';
        if (data.results && data.results.length > 0) {
           data.results.forEach(r => {
             combinedResearch += `- [${r.title}] ${r.content}\n`;
           });
        }
      }
    } catch (err) {
      console.error(`Tavily search failed for query: ${query}`, err);
    }
  }

  return combinedResearch.trim() || "No significant market research found.";
}

// Final pipeline function
async function generateProductIntel(frames, originalUrl, plan = 'free', transcript = '', userProfile = null) {
    console.log('[Product Intel] Step 1: Identifying Product...');
    const productData = await identifyProduct(frames, plan, transcript);
    console.log('[Product Intel] Product Identified:', productData.productName);
    
    console.log('[Product Intel] Step 2: Running Market Research...');
    const marketResearch = await performMarketResearch(productData);
    
    console.log('[Product Intel] Step 3: Final Intelligence Generation...');
    
    // Include transcript context in the system prompt when available
    const transcriptSection = transcript
      ? `\n\n- Audio Transcript (what is SPOKEN in the video): "${transcript}"\n  NOTE: The transcript often contains the actual product name, brand, price claims, and target customer language. Prioritize this over visual inference when there is any ambiguity.`
      : '';
    
    const userSection = userProfile
      ? `\n\n- User Brand Profile: Brand Stage: ${userProfile.brand_stage || 'DTC Operator'}, Aesthetic/Positioning: ${userProfile.brand_positioning || 'Clean Modern DTC'}, Production: ${userProfile.brand_style || 'UGC'}, Niche: ${userProfile.brand_niche || 'General'}, Focus: ${userProfile.primary_goal || 'Saturation Reads'}`
      : '';
    
    const systemPrompt = `You are the most expensive product sourcing consultant in ecommerce. You charge $5,000 for a single product evaluation. Serious brand founders and DTC operators pay because you tell them the truth before they waste money on inventory and ads — not what they want to hear.

VOICE: Write like you're on a call with someone about to wire $10,000 into inventory for this product, and you owe them total honesty, not encouragement. You have seen a thousand products rise and die. You are not impressed easily. If the product is weak, say so plainly and explain exactly why.

BANNED REGISTER: Never use vague hype language — "huge potential," "great opportunity," "trending up," without a specific number, timeframe, or comparison backing it. Never hedge with "could be" or "might work" without stating the actual condition that would make it work or fail.

YOU ARE EVALUATING A PRODUCT shown in a video, combined with real market research data provided to you.

INPUTS PROVIDED:
- Web search results covering: competitor/seller saturation, search trend direction, price range across sellers, any available review sentiment
- Original Product Data: ${JSON.stringify(productData)}
- Market Research Data: ${marketResearch}${transcriptSection}${userSection}

ACCURACY & QUALITATIVE SIGNALS:
- Do NOT fabricate or invent precise numeric competitor counts (e.g. do not invent "14 active ads in last 30 days" unless explicitly provided by search data).
- Use qualitative saturation signals based on pattern analysis:
  • "Low competitive signal"
  • "Moderate competitive signal"
  • "High competitive signal — consider a different angle"
- Include angle gap analysis: identify where generic angles are saturated vs. where untapped opportunity angles remain.

CRITICAL RULES:
- Every claim must trace back to specific data provided (frames or search results)
- Take a clear position — 'proceed', 'proceed on alternative angle', or 'walk away'
- This should read like an expert who protects the client from wasting money on dead product angles

Output as JSON ONLY matching this EXACT structure:
{
  "productName": "${productData.productName}",
  "category": "${productData.category}",
  "marketStage": "<Emerging | Growing | Peak | Saturated | Declining>",
  "competitiveSignal": "<Low competitive signal | Moderate competitive signal | High competitive signal — consider a different angle>",
  "saturationScore": <1-10 with 0.1 precision>,
  "audiencePainFitScore": <1-10 with 0.1 precision>,
  "profitViabilityScore": <1-10 with 0.1 precision>,
  "verdict": "<One sentence stating clearly: sell this now, test this on alternative angle, or walk away>",
  "angleGapOpportunity": "<Specific angle or positioning gap where opportunity remains vs generic saturated angle>",
  "marketPosition": "<Where this product sits in the current market cycle>",
  "saturationReality": "<Qualitative saturation assessment explaining the competitor density and angle viability>",
  "audienceAndPainPoint": "<Who buys this and the core pain point addressed>",
  "authenticityCheck": "<Genuine problem-solver vs short-term gimmick analysis>",
  "moneyRisk": "<The single biggest commercial failure risk to mitigate>",
  "actionableSteps": [
    "<specific action 1>",
    "<specific action 2>",
    "<specific action 3>"
  ],
  "bottomLine": {
    "truth": "<single blunt sentence stating the core truth>",
    "watchFor": "<key signal to monitor over next 30-60 days>"
  }
}`;

    // Re-use selectKeyFrames logic here or just pass original 5 frames
    const step = Math.floor(frames.length / 5);
    const keyFrames = frames.length <= 5 ? frames : [
      frames[0], frames[step], frames[step * 2], frames[step * 3], frames[frames.length - 1]
    ];

    const messages = [
        {
            role: 'user',
            content: [
                { type: 'text', text: systemPrompt },
                ...keyFrames.map((frame) => ({
                    type: 'image_url',
                    image_url: {
                        url: `data:${frame.mimeType};base64,${frame.base64}`
                    }
                }))
            ]
        }
    ];

    const visionModel = VISION_MODELS[plan] || VISION_MODELS['free'];
    
    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://eixora.com',
                'X-Title': 'Eixora Mobile',
            },
            body: JSON.stringify({
                model: visionModel,
                messages,
                response_format: { type: 'json_object' },
                temperature: 0.2,
                max_tokens: 2500,
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`OpenRouter API error (Intel step): ${response.status} - ${errText}`);
        }

        const completion = await response.json();
        const responseText = completion.choices[0]?.message?.content;
        
        let cleanedText = responseText.trim();
        if (cleanedText.startsWith('\`\`\`json')) {
            cleanedText = cleanedText.replace(/^\`\`\`json/, '').replace(/\`\`\`$/, '').trim();
        } else if (cleanedText.startsWith('\`\`\`')) {
            cleanedText = cleanedText.replace(/^\`\`\`/, '').replace(/\`\`\`$/, '').trim();
        }

        const finalIntel = JSON.parse(cleanedText);
        
        // Wrap it in a structure that the frontend can interpret as product intelligence mode
        return {
            mode: 'product-intel',
            status: 'completed',
            productName: productData.productName,
            category: productData.category,
            visualAttributes: productData.visualAttributes,
            transcript: transcript || null,
            raw_market_research: marketResearch,
            ...finalIntel
        };
    } catch (err) {
        console.error('Final Product Intel step failed:', err);
        throw new Error(`Product Intelligence generation failed: ${err.message}`);
    }
}

module.exports = { identifyProduct, performMarketResearch, generateProductIntel };
