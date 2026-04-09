import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { GoogleGenAI } from '@google/genai';
import { Storage } from '@google-cloud/storage';

type VideoJobContext = {
  agentRole: string;
};

function resolveGeminiApiKey(): string | null {
  return process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY ?? null;
}

function resolveBucketName(): string {
  return (process.env.GCS_BUCKET || 'glyphor-company').trim();
}

function resolveElevenLabsApiKey(): string | null {
  return process.env.ELEVENLABS_API_KEY ?? null;
}

function resolveElevenLabsBaseUrl(): string {
  return (process.env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io').trim().replace(/\/$/, '');
}

function normalizeAspectRatio(value: unknown): '16:9' | '9:16' {
  return value === '9:16' ? '9:16' : '16:9';
}

function inferAudioFileExt(contentType: string | null): string {
  if (!contentType) return 'mp3';
  const normalized = contentType.toLowerCase();
  if (normalized.includes('wav')) return 'wav';
  if (normalized.includes('ogg')) return 'ogg';
  if (normalized.includes('aac')) return 'aac';
  if (normalized.includes('flac')) return 'flac';
  return 'mp3';
}

function parseGcsUri(uri: string): { bucket: string; objectPath: string } | null {
  const match = uri.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!match) return null;
  return { bucket: match[1], objectPath: match[2] };
}

async function downloadFromGCS(uri: string): Promise<Buffer> {
  const parsed = parseGcsUri(uri);
  if (!parsed) {
    throw new Error('referenceImage must be a gs:// URI');
  }

  const storage = new Storage({ projectId: process.env.GCP_PROJECT_ID || 'ai-glyphor-company' });
  const [bytes] = await storage.bucket(parsed.bucket).file(parsed.objectPath).download();
  return bytes;
}

async function uploadToGCS(path: string, content: Buffer, contentType: string): Promise<string> {
  const storage = new Storage({ projectId: process.env.GCP_PROJECT_ID || 'ai-glyphor-company' });
  const bucketName = resolveBucketName();
  const file = storage.bucket(bucketName).file(path);
  await file.save(content, { contentType, resumable: false });
  return `gs://${bucketName}/${path}`;
}

