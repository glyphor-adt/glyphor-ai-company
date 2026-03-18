/**
 * ChatMarkdown — Markdown renderer with inline image/video support.
 *
 * Wraps react-markdown with custom component overrides that:
 *  1. Render <img> tags with click-to-open-fullsize behaviour
 *  2. Auto-detect bare image URLs in <a> tags (media.glyphor.ai, common image extensions)
 *     and render them as inline images instead of plain links
 */

import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { normalizeText } from '../lib/normalizeText';

const IMAGE_URL_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)(\?.*)?$/i;
const MEDIA_HOSTS = ['media.glyphor.ai', 'imagedelivery.net', 'cloudflareimages.com'];
const VIDEO_EXT_RE = /\.(mp4|webm|mov)(\?.*)?$/i;

/** Turn bare media-host URLs into markdown image syntax so react-markdown renders them */
const BARE_MEDIA_URL_RE = /(?<![(\[!])(https?:\/\/(?:media\.glyphor\.ai|imagedelivery\.net|cloudflareimages\.com)[^\s)>\]]+)/gi;
function preProcessContent(text: string): string {
  const normalized = normalizeText(text);
  return normalized.replace(BARE_MEDIA_URL_RE, (raw) => {
    // Strip trailing sentence punctuation that isn't part of the URL
    const url = raw.replace(/[.,;:!?]+$/, '');
    return `![Generated image](${url})`;
  });
}

function isImageUrl(href: string): boolean {
  try {
    const url = new URL(href, 'https://placeholder.invalid');
    if (MEDIA_HOSTS.some((h) => url.hostname.endsWith(h))) return true;
    return IMAGE_URL_RE.test(url.pathname);
  } catch {
    return IMAGE_URL_RE.test(href);
  }
}

function isVideoUrl(href: string): boolean {
  try {
    const url = new URL(href, 'https://placeholder.invalid');
    return VIDEO_EXT_RE.test(url.pathname);
  } catch {
    return VIDEO_EXT_RE.test(href);
  }
}

const components: Components = {
  img({ src, alt, ...rest }) {
    if (!src) return null;
    return (
      <img
        src={src}
        alt={alt ?? 'Generated image'}
        loading="lazy"
        onClick={() => window.open(src, '_blank', 'noopener')}
        title="Click to open full size"
        {...rest}
      />
    );
  },

  a({ href, children, ...rest }) {
    if (!href) return <a {...rest}>{children}</a>;

    // Auto-detect image URLs and render inline
    if (isImageUrl(href)) {
      // If the link text is just the URL itself, render as image only
      const textContent = typeof children === 'string' ? children : '';
      const isBareLinkText = textContent === href || textContent.startsWith('http');
      return (
        <span>
          <img
            src={href}
            alt={isBareLinkText ? 'Generated image' : textContent}
            loading="lazy"
            onClick={() => window.open(href, '_blank', 'noopener')}
            title="Click to open full size"
          />
          {!isBareLinkText && children && (
            <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
              {children}
            </a>
          )}
        </span>
      );
    }

    // Auto-detect video URLs and render inline
    if (isVideoUrl(href)) {
      return (
        <video
          src={href}
          controls
          preload="metadata"
          style={{ maxWidth: '100%', maxHeight: 320, borderRadius: '0.75rem', margin: '0.5em 0' }}
        />
      );
    }

    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
        {children}
      </a>
    );
  },
};

export default function ChatMarkdown({ children }: { children: string }) {
  return (
    <div className="prose-chat">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>{preProcessContent(children)}</Markdown>
    </div>
  );
}
