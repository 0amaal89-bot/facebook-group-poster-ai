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
          language?: 'auto' | 'darija' | 'arabic' | 'french' | 'english';
          keepEmojis?: boolean;
        };

        if (!body.text || !body.text.trim()) {
          return jsonResponse({ error: 'Text parameter is required' }, 400);
        }

        const rawText = body.text.trim();
        const tone = body.tone || 'engaging';
        const style = body.style || 'moderate';

        // If the text is purely a URL, do not hallucinate an English essay
        const isOnlyUrl = /^https?:\/\/[^\s]+$/i.test(rawText);
        if (isOnlyUrl) {
          return jsonResponse({
            success: true,
            original: rawText,
            variation: rawText,
            model: 'bypass_raw_url',
          });
        }

        const languageInstruction = (() => {
          if (body.language === 'darija') {
            return `MANDATORY LANGUAGE RULE: You MUST write the output strictly in Moroccan Arabic (Darija بالدارجة المغربية).
Use natural Moroccan Darija terms (خوتي, الإخوان, سلام عليكم, همزة, مرحبا بكم, شوفو هاد البوست, تفاصيل هنا, الخ).
DO NOT translate or write in English!`;
          }
          if (body.language === 'arabic') {
            return `MANDATORY LANGUAGE RULE: You MUST write the output strictly in Standard Arabic (اللغة العربية).
DO NOT translate to English!`;
          }
          if (body.language === 'french') {
            return `MANDATORY LANGUAGE RULE: You MUST write the output strictly in French (en français).
DO NOT translate to English!`;
          }
          if (body.language === 'english') {
            return `MANDATORY LANGUAGE RULE: You MUST write the output strictly in English.`;
          }
          // Default: Auto-detect and match input language strictly
          return `MANDATORY LANGUAGE FIDELITY RULE:
1. Detect the exact language and dialect of the user's text.
2. If the user writes in Moroccan Arabic (Darija - الدارجة المغربية), you MUST rewrite strictly in Moroccan Darija!
3. If the user writes in Arabic, you MUST rewrite strictly in Arabic!
4. If the user writes in French, you MUST rewrite strictly in French!
5. NEVER switch or translate to English unless the input text is already in English!
6. The target audience is Facebook groups (e.g. Moroccan community groups). Maintain the authentic regional dialect.`;
        })();

        const systemPrompt = `You are an expert social media copywriter specializing in Facebook community engagement.
Your goal is to rewrite the user's post so that it communicates the exact same message and preserves all URLs, product names, phone numbers, prices, and key details, but uses different phrasing, synonyms, and natural sentence structures.

${languageInstruction}

Rules:
1. Preserve all links (http/https), hashtags, @mentions, prices, phone numbers, and contact handles verbatim.
2. Maintain a ${tone} tone.
3. ${style === 'subtle' ? 'Make minor natural phrasing adjustments while staying close to the original.' : style === 'creative' ? 'Deliver a fresh, captivating variation that hooks readers quickly.' : 'Provide a well-balanced rewrite with natural human variation.'}
4. DO NOT wrap the output in quotes.
5. DO NOT provide any preamble, intro, or explanation (e.g. do NOT say "Here is the rewritten post:").
6. Output ONLY the rewritten post directly in the matching language.`;

        const aiResponse: any = await runAi(
          env,
          [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: rawText },
          ],
          1024,
          style === 'subtle' ? 0.35 : 0.7
        );

        const variation = (aiResponse.response || '').trim();

        return jsonResponse({
          success: true,
          original: rawText,
          variation: variation || rawText,
          model: PRIMARY_MODEL,
        });
      }

      if (request.method === 'POST' && url.pathname === '/api/ai/spintax') {
        const body = (await request.json()) as { text: string; language?: string };
        if (!body.text) {
          return jsonResponse({ error: 'Text parameter is required' }, 400);
        }

        const systemPrompt = `Convert the given Facebook post into Spintax format using {option1|option2|option3} syntax for greetings, verbs, adjectives, and sign-offs.
Keep the EXACT language and dialect of the input text (e.g. if Moroccan Darija, generate Darija spintax options like {سلام خوتي|سلام عليكم|أهلا الإخوان}).
Keep all URLs, contact information, and prices exactly unchanged.
Provide rich variations (at least 3 options per bracketed spintax).
Output ONLY the resulting spintax text. No introductory remarks.`;

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
        const body = (await request.json()) as { text: string; link?: string; language?: string };
        const text = body.text || '';

        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const matches = text.match(urlRegex) || [];
        const targetLink = body.link || (matches.length > 0 ? matches[0] : '');

        let cleanText = text;
        if (targetLink) {
          cleanText = text.replace(targetLink, '').replace(/\s+/g, ' ').trim();
        }

        const isArabicOrDarija = /[\u0600-\u06FF]/.test(cleanText);

        const systemPrompt = isArabicOrDarija
          ? `قم بإنشاء تعليق أول يحتوي على الرابط (${targetLink}) وإضافة عبارة تشويقية في المنشور تدعو لقراءة أول تعليق بالدارجة المغربية أو العربية.
Format output strictly as JSON with keys:
"mainPostWithHook": "string",
"firstComment": "string"`
          : `Given the following social media post text and an external link, perform two tasks:
1. Append an engaging hook to the main post directing readers to the first comment.
2. Create a friendly first comment that delivers the link clearly.
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

        const defaultHook = isArabicOrDarija
          ? `${cleanText}\n\n🔗 الرابط والتفاصيل كاملة فـ أول تعليق! 👇`
          : `${cleanText}\n\n🔗 Link with full details is pinned in the first comment below! 👇`;

        const defaultComment = isArabicOrDarija
          ? `ها هو الرابط للتفاصيل الكاملة: ${targetLink}`
          : `Here is the link for full details: ${targetLink}`;

        return jsonResponse({
          success: true,
          link: targetLink,
          mainPostWithHook: parsed?.mainPostWithHook || defaultHook,
          firstComment: parsed?.firstComment || defaultComment,
        });
      }

      if (request.method === 'POST' && url.pathname === '/api/ai/safety-audit') {
        const body = (await request.json()) as { text: string };
        if (!body.text) {
          return jsonResponse({ error: 'Text parameter is required' }, 400);
        }

        const systemPrompt = `Analyze the given Facebook group post for risk of tripping automated spam, misleading claim, or community standard violation filters.
Assess excessive capitalization, spam triggers, and risky phrasing in Arabic, French, or English.
Output strictly valid JSON with schema:
{
  "safetyScore": number (0 to 100),
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
