# Engineering Context

## Infrastructure

| Service | Purpose | Cost |
|---------|---------|------|
| GCP Cloud Run | Agent execution, builds | ~$187/mo |
| Gemini API | All AI inference | ~$412/mo |
| Supabase | Database, realtime, auth | $125/mo |
| Vercel | Frontend hosting | ~$67/mo |
| GCS | Document storage | ~$5/mo |
| Cloud Scheduler | Agent cron jobs | Free |
| Pub/Sub | Event routing | Free |
| Azure Bot Service | Teams integration | Free |
| **Total** | | **~$850/mo** |

## Tech Stack

- **Runtime:** TypeScript, Node.js
- **AI Models:** Gemini 2.5 Pro/Flash (primary), OpenAI, Anthropic (fallback)
- **Database:** Supabase (PostgreSQL + pgvector)
- **Frontend:** Next.js, Vite, React, TailwindCSS
- **Hosting:** Vercel (frontend), GCP Cloud Run (agents)
- **CI/CD:** GitHub Actions, Docker

## Cost Rules

- Gemini API is biggest variable cost — watch it.
- Any service spike >20% WoW → Nadia flags to Andrew.
- Infrastructure scaling >$200/mo → Yellow (Andrew).
- New service commitment >$100/mo → Yellow.
