import type { IncomingMessage, ServerResponse } from 'node:http';
import { corsHeadersFor } from './corsHeaders.js';

/** JSON response with CORS for browser calls from the dashboard (cross-origin Bearer requests). */
export function writeJson(res: ServerResponse, status: number, data: unknown, req?: IncomingMessage): void {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...corsHeadersFor(req),
  };
  res.writeHead(status, headers);
  res.end(JSON.stringify(data));
}
