/**
 * Audio Resampler — PCM16 sample rate conversion for bridging
 * ACS/Teams media (16kHz) ↔ OpenAI Realtime (24kHz)
 *
 * Uses linear interpolation for real-time conversion.
 * PCM16 = 16-bit signed little-endian mono.
 */

/**
 * Resample PCM16 audio from 16kHz to 24kHz (3:2 ratio).
 * For every 2 input samples, produces 3 output samples.
 */
export function resample16to24(input: Buffer): Buffer {
  const inputSamples = input.length / 2;
  if (inputSamples === 0) return Buffer.alloc(0);

  const outputSamples = Math.floor(inputSamples * 3 / 2);
  const output = Buffer.alloc(outputSamples * 2);

  for (let i = 0; i < outputSamples; i++) {
    const srcPos = (i * 2) / 3;
    const srcIdx = Math.floor(srcPos);
    const frac = srcPos - srcIdx;

    const s0 = srcIdx < inputSamples ? input.readInt16LE(srcIdx * 2) : 0;
    const s1 = srcIdx + 1 < inputSamples ? input.readInt16LE((srcIdx + 1) * 2) : s0;

    const interpolated = Math.round(s0 + frac * (s1 - s0));
    output.writeInt16LE(Math.max(-32768, Math.min(32767, interpolated)), i * 2);
  }

  return output;
}

/**
 * Resample PCM16 audio from 24kHz to 16kHz (2:3 ratio).
 * For every 3 input samples, produces 2 output samples.
 */
export function resample24to16(input: Buffer): Buffer {
  const inputSamples = input.length / 2;
  if (inputSamples === 0) return Buffer.alloc(0);

  const outputSamples = Math.floor(inputSamples * 2 / 3);
  const output = Buffer.alloc(outputSamples * 2);

  for (let i = 0; i < outputSamples; i++) {
    const srcPos = (i * 3) / 2;
    const srcIdx = Math.floor(srcPos);
    const frac = srcPos - srcIdx;

    const s0 = srcIdx < inputSamples ? input.readInt16LE(srcIdx * 2) : 0;
    const s1 = srcIdx + 1 < inputSamples ? input.readInt16LE((srcIdx + 1) * 2) : s0;

    const interpolated = Math.round(s0 + frac * (s1 - s0));
    output.writeInt16LE(Math.max(-32768, Math.min(32767, interpolated)), i * 2);
  }

  return output;
}