async function requestElevenLabsAudio(
  path: string,
  payload: Record<string, unknown>,
): Promise<{ buffer: Buffer; contentType: string }> {
  const apiKey = resolveElevenLabsApiKey();
  if (!apiKey) {
    throw new Error('ELEVENLABS_API_KEY is not configured');
  }

  const response = await fetch(`${resolveElevenLabsBaseUrl()}${path}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    throw new Error(`ElevenLabs returned ${response.status}: ${await response.text()}`);
  }

  const contentType = response.headers.get('content-type') || 'audio/mpeg';
  const arrayBuffer = await response.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), contentType };
}

async function enhancePromptWithGemini(rawPrompt: string): Promise<string> {
  const apiKey = resolveGeminiApiKey();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY or GOOGLE_AI_API_KEY is not configured');
  }

  const genai = new GoogleGenAI({ apiKey });
  const response = await genai.models.generateContent({
    model: 'gemini-3.1-flash-lite-preview',
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: [
              'Rewrite the following rough video prompt into a cinematic, production-ready Veo prompt.',
              'Return only the improved prompt text. No markdown, no explanation.',
              `Prompt: ${rawPrompt}`,
            ].join('\n'),
          },
        ],
      },
    ],
  });

  const enhanced = response.text?.trim();
  if (!enhanced) {
    throw new Error('Gemini returned an empty prompt enhancement');
  }
  return enhanced;
}

export function createVideoCreationTools(_jobContext: VideoJobContext): ToolDefinition[] {
  return [
    {
      name: 'generate_image',
      description: 'Generate a reference frame image for a storyboard scene using Imagen 4.',
      parameters: {
        prompt: {
          type: 'string',
          description: 'Imagen 4 image prompt',
          required: true,
        },
        sceneNumber: {
          type: 'number',
          description: 'Scene number in storyboard order',
          required: true,
        },
        jobId: {
          type: 'string',
          description: 'Video production job ID',
          required: true,
        },
        aspectRatio: {
          type: 'string',
          description: '16:9 or 9:16',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const apiKey = resolveGeminiApiKey();
          if (!apiKey) {
            return { success: false, error: 'GEMINI_API_KEY or GOOGLE_AI_API_KEY is not configured' };
          }

          const prompt = params.prompt as string;
          const sceneNumber = Number(params.sceneNumber);
          const jobId = params.jobId as string;
          const aspectRatio = normalizeAspectRatio(params.aspectRatio);

          if (!prompt?.trim()) return { success: false, error: 'prompt is required' };
          if (!jobId?.trim()) return { success: false, error: 'jobId is required' };
          if (!Number.isFinite(sceneNumber) || sceneNumber <= 0) {
            return { success: false, error: 'sceneNumber must be a positive number' };
          }

          const genai = new GoogleGenAI({ apiKey });
          const response = await genai.models.generateImages({
            model: 'imagen-4.0-fast-generate-001',
            prompt,
            config: {
              numberOfImages: 1,
              aspectRatio,
              outputMimeType: 'image/jpeg',
            },
          });

          const imageBytes = response.generatedImages?.[0]?.image?.imageBytes;
          if (!imageBytes) {
            return { success: false, error: 'Imagen returned no image bytes' };
          }

          const gcsPath = `ads/${jobId}/scenes/scene-${sceneNumber}/reference.jpg`;
          const gcsUri = await uploadToGCS(gcsPath, Buffer.from(imageBytes, 'base64'), 'image/jpeg');

          return {
            success: true,
            data: {
              gcsUri,
              sceneNumber,
              jobId,
              aspectRatio,
            },
          };
        } catch (err) {
          return { success: false, error: `generate_image failed: ${(err as Error).message}` };
        }
      },
    },
    {
      name: 'generate_video',
      description: 'Generate a video clip from an image using Veo 3.1 Fast. Returns an operation ID to poll.',
      parameters: {
        prompt: {
          type: 'string',
          description: 'Veo motion prompt',
          required: true,
        },
        referenceImage: {
          type: 'string',
          description: 'GCS URI of reference image',
          required: true,
        },
        sceneNumber: {
          type: 'number',
          description: 'Scene number in storyboard order',
          required: true,
        },
        jobId: {
          type: 'string',
          description: 'Video production job ID',
          required: true,
        },
        durationSeconds: {
          type: 'number',
          description: 'Clip duration in seconds (4-8)',
          required: false,
        },
        aspectRatio: {
          type: 'string',
          description: '16:9 or 9:16',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const apiKey = resolveGeminiApiKey();
          if (!apiKey) {
            return { success: false, error: 'GEMINI_API_KEY or GOOGLE_AI_API_KEY is not configured' };
          }

          const prompt = params.prompt as string;
          const referenceImage = params.referenceImage as string;
          const sceneNumber = Number(params.sceneNumber);
          const jobId = params.jobId as string;
          const durationSeconds = Math.min(Math.max(Number(params.durationSeconds) || 5, 4), 8);
          const aspectRatio = normalizeAspectRatio(params.aspectRatio);

          if (!prompt?.trim()) return { success: false, error: 'prompt is required' };
          if (!referenceImage?.trim()) return { success: false, error: 'referenceImage is required' };
          if (!jobId?.trim()) return { success: false, error: 'jobId is required' };
          if (!Number.isFinite(sceneNumber) || sceneNumber <= 0) {
            return { success: false, error: 'sceneNumber must be a positive number' };
          }

          const imageBytes = await downloadFromGCS(referenceImage);
          const genai = new GoogleGenAI({ apiKey });

          const operation = await (genai.models as any).generateVideos({
            model: 'veo-3.1-fast-generate-preview',
            prompt,
            image: {
              imageBytes: imageBytes.toString('base64'),
              mimeType: 'image/jpeg',
            },
            config: {
              durationSeconds,
              aspectRatio,
              resolution: '1080p',
              storageUri: `gs://${resolveBucketName()}/ads/${jobId}/scenes/scene-${sceneNumber}/`,
            },
          });

          const operationId = (operation as { name?: string })?.name;
          if (!operationId) {
            return { success: false, error: 'Veo did not return an operation ID' };
          }

          return {
            success: true,
            data: {
              operationId,
              sceneNumber,
              jobId,
            },
          };
        } catch (err) {
          return { success: false, error: `generate_video failed: ${(err as Error).message}` };
        }
      },
    },
    {
      name: 'poll_video_status',
      description: 'Check if a Veo video generation operation is complete.',
      parameters: {
        operationId: {
          type: 'string',
          description: 'Veo operation ID returned by generate_video',
          required: true,
        },
        sceneNumber: {
          type: 'number',
          description: 'Optional scene number context',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const apiKey = resolveGeminiApiKey();
          if (!apiKey) {
            return { success: false, error: 'GEMINI_API_KEY or GOOGLE_AI_API_KEY is not configured' };
          }

          const operationId = params.operationId as string;
          const sceneNumber = params.sceneNumber as number | undefined;
          if (!operationId?.trim()) return { success: false, error: 'operationId is required' };

          const genai = new GoogleGenAI({ apiKey });
          const operation = await (genai.operations as any).getVideosOperation({
            operation: { name: operationId },
          });

          if (!operation?.done) {
            return { success: true, data: { status: 'pending', operationId, sceneNumber } };
          }

          if (operation.error) {
            return {
              success: true,
              data: {
                status: 'failed',
                operationId,
                sceneNumber,
                error: operation.error.message || 'Video generation failed',
              },
            };
          }

          const videoUri = operation?.response?.generatedVideos?.[0]?.video?.uri as string | undefined;
          return {
            success: true,
            data: {
              status: 'complete',
              operationId,
              sceneNumber,
              gcsUri: videoUri,
            },
          };
        } catch (err) {
          return { success: false, error: `poll_video_status failed: ${(err as Error).message}` };
        }
      },
    },
    {
      name: 'generate_voiceover',
      description: 'Generate narration audio with ElevenLabs TTS and upload it to GCS.',
      parameters: {
        text: {
          type: 'string',
          description: 'Narration script for the voiceover',
          required: true,
        },
        voiceId: {
          type: 'string',
          description: 'ElevenLabs voice ID to use for synthesis',
          required: true,
        },
        sceneNumber: {
          type: 'number',
          description: 'Scene number in storyboard order',
          required: true,
        },
        jobId: {
          type: 'string',
          description: 'Video production job ID',
          required: true,
        },
        modelId: {
          type: 'string',
          description: 'Optional ElevenLabs model ID',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const text = params.text as string;
          const voiceId = params.voiceId as string;
          const sceneNumber = Number(params.sceneNumber);
          const jobId = params.jobId as string;
          const modelId = (params.modelId as string | undefined) || 'eleven_multilingual_v2';

          if (!text?.trim()) return { success: false, error: 'text is required' };
          if (!voiceId?.trim()) return { success: false, error: 'voiceId is required' };
          if (!jobId?.trim()) return { success: false, error: 'jobId is required' };
          if (!Number.isFinite(sceneNumber) || sceneNumber <= 0) {
            return { success: false, error: 'sceneNumber must be a positive number' };
          }

          const audio = await requestElevenLabsAudio(`/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
            text,
            model_id: modelId,
            output_format: 'mp3_44100_128',
          });

          const ext = inferAudioFileExt(audio.contentType);
          const gcsPath = `ads/${jobId}/scenes/scene-${sceneNumber}/voiceover.${ext}`;
          const gcsUri = await uploadToGCS(gcsPath, audio.buffer, audio.contentType);

          return {
            success: true,
            data: {
              gcsUri,
              sceneNumber,
              jobId,
              voiceId,
              modelId,
            },
          };
        } catch (err) {
          return { success: false, error: `generate_voiceover failed: ${(err as Error).message}` };
        }
      },
    },
    {
      name: 'generate_sfx',
      description: 'Generate sound effects with ElevenLabs and upload them to GCS.',
      parameters: {
        prompt: {
          type: 'string',
          description: 'Sound effect prompt',
          required: true,
        },
        sceneNumber: {
          type: 'number',
          description: 'Scene number in storyboard order',
          required: true,
        },
        jobId: {
          type: 'string',
          description: 'Video production job ID',
          required: true,
        },
        durationSeconds: {
          type: 'number',
          description: 'Desired SFX duration in seconds',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const prompt = params.prompt as string;
          const sceneNumber = Number(params.sceneNumber);
          const jobId = params.jobId as string;
          const durationSeconds = Number(params.durationSeconds) || 3;

          if (!prompt?.trim()) return { success: false, error: 'prompt is required' };
          if (!jobId?.trim()) return { success: false, error: 'jobId is required' };
          if (!Number.isFinite(sceneNumber) || sceneNumber <= 0) {
            return { success: false, error: 'sceneNumber must be a positive number' };
          }

          const audio = await requestElevenLabsAudio('/v1/sound-generation', {
            text: prompt,
            duration_seconds: Math.max(1, Math.min(Math.round(durationSeconds), 22)),
            output_format: 'mp3_44100_128',
          });

          const ext = inferAudioFileExt(audio.contentType);
          const gcsPath = `ads/${jobId}/scenes/scene-${sceneNumber}/sfx.${ext}`;
          const gcsUri = await uploadToGCS(gcsPath, audio.buffer, audio.contentType);

          return {
            success: true,
            data: {
              gcsUri,
              sceneNumber,
              jobId,
            },
          };
        } catch (err) {
          return { success: false, error: `generate_sfx failed: ${(err as Error).message}` };
        }
      },
    },
    {
      name: 'generate_music',
      description: 'Generate background music with ElevenLabs and upload it to GCS.',
      parameters: {
        prompt: {
          type: 'string',
          description: 'Music prompt describing vibe and instrumentation',
          required: true,
        },
        sceneNumber: {
          type: 'number',
          description: 'Scene number in storyboard order',
          required: true,
        },
        jobId: {
          type: 'string',
          description: 'Video production job ID',
          required: true,
        },
        durationSeconds: {
          type: 'number',
          description: 'Desired music duration in seconds',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const prompt = params.prompt as string;
          const sceneNumber = Number(params.sceneNumber);
          const jobId = params.jobId as string;
          const durationSeconds = Number(params.durationSeconds) || 10;

          if (!prompt?.trim()) return { success: false, error: 'prompt is required' };
          if (!jobId?.trim()) return { success: false, error: 'jobId is required' };
          if (!Number.isFinite(sceneNumber) || sceneNumber <= 0) {
            return { success: false, error: 'sceneNumber must be a positive number' };
          }

          const audio = await requestElevenLabsAudio('/v1/music', {
            prompt,
            duration_seconds: Math.max(3, Math.min(Math.round(durationSeconds), 180)),
            output_format: 'mp3_44100_128',
          });

          const ext = inferAudioFileExt(audio.contentType);
          const gcsPath = `ads/${jobId}/scenes/scene-${sceneNumber}/music.${ext}`;
          const gcsUri = await uploadToGCS(gcsPath, audio.buffer, audio.contentType);

          return {
            success: true,
            data: {
              gcsUri,
              sceneNumber,
              jobId,
            },
          };
        } catch (err) {
          return { success: false, error: `generate_music failed: ${(err as Error).message}` };
        }
      },
    },
    {
      name: 'enhance_video_prompt',
      description: 'Enhance a rough video prompt into a cinematic Veo-ready prompt.',
      parameters: {
        prompt: {
          type: 'string',
          description: 'Raw video prompt to enhance',
          required: true,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const prompt = params.prompt as string;
          if (!prompt?.trim()) return { success: false, error: 'prompt is required' };

          const enhancedPrompt = await enhancePromptWithGemini(prompt);
          return {
            success: true,
            data: {
              enhancedPrompt,
            },
          };
        } catch (err) {
          return { success: false, error: `enhance_video_prompt failed: ${(err as Error).message}` };
        }
      },
    },
  ];
}
