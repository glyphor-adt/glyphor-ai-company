const fs = require('fs');
const path = require('path');

const baseDir = __dirname;
const smoketestDir = path.join(baseDir, 'packages', 'smoketest');

// File contents
const files = {
  'package.json': `{
  "name": "@glyphor/smoketest",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "bin": {
    "smoketest": "./dist/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc && node dist/cli.js",
    "start": "node dist/cli.js",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@glyphor/company-memory": "*",
    "@google-cloud/pubsub": "^4.0.0",
    "@google-cloud/run": "^1.3.0",
    "@google-cloud/secret-manager": "^5.0.0",
    "chalk": "^5.3.0",
    "commander": "^12.0.0",
    "node-fetch": "^3.3.2",
    "ora": "^8.0.1"
  },
  "devDependencies": {
    "@types/node": "^22.15.0",
    "typescript": "^5.8.3",
    "vitest": "^4.0.18"
  }
}
`,
  'tsconfig.json': `{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "target": "ES2022",
    "lib": ["ES2022"],
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
`,
  'README.md': `# Glyphor Smoke Test Suite

Comprehensive end-to-end testing suite for the Glyphor AI Company architecture.

## Overview

This package provides automated smoke tests covering all 12 architectural layers (55 total tests) of the Glyphor AI Company system, from infrastructure health to voice gateway functionality.

## Installation

\`\`\`bash
# From repository root
npm install

# Build the smoketest package
npm run build --workspace=@glyphor/smoketest
\`\`\`

## Usage

\`\`\`bash
# Run all tests
npm run start --workspace=@glyphor/smoketest

# Run specific layer
npm run start --workspace=@glyphor/smoketest -- --layer 4

# Run specific test
npm run start --workspace=@glyphor/smoketest -- --test T4.1

# Generate report
npm run start --workspace=@glyphor/smoketest -- --report json

# Verbose output
npm run start --workspace=@glyphor/smoketest -- --verbose
\`\`\`

## Test Layers

- **Layer 0**: Infrastructure Health (5 tests)
- **Layer 1**: Data Syncs (4 tests)
- **Layer 2**: Model Clients (4 tests)
- **Layer 3**: Heartbeat & Work Loop (4 tests)
- **Layer 4**: Orchestration Loop (7 tests) - CRITICAL
- **Layer 5**: Communication (5 tests)
- **Layer 6**: Authority Gates (4 tests)
- **Layer 7**: Intelligence Enhancements (7 tests)
- **Layer 8**: Knowledge Graph (4 tests)
- **Layer 9**: Strategy & Analysis (4 tests)
- **Layer 10**: Specialist Agents (3 tests)
- **Layer 11**: Dashboard & API (2 tests)
- **Layer 12**: Voice Gateway (2 tests)

## Configuration

Create a \`.smoketestrc.json\` file in the repository root:

\`\`\`json
{
  "schedulerUrl": "https://glyphor-scheduler-<hash>-uc.a.run.app",
  "dashboardUrl": "https://glyphor-dashboard-<hash>-uc.a.run.app",
  "voiceUrl": "https://voice-gateway-<hash>-uc.a.run.app",
  "gcpProject": "ai-glyphor-company",
  "parallel": false
}
\`\`\`

Or use environment variables:
- \`SMOKETEST_SCHEDULER_URL\`
- \`SMOKETEST_DASHBOARD_URL\`
- \`SMOKETEST_VOICE_URL\`
- \`GCP_PROJECT\`

## CI/CD Integration

The smoke tests can be run as part of CI/CD pipelines. See \`.github/workflows/smoketest.yml\` for the GitHub Actions integration.

## Development

\`\`\`bash
# Watch mode
npm run build --workspace=@glyphor/smoketest -- --watch

# Type checking
npm run typecheck --workspace=@glyphor/smoketest

# Run tests
npm test --workspace=@glyphor/smoketest
\`\`\`

## Known Issues

- **OpenAI duplicate tool_call_id bug**: Layer 2 Test 2.4 and Layer 4 tests may fail due to the known OpenAI API issue. This is expected until the bug is fixed in \`packages/agent-runtime/src/providers/openai.ts\`.

## License

Private - Glyphor AI Company
`,
  'src/types.ts': `/**
 * Smoke Test Types
 * Type definitions for the Glyphor smoke test suite
 */

export type TestStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
export type TestLayer = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

export interface TestConfig {
  schedulerUrl?: string;
  dashboardUrl?: string;
  voiceUrl?: string;
  gcpProject?: string;
  parallel?: boolean;
  verbose?: boolean;
  timeout?: number;
}

export interface TestResult {
  id: string;
  name: string;
  layer: TestLayer;
  status: TestStatus;
  duration?: number;
  error?: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

export interface LayerResult {
  layer: TestLayer;
  name: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  tests: TestResult[];
}

export interface SmokeTestReport {
  timestamp: string;
  duration: number;
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    successRate: number;
  };
  layers: LayerResult[];
  config: TestConfig;
}

export interface Test {
  id: string;
  name: string;
  layer: TestLayer;
  description: string;
  critical?: boolean;
  run: (config: TestConfig) => Promise<TestResult>;
}

export interface Layer {
  id: TestLayer;
  name: string;
  description: string;
  tests: Test[];
}

export interface HttpResponse<T = unknown> {
  status: number;
  data: T;
  headers: Record<string, string>;
}

export interface GcpServiceStatus {
  name: string;
  status: 'healthy' | 'unhealthy' | 'unknown';
  url?: string;
  error?: string;
}

export interface SupabaseHealth {
  status: 'healthy' | 'unhealthy';
  postgrest: boolean;
  database: boolean;
}
`,
  'src/utils/http-client.ts': `/**
 * HTTP Client Utility
 * Provides HTTP request functionality for smoke tests
 */

import fetch from 'node-fetch';
import type { HttpResponse } from '../types.js';

export interface HttpClientOptions {
  timeout?: number;
  headers?: Record<string, string>;
  verbose?: boolean;
}

export class HttpClient {
  private timeout: number;
  private defaultHeaders: Record<string, string>;
  private verbose: boolean;

  constructor(options: HttpClientOptions = {}) {
    this.timeout = options.timeout || 30000;
    this.defaultHeaders = options.headers || {};
    this.verbose = options.verbose || false;
  }

  async get<T = unknown>(url: string, headers?: Record<string, string>): Promise<HttpResponse<T>> {
    return this.request<T>('GET', url, undefined, headers);
  }

  async post<T = unknown>(
    url: string,
    body?: unknown,
    headers?: Record<string, string>
  ): Promise<HttpResponse<T>> {
    return this.request<T>('POST', url, body, headers);
  }

  async put<T = unknown>(
    url: string,
    body?: unknown,
    headers?: Record<string, string>
  ): Promise<HttpResponse<T>> {
    return this.request<T>('PUT', url, body, headers);
  }

  async delete<T = unknown>(url: string, headers?: Record<string, string>): Promise<HttpResponse<T>> {
    return this.request<T>('DELETE', url, undefined, headers);
  }

  private async request<T>(
    method: string,
    url: string,
    body?: unknown,
    headers?: Record<string, string>
  ): Promise<HttpResponse<T>> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      if (this.verbose) {
        console.log(\`[HTTP] \${method} \${url}\`);
        if (body) {
          console.log(\`[HTTP] Body:\`, JSON.stringify(body, null, 2));
        }
      }

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...this.defaultHeaders,
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      let data: T;
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        data = (await response.json()) as T;
      } else {
        data = (await response.text()) as T;
      }

      if (this.verbose) {
        console.log(\`[HTTP] \${response.status} \${response.statusText}\`);
        console.log(\`[HTTP] Response:\`, JSON.stringify(data, null, 2));
      }

      return {
        status: response.status,
        data,
        headers: responseHeaders,
      };
    } catch (error) {
      if (this.verbose) {
        console.error(\`[HTTP] Error:\`, error);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async healthCheck(url: string): Promise<boolean> {
    try {
      const response = await this.get(\`\${url}/health\`);
      return response.status === 200;
    } catch {
      return false;
    }
  }
}
`,
  'src/utils/sql-client.ts': `/**
 * SQL Client Utility
 * Provides database query functionality for smoke tests
 */

import { createClient } from '@supabase/supabase-js';

export interface SqlClientOptions {
  supabaseUrl?: string;
  supabaseKey?: string;
  verbose?: boolean;
}

export class SqlClient {
  private supabaseUrl: string;
  private supabaseKey: string;
  private verbose: boolean;
  private client: ReturnType<typeof createClient> | null = null;

  constructor(options: SqlClientOptions = {}) {
    this.supabaseUrl = options.supabaseUrl || process.env.SUPABASE_URL || '';
    this.supabaseKey = options.supabaseKey || process.env.SUPABASE_ANON_KEY || '';
    this.verbose = options.verbose || false;

    if (this.supabaseUrl && this.supabaseKey) {
      this.client = createClient(this.supabaseUrl, this.supabaseKey);
    }
  }

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    if (!this.client) {
      throw new Error('Supabase client not initialized. Provide supabaseUrl and supabaseKey.');
    }

    if (this.verbose) {
      console.log(\`[SQL] Query:\`, sql);
      if (params) {
        console.log(\`[SQL] Params:\`, params);
      }
    }

    try {
      // Note: Supabase doesn't support raw SQL queries in the same way
      // This is a simplified implementation. In practice, you'd use Supabase's query builder
      // or use a direct PostgreSQL client for raw SQL
      throw new Error('Raw SQL queries not implemented. Use Supabase query builder methods.');
    } catch (error) {
      if (this.verbose) {
        console.error(\`[SQL] Error:\`, error);
      }
      throw error;
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.client) {
      return false;
    }

    try {
      // Simple health check by querying system tables
      const { error } = await this.client.from('_health').select('*').limit(1);
      return !error;
    } catch {
      return false;
    }
  }

  async testConnection(): Promise<{ connected: boolean; latency?: number }> {
    if (!this.client) {
      return { connected: false };
    }

    const start = Date.now();
    try {
      const { error } = await this.client.from('_health').select('count').limit(1);
      const latency = Date.now() - start;
      return { connected: !error, latency };
    } catch {
      return { connected: false };
    }
  }

  getClient() {
    return this.client;
  }
}
`,
  'src/utils/gcp-client.ts': `/**
 * GCP Client Utility
 * Provides Google Cloud Platform interaction for smoke tests
 */

import { PubSub } from '@google-cloud/pubsub';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { ServicesClient } from '@google-cloud/run';

export interface GcpClientOptions {
  projectId?: string;
  verbose?: boolean;
}

export class GcpClient {
  private projectId: string;
  private verbose: boolean;
  private pubsub: PubSub;
  private secretManager: SecretManagerServiceClient;
  private cloudRun: ServicesClient;

  constructor(options: GcpClientOptions = {}) {
    this.projectId = options.projectId || process.env.GCP_PROJECT || '';
    this.verbose = options.verbose || false;

    if (!this.projectId) {
      throw new Error('GCP project ID is required. Set via GCP_PROJECT env var or options.');
    }

    this.pubsub = new PubSub({ projectId: this.projectId });
    this.secretManager = new SecretManagerServiceClient();
    this.cloudRun = new ServicesClient();
  }

  async publishMessage(topicName: string, data: Record<string, unknown>): Promise<string> {
    if (this.verbose) {
      console.log(\`[GCP] Publishing to topic: \${topicName}\`);
      console.log(\`[GCP] Data:\`, JSON.stringify(data, null, 2));
    }

    try {
      const topic = this.pubsub.topic(topicName);
      const messageBuffer = Buffer.from(JSON.stringify(data));
      const messageId = await topic.publishMessage({ data: messageBuffer });

      if (this.verbose) {
        console.log(\`[GCP] Published message ID: \${messageId}\`);
      }

      return messageId;
    } catch (error) {
      if (this.verbose) {
        console.error(\`[GCP] Publish error:\`, error);
      }
      throw error;
    }
  }

  async getSecret(secretName: string): Promise<string> {
    if (this.verbose) {
      console.log(\`[GCP] Fetching secret: \${secretName}\`);
    }

    try {
      const name = \`projects/\${this.projectId}/secrets/\${secretName}/versions/latest\`;
      const [version] = await this.secretManager.accessSecretVersion({ name });
      const payload = version.payload?.data?.toString() || '';

      if (this.verbose) {
        console.log(\`[GCP] Secret retrieved successfully\`);
      }

      return payload;
    } catch (error) {
      if (this.verbose) {
        console.error(\`[GCP] Secret fetch error:\`, error);
      }
      throw error;
    }
  }

  async listCloudRunServices(): Promise<string[]> {
    if (this.verbose) {
      console.log(\`[GCP] Listing Cloud Run services\`);
    }

    try {
      const parent = \`projects/\${this.projectId}/locations/-\`;
      const [services] = await this.cloudRun.listServices({ parent });

      const serviceNames = services.map((service) => service.name || '').filter(Boolean);

      if (this.verbose) {
        console.log(\`[GCP] Found \${serviceNames.length} services:\`, serviceNames);
      }

      return serviceNames;
    } catch (error) {
      if (this.verbose) {
        console.error(\`[GCP] List services error:\`, error);
      }
      throw error;
    }
  }

  async getCloudRunServiceUrl(serviceName: string, location = 'us-central1'): Promise<string> {
    if (this.verbose) {
      console.log(\`[GCP] Getting URL for service: \${serviceName}\`);
    }

    try {
      const name = \`projects/\${this.projectId}/locations/\${location}/services/\${serviceName}\`;
      const [service] = await this.cloudRun.getService({ name });

      const url = service.uri || '';

      if (this.verbose) {
        console.log(\`[GCP] Service URL: \${url}\`);
      }

      return url;
    } catch (error) {
      if (this.verbose) {
        console.error(\`[GCP] Get service URL error:\`, error);
      }
      throw error;
    }
  }

  async checkPubSubTopicExists(topicName: string): Promise<boolean> {
    try {
      const topic = this.pubsub.topic(topicName);
      const [exists] = await topic.exists();
      return exists;
    } catch {
      return false;
    }
  }

  getPubSub() {
    return this.pubsub;
  }

  getSecretManager() {
    return this.secretManager;
  }

  getCloudRun() {
    return this.cloudRun;
  }
}
`
};

console.log('Setting up smoketest package files...\\n');

// Ensure directories exist
const dirs = ['src', 'src/utils', 'src/layers'];
for (const dir of dirs) {
  const dirPath = path.join(smoketestDir, dir);
  if (!fs.existsSync(dirPath)) {
    console.log(\`Creating directory: \${dir}\`);
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// Write files
for (const [filePath, content] of Object.entries(files)) {
  const fullPath = path.join(smoketestDir, filePath);
  console.log(\`Writing: \${filePath}\`);
  fs.writeFileSync(fullPath, content, 'utf8');
}

console.log('\\n✓ All files created successfully!');
console.log('\\nDirectory structure:');
console.log(smoketestDir);
console.log('  ├── package.json');
console.log('  ├── tsconfig.json');
console.log('  ├── README.md');
console.log('  └── src/');
console.log('      ├── types.ts');
console.log('      ├── layers/');
console.log('      └── utils/');
console.log('          ├── http-client.ts');
console.log('          ├── sql-client.ts');
console.log('          └── gcp-client.ts');
console.log('\\nNext steps:');
console.log('  1. cd packages\\\\smoketest');
console.log('  2. npm install');
console.log('  3. npm run build');
