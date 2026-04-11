/**
 * ChatMarkdown — Markdown renderer with inline image/video, sanitized HTML,
 * collapsible <details>, and ```suggestions fenced blocks as clickable chips.
 */

import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import type { Components } from 'react-markdown';
import { isValidElement, useMemo, type ReactNode } from 'react';
import { normalizeText } from '../lib/normalizeText';

const IMAGE_URL_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)(\?.*)?$/i;
const MEDIA_HOSTS = ['media.glyphor.ai', 'imagedelivery.net', 'cloudflareimages.com'];
const VIDEO_EXT_RE = /\.(mp4|webm|mov)(\?.*)?$/i;

/** Turn bare media-host URLs into markdown image syntax so react-markdown renders them */
const BARE_MEDIA_URL_RE = /(?<![(\[!])(https?:\/\/(?:media\.glyphor\.ai|imagedelivery\.net|cloudflareimages\.com)[^\s)>\]]+)/gi;

function preProcessContent(text: string): string {
  const normalized = normalizeText(text);
  return normalized.replace(BARE_MEDIA_URL_RE, (raw) => {
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

function flattenCodeChildren(node: ReactNode): string {
  if (node == null || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flattenCodeChildren).join('');
  if (isValidElement(node)) {
    const ch = (node.props as { children?: ReactNode }).children;
    if (ch !== undefined) return flattenCodeChildren(ch);
  }
  return '';
}

function SuggestionChips({
  lines,
  onSuggestionClick,
}: {
  lines: string[];
  onSuggestionClick?: (text: string) => void;
}) {
  if (lines.length === 0) return null;
  return (
    <div
      className="chat-suggestion-chips not-prose my-2 flex flex-wrap gap-2"
      role="group"
      aria-label="Suggested replies"
    >
      {lines.map((line, i) => (
        <button
          key={i}
          type="button"
          className="chat-suggestion-chip rounded-full border border-border bg-raised/90 px-3 py-1.5 text-left text-[12px] font-medium text-txt-primary shadow-sm transition-colors hover:border-cyan/40 hover:bg-raised focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan/50"
          onClick={() => {
            onSuggestionClick?.(line);
          }}
        >
          {line}
        </button>
      ))}
    </div>
  );
}

function createMarkdownComponents(onSuggestionClick?: (text: string) => void): Components {
  return {
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

      if (isImageUrl(href)) {
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

    pre({ children, className }) {
      const child = Array.isArray(children) ? children[0] : children;
      if (
        isValidElement(child)
        && typeof child.type === 'string'
        && child.type === 'code'
      ) {
        const codeClass = String((child.props as { className?: string }).className ?? '');
        if (codeClass.includes('language-suggestions')) {
          const text = flattenCodeChildren((child.props as { children?: ReactNode }).children);
          const lines = text
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean);
          return <SuggestionChips lines={lines} onSuggestionClick={onSuggestionClick} />;
        }
      }
      return <pre className={className}>{children}</pre>;
    },
  };
}

export interface ChatMarkdownProps {
  children: string;
  /** When set, ```suggestions fenced blocks render as chips that fill the composer */
  onSuggestionClick?: (text: string) => void;
}

export default function ChatMarkdown({ children, onSuggestionClick }: ChatMarkdownProps) {
  const components = useMemo(
    () => createMarkdownComponents(onSuggestionClick),
    [onSuggestionClick],
  );

  return (
    <div className="prose-chat">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeSanitize]}
        components={components}
      >
        {preProcessContent(children)}
      </Markdown>
    </div>
  );
}
