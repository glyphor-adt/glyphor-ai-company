import { describe, expect, it } from 'vitest';
import { applyV4APatch, parseV4APatch } from '../v4aDiff.js';

describe('v4aDiff', () => {
  it('applies replace and insert operations in order', () => {
    const patch = parseV4APatch({
      version: 'v4a-diff-v1',
      files: [
        {
          path: 'src/example.ts',
          operations: [
            { type: 'replace', oldText: 'hello', newText: 'hi' },
            { type: 'insert_after', anchor: 'hi', newText: ' there' },
          ],
        },
      ],
    });

    const next = applyV4APatch('hello world', patch.files[0]);
    expect(next).toBe('hi there world');
  });

  it('supports replace_entire for new file creation flows', () => {
    const patch = parseV4APatch({
      version: 'v4a-diff-v1',
      files: [
        {
          path: 'src/new.ts',
          operations: [
            { type: 'replace_entire', newText: 'export const value = 1;\n' },
          ],
        },
      ],
    });

    expect(applyV4APatch('', patch.files[0])).toBe('export const value = 1;\n');
  });
});
