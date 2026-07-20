const { sql } = require('../db/index');

// Model routing by plan
const VISION_MODELS = {
  creator: 'qwen/qwen3-vl-32b-instruct',  // Qwen for Creator
  studio:  'anthropic/claude-sonnet-5',   // Premium Claude vision
  free:    'qwen/qwen3-vl-32b-instruct',  // Fallback
};

async function identifyProduct(frames, plan = 'free') {
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

  const systemPrompt = `You are a product sourcing expert and market analyst.
Your only job is to look at these video frames and identify the physical product or digital service being shown or sold.

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
async function generateProductIntel(frames, originalUrl, plan = 'free') {
    console.log('[Product Intel] Step 1: Identifying Product...');
    const productData = await identifyProduct(frames, plan);
    console.log('[Product Intel] Product Identified:', productData.productName);
    
    console.log('[Product Intel] Step 2: Running Market Research...');
    const marketResearch = await performMarketResearch(productData);
    
    console.log('[Product Intel] Step 3: Final Intelligence Generation...');
    
    const systemPrompt = `You are the most expensive product sourcing consultant in ecommerce. You charge $5,000 for a single product evaluation. Serious dropshippers and brand owners pay because you tell them the truth before they waste money on inventory and ads — not what they want to hear.

VOICE: Write like you're on a call with someone about to wire $10,000 into inventory for this product, and you owe them total honesty, not encouragement. You have seen a thousand products rise and die. You are not impressed easily. If the product is weak, say so plainly and explain exactly why.

BANNED REGISTER: Never use vague hype language — "huge potential," "great opportunity," "trending up," without a specific number, timeframe, or comparison backing it. Never hedge with "could be" or "might work" without stating the actual condition that would make it work or fail.

YOU ARE EVALUATING A PRODUCT shown in a video, combined with real market research data provided to you.

INPUTS PROVIDED:
- Web search results covering: competitor/seller saturation, search trend direction, price range across sellers, any available review sentiment
- Original Product Data: ${JSON.stringify(productData)}
- Market Research Data: ${marketResearch}

YOUR ANALYSIS MUST BE HYPER-SPECIFIC. Reference exact data points from the search results — actual numbers, actual competitor counts, actual trend directions. Never state a saturation or trend claim without citing what specifically supports it.

ACCURACY CHECK: If the search results are thin or inconclusive on a specific point, say so explicitly rather than inventing certainty. A false confident claim is worse than an honest 'the data here is limited, proceed carefully.'

CRITICAL RULES:
- Every claim must trace back to specific data provided (frames or search results) — never generic ecommerce advice
- Take a real position — 'proceed' or 'walk away,' not both-sides hedging
- If the data doesn't support confidence, say that clearly rather than performing certainty
- This should read like someone who has personally lost money on bad products before and refuses to let the client repeat that mistake

THE TEST: If a user reads only 'The Verdict' and 'The Bottom Line,' would they know clearly whether to spend money on this product or not? If it's still ambiguous, sharpen it.

Output as JSON ONLY matching this EXACT structure:
{
  "productName": "${productData.productName}",
  "category": "${productData.category}",
  "marketStage": "<Emerging | Growing | Peak | Saturated | Declining>",
  "saturationScore": <1-10 with 0.1 precision>,
  "audiencePainFitScore": <1-10 with 0.1 precision>,
  "profitViabilityScore": <1-10 with 0.1 precision>,
  "verdict": "<One sentence, under 15 words, stating clearly: sell this now, sell this cautiously, or walk away. No hedging>",
  "marketPosition": "<Where exactly this product sits right now — cite specific trend/search data found>",
  "saturationReality": "<Actual number of competing sellers/ads found in research, and what that density means practically>",
  "audienceAndPainPoint": "<Who buys this and why — referenced against frames and research>",
  "authenticityCheck": "<Does this look like a genuine solution or a gimmick/fad?>",
  "moneyRisk": "<The single biggest reason this product could fail commercially — name the ONE most likely failure mode>",
  "actionableSteps": [
    "<specific action 1>",
    "<specific action 2>",
    "<specific action 3>"
  ],
  "bottomLine": {
    "truth": "<single blunt sentence under 10 words stating the core truth>",
    "watchFor": "<what specifically to watch for over the next 30-60 days that would change this verdict>"
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
            raw_market_research: marketResearch,
            ...finalIntel
        };
    } catch (err) {
        console.error('Final Product Intel step failed:', err);
        throw new Error(`Product Intelligence generation failed: ${err.message}`);
    }
}

module.exports = { identifyProduct, performMarketResearch, generateProductIntel };
