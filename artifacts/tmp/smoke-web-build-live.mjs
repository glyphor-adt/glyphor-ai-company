const payload = {
  agentRole: process.env.SMOKE_AGENT_ROLE?.trim() || 'frontend-engineer',
  task: process.env.SMOKE_TASK?.trim() || 'on_demand',
  message: process.env.SMOKE_MESSAGE?.trim()
    || "Use invoke_web_build to create a prototype marketing website for brand 'April Smoke Atlas 20260401'. Do not use build_website_foundation directly. Return the project_id, preview_url, and deploy_url. The site should position an AI operations design studio for founders.",
  userName: process.env.SMOKE_USER_NAME?.trim() || 'Kristina',
  userEmail: process.env.SMOKE_USER_EMAIL?.trim() || 'kristina@glyphor.ai',
};

const response = await fetch('https://glyphor-scheduler-610179349713.us-central1.run.app/run', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(payload),
});

const text = await response.text();
console.log(JSON.stringify({ status: response.status, ok: response.ok, body: text }, null, 2));
if (!response.ok) {
  process.exit(1);
}
