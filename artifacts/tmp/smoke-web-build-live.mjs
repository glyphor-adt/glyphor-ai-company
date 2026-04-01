const payload = {
  agentRole: 'frontend-engineer',
  task: 'on_demand',
  message: "Use invoke_web_build to create a prototype marketing website for brand 'April Smoke Atlas 20260401'. Do not use build_website_foundation directly. Return the project_id, preview_url, and deploy_url. The site should position an AI operations design studio for founders.",
  userName: 'Kristina',
  userEmail: 'kristina@glyphor.ai',
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
