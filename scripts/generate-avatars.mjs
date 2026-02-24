/**
 * Generate AI agent avatar headshots using Gemini Imagen 3.
 * 
 * Usage: node scripts/generate-avatars.mjs
 * Requires: GOOGLE_AI_API_KEY env var
 * Output: packages/dashboard/public/avatars/<role>.png
 */

import { GoogleGenAI } from '@google/genai';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const AVATARS_DIR = join(import.meta.dirname, '..', 'packages', 'dashboard', 'public', 'avatars');

const apiKey = process.env.GOOGLE_AI_API_KEY;
if (!apiKey) {
  console.error('GOOGLE_AI_API_KEY not set');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

// Each agent: role key, name, appearance description for consistent diverse cast
const AGENTS = [
  // ── Executives ──
  { role: 'chief-of-staff', name: 'Sarah Chen', desc: 'East Asian woman, early 30s, sharp bob haircut, confident warm expression, dark hair' },
  { role: 'cto', name: 'Marcus Reeves', desc: 'Black man, late 30s, short fade haircut, glasses with thin frames, thoughtful expression' },
  { role: 'cpo', name: 'Elena Vasquez', desc: 'Latina woman, mid 30s, wavy shoulder-length brown hair, bright curious expression' },
  { role: 'cfo', name: 'Nadia Okafor', desc: 'Nigerian woman, early 40s, natural hair in a neat updo, composed authoritative expression' },
  { role: 'cmo', name: 'Maya Brooks', desc: 'mixed-race woman, late 20s, curly medium-length hair, creative stylish look, warm smile' },
  { role: 'vp-customer-success', name: 'James Turner', desc: 'white man, mid 30s, neatly styled brown hair, friendly approachable expression, light stubble' },
  { role: 'vp-sales', name: 'Rachel Kim', desc: 'Korean American woman, early 30s, straight dark hair past shoulders, polished professional look' },
  { role: 'vp-design', name: 'Mia Tanaka', desc: 'Japanese American woman, late 20s, sleek asymmetric haircut, trendy minimalist aesthetic' },

  // ── Engineering ──
  { role: 'platform-engineer', name: 'Alex Park', desc: 'Korean American man, mid 20s, casual messy hair, relaxed t-shirt vibe, friendly grin' },
  { role: 'quality-engineer', name: 'Sam DeLuca', desc: 'Italian American man, late 20s, short dark curly hair, attentive focused expression' },
  { role: 'devops-engineer', name: 'Jordan Hayes', desc: 'white nonbinary person, late 20s, short undercut hairstyle, calm collected expression' },
  { role: 'm365-admin', name: 'Riley Morgan', desc: 'white woman, early 30s, light brown hair in a practical bun, organized confident expression, clean professional look' },

  // ── Product ──
  { role: 'user-researcher', name: 'Priya Sharma', desc: 'South Asian woman, late 20s, long dark hair, inquisitive empathetic expression, nose stud' },
  { role: 'competitive-intel', name: 'Daniel Ortiz', desc: 'Latino man, early 30s, well-groomed beard, dark wavy hair, sharp analytical gaze' },

  // ── Finance ──
  { role: 'revenue-analyst', name: 'Anna Park', desc: 'East Asian woman, early 30s, straight black hair in low ponytail, precise composed look' },
  { role: 'cost-analyst', name: 'Omar Hassan', desc: 'Middle Eastern man, late 20s, neatly trimmed beard, dark hair, serious but warm' },

  // ── Marketing ──
  { role: 'content-creator', name: 'Tyler Reed', desc: 'white man, mid 20s, sandy blond hair, creative casual style, warm expressive eyes' },
  { role: 'seo-analyst', name: 'Lisa Chen', desc: 'Chinese American woman, late 20s, glasses, straight dark hair with bangs, analytical look' },
  { role: 'social-media-manager', name: 'Kai Johnson', desc: 'Black man, mid 20s, trendy low fade, bright energetic smile, stylish look' },

  // ── Customer Success ──
  { role: 'onboarding-specialist', name: 'Emma Wright', desc: 'white woman, late 20s, auburn wavy hair, warm inviting smile, approachable' },
  { role: 'support-triage', name: 'David Santos', desc: 'Filipino man, early 30s, short neat black hair, patient calm expression, kind eyes' },

  // ── Sales ──
  { role: 'account-research', name: 'Nathan Cole', desc: 'white man, early 30s, dark brown hair neatly combed, sharp professional look, blue eyes' },

  // ── Design ──
  { role: 'ui-ux-designer', name: 'Leo Vargas', desc: 'Latino man, late 20s, artistic style, medium-length wavy dark hair, creative expression' },
  { role: 'frontend-engineer', name: 'Ava Chen', desc: 'Chinese American woman, mid 20s, short pixie cut, modern aesthetic, focused determined look' },
  { role: 'design-critic', name: 'Sofia Marchetti', desc: 'Italian woman, early 30s, elegant dark hair in loose waves, refined discerning expression' },
  { role: 'template-architect', name: 'Ryan Park', desc: 'Korean American man, late 20s, clean cut look, structured style, precise focused expression' },

  // ── Operations ──
  { role: 'ops', name: 'Atlas Vega', desc: 'androgynous person, mid 30s, silver-streaked dark hair, calm watchful eyes, neutral composed' },
];

function buildPrompt(agent) {
  return `Professional corporate headshot portrait photo of ${agent.desc}. ` +
    `Clean solid neutral background, soft studio lighting, shot from chest up. ` +
    `High quality, photorealistic, corporate photography style. ` +
    `The person looks like a tech industry professional. ` +
    `No text, no watermark, no logo.`;
}

async function generateAvatar(agent) {
  const prompt = buildPrompt(agent);
  console.log(`Generating ${agent.name} (${agent.role})...`);

  try {
    const response = await ai.models.generateImages({
      model: 'imagen-4.0-generate-001',
      prompt,
      config: {
        numberOfImages: 1,
        aspectRatio: '1:1',
      },
    });

    const image = response.generatedImages?.[0];
    if (!image?.image?.imageBytes) {
      console.error(`  No image returned for ${agent.name}`);
      return false;
    }

    const outPath = join(AVATARS_DIR, `${agent.role}.png`);
    writeFileSync(outPath, Buffer.from(image.image.imageBytes, 'base64'));
    console.log(`  Saved ${outPath}`);
    return true;
  } catch (err) {
    console.error(`  Failed for ${agent.name}: ${err.message}`);
    return false;
  }
}

async function main() {
  mkdirSync(AVATARS_DIR, { recursive: true });

  // Check which avatars already exist (skip regeneration)
  const toGenerate = AGENTS.filter(a => {
    const existsPng = existsSync(join(AVATARS_DIR, `${a.role}.png`));
    const existsJpg = existsSync(join(AVATARS_DIR, `${a.role}.jpg`));
    if (existsPng || existsJpg) console.log(`Skipping ${a.name} (${a.role}) — already exists`);
    return !existsPng && !existsJpg;
  });

  if (toGenerate.length === 0) {
    console.log('All avatars already generated!');
    return;
  }

  console.log(`\nGenerating ${toGenerate.length} avatars...\n`);

  let success = 0;
  let failed = 0;

  // Sequential to avoid rate limits
  for (const agent of toGenerate) {
    const ok = await generateAvatar(agent);
    if (ok) success++;
    else failed++;

    // Small delay between requests
    await new Promise(r => setTimeout(r, 1500));
  }

  console.log(`\nDone! ${success} generated, ${failed} failed.`);
}

main().catch(console.error);
