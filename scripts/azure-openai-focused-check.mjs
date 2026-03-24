const endpoint = (process.env.AZURE_FOUNDRY_ENDPOINT || process.env.AZURE_OPENAI_ENDPOINT || '').replace(/\/$/, '');
const key = process.env.AZURE_FOUNDRY_API || process.env.AZURE_OPENAI_API_KEY;

if (!endpoint || !key) {
  console.error('Missing AZURE_FOUNDRY_ENDPOINT/AZURE_OPENAI_ENDPOINT or AZURE_FOUNDRY_API/AZURE_OPENAI_API_KEY');
  process.exit(2);
}

const headers = {
  'api-key': key,
  'Content-Type': 'application/json',
};

async function call(name, url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { ...headers, ...(init.headers || {}) },
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = undefined; }
  const detail = response.ok ? 'ok' : (data?.error?.message || raw || '').slice(0, 240);
  return { name, ok: response.ok, status: response.status, detail };
}

const tests = [];

tests.push(await call('models_list', `${endpoint}/openai/v1/models`, { method: 'GET' }));
tests.push(await call('chat_model_router', `${endpoint}/openai/v1/chat/completions`, {
  method: 'POST',
  body: JSON.stringify({
    model: 'model-router',
    messages: [{ role: 'user', content: 'healthcheck' }],
    max_tokens: 16,
    temperature: 0,
  }),
}));
tests.push(await call('responses_gpt_5_4_mini', `${endpoint}/openai/v1/responses`, {
  method: 'POST',
  body: JSON.stringify({
    model: 'gpt-5.4-mini',
    input: 'healthcheck',
    max_output_tokens: 16,
  }),
}));
tests.push(await call('responses_gpt_5_nano', `${endpoint}/openai/v1/responses`, {
  method: 'POST',
  body: JSON.stringify({
    model: 'gpt-5-nano',
    input: 'healthcheck',
    max_output_tokens: 16,
  }),
}));

const passed = tests.filter((t) => t.ok).length;
const failed = tests.length - passed;

console.log(JSON.stringify({
  endpoint,
  passed,
  failed,
  total: tests.length,
  tests,
}, null, 2));

process.exit(failed > 0 ? 1 : 0);
