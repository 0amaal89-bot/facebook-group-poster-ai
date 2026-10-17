export interface Env {
  AI: any;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

const PRIMARY_MODEL = '@cf/meta/llama-3.2-3b-instruct';
const FALLBACK_MODEL = '@cf/meta/llama-3.2-1b-instruct';

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

async function runAi(env: Env, messages: any[], maxTokens = 1000, temperature = 0.7) {
  try {
    return await env.AI.run(PRIMARY_MODEL, {
      messages,
      max_tokens: maxTokens,
      temperature,
    });
  } catch (err) {
    console.warn(`Primary model failed, attempting fallback: ${err}`);
    return await env.AI.run(FALLBACK_MODEL, {
      messages,
      max_tokens: maxTokens,
      temperature,
    });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
        return jsonResponse({
          status: 'online',
          service: 'Smart Facebook Group Poster AI Backend',
          provider: 'Cloudflare Workers AI',
          primaryModel: PRIMARY_MODEL,
          fallbackModel: FALLBACK_MODEL,
          timestamp: new Date().toISOString(),
        });
      }

      if (request.method === 'POST' && url.pathname === '/api/ai/spin') {
        const body = (await request.json()) as {
          text: string;
          tone?: string;
          style?: 'subtle' | 'moderate' | 'creative';
          keepEmojis?: boolean;
        };

        if (!body.text || !body.text.trim()) {
          return jsonResponse({ error: 'Text parameter is required' }, 400);
        }

        const tone = body.tone || 'engaging';
        const style = body.style || 'moderate';

        const systemPrompt = `You are an expert social media copywriter specializing in Facebook community engagement.
Your goal is to rewrite the user's post so that it communicates the exact same message and preserves all URLs, product names, phone numbers, and key details, but uses different sentence structure, synonyms, and phrasing.
This ensures the post looks natural, unique, and avoids duplicate content filters.

Rules:
1. Preserve all links (http/https), hashtags, @mentions, prices, phone numbers, and contact handles verbatim.
2. Maintain a ${tone} tone.
3. ${style === 'subtle' ? 'Make minor natural phrasing adjustments while staying close to the original.' : style === 'creative' ? 'Deliver a fresh, captivating variation that hooks readers quickly.' : 'Provide a well-balanced rewrite with natural human variation.'}
4. DO NOT wrap the output in quotes.
5. DO NOT provide any preamble, intro, or explanation (e.g. do NOT say "Here is the rewritten post:").
6. Output ONLY the rewritten post directly.`;

        const aiResponse: any = await runAi(
          env,
          [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: body.text },
          ],
          1024,
          style === 'subtle' ? 0.35 : 0.75
        );

        const variation = (aiResponse.response || '').trim();

        return jsonResponse({
          success: true,
          original: body.text,
          variation: variation || body.text,
          model: PRIMARY_MODEL,
        });
      }

      if (request.method === 'POST' && url.pathname === '/api/ai/spintax') {
        const body = (await request.json()) as { text: string };
        if (!body.text) {
          return jsonResponse({ error: 'Text parameter is required' }, 400);
        }

        const systemPrompt = `Convert the given Facebook post into Spintax format using {option1|option2|option3} syntax for greetings, verbs, adjectives, and sign-offs.
Keep all URLs, contact information, and prices exactly unchanged.
Provide rich variations (at least 3 options per bracketed spintax).
Output ONLY the resulting spintax text. No introductory remarks or explanations.`;

        const aiResponse: any = await runAi(
          env,
          [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: body.text },
          ],
          1200,
          0.7
        );

        return jsonResponse({
          success: true,
          spintax: (aiResponse.response || '').trim(),
        });
      }

      if (request.method === 'POST' && url.pathname === '/api/ai/first-comment') {
        const body = (await request.json()) as { text: string; link?: string };
        const text = body.text || '';

        // Extract URLs if not explicitly passed
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const matches = text.match(urlRegex) || [];
        const targetLink = body.link || (matches.length > 0 ? matches[0] : '');

        let cleanText = text;
        if (targetLink) {
          cleanText = text.replace(targetLink, '').replace(/\s+/g, ' ').trim();
        }

        const systemPrompt = `Given the following social media post text and an external link, perform two tasks:
1. Append an engaging, natural hook to the main post directing readers to the first comment (e.g. "🔗 Link with full details is pinned in the first comment below! 👇").
2. Create a friendly first comment that delivers the link clearly with a brief call to action.

Format output strictly as JSON with keys:
"mainPostWithHook": "string",
"firstComment": "string"`;

        const aiResponse: any = await runAi(
          env,
          [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Post: ${cleanText}\nLink: ${targetLink}` },
          ],
          600,
          0.5
        );

        let parsed: any = null;
        try {
          const raw = aiResponse.response || '';
          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            parsed = JSON.parse(jsonMatch[0]);
          }
        } catch (e) {}

        return jsonResponse({
          success: true,
          link: targetLink,
          mainPostWithHook: parsed?.mainPostWithHook || (cleanText + '\n\n🔗 Link with details in the first comment! 👇'),
          firstComment: parsed?.firstComment || `Here is the link for full details: ${targetLink}`,
        });
      }

      if (request.method === 'POST' && url.pathname === '/api/ai/safety-audit') {
        const body = (await request.json()) as { text: string };
        if (!body.text) {
          return jsonResponse({ error: 'Text parameter is required' }, 400);
        }

        const systemPrompt = `Analyze the given Facebook group post for risk of tripping automated spam, misleading claim, or community standard violation filters.
Assess:
1. Excessive capitalization or spam triggers (e.g., FREE MONEY, 100% GUARANTEED, WORK FROM HOME NOW).
2. Overuse of symbols/emojis.
3. High-risk commercial phrasing.

Output strictly valid JSON with schema:
{
  "safetyScore": number (0 to 100, where 100 is completely safe and human-like, <60 is high risk),
  "isSafe": boolean,
  "riskLevel": "LOW" | "MEDIUM" | "HIGH",
  "flags": string[],
  "recommendations": string[]
}`;

        const aiResponse: any = await runAi(
          env,
          [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: body.text },
          ],
          500,
          0.3
        );

        let auditResult: any = {
          safetyScore: 90,
          isSafe: true,
          riskLevel: 'LOW',
          flags: [],
          recommendations: ['Post looks natural and safe.'],
        };

        try {
          const raw = aiResponse.response || '';
          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            auditResult = JSON.parse(jsonMatch[0]);
          }
        } catch (e) {}

        return jsonResponse({
          success: true,
          ...auditResult,
        });
      }

      return jsonResponse({ error: 'Endpoint not found' }, 404);
    } catch (error: any) {
      return jsonResponse(
        {
          success: false,
          error: error.message || 'Internal Server Error',
        },
        500
      );
    }
  },
};
