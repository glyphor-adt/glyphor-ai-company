import { useState, useEffect, useRef, useCallback } from "react";

/*
  GLYPHOR COMMAND CENTER — Premium Edition
  
  Design: "Luxury mission control meets living organism"
  
  Features:
  - Living agent constellation on dashboard (agents orbit, connections glow)
  - ⌘K command palette for instant navigation
  - Agent thinking shimmer + typing reveal in chat
  - Ambient toast notifications
  - Fuse (blue) / Pulse (pink) product identity
  - Sparkline charts on all metrics
  - Staggered page transitions
  - Hover-expand sparklines
  - Decision approve/reject animations
*/

// ─── Data ─────────────────────────────────────────────────────────────────────

const DEPARTMENTS = [
  { id: "executive", name: "Executive", color: "#8b5cf6", agents: [
    { id: "sarah-chen", name: "Sarah Chen", title: "Chief of Staff", badge: "★", score: 96, status: "active", activity: "Compiling weekly sync agenda", lastActive: "2m ago", connections: ["marcus-reeves","elena-vasquez","nadia-okafor","maya-brooks","james-turner"] },
  ]},
  { id: "engineering", name: "Engineering", color: "#ef4444", agents: [
    { id: "marcus-reeves", name: "Marcus Reeves", title: "CTO", badge: "★", score: 91, status: "active", activity: "Drafting parallel compilation spec", lastActive: "12m ago", connections: ["sarah-chen","nova","stack","nadia-okafor"] },
    { id: "nova", name: "Nova", title: "Platform Engineer", score: 94, status: "active", activity: "Monitoring Cloud Run instances", lastActive: "5m ago", connections: ["marcus-reeves","stack"] },
    { id: "patch", name: "Patch", title: "Quality Engineer", score: 92, status: "active", activity: "Analyzing build error patterns", lastActive: "18m ago", connections: ["marcus-reeves"] },
    { id: "stack", name: "Stack", title: "DevOps", score: 97, status: "active", activity: "Cache optimization running", lastActive: "1m ago", connections: ["marcus-reeves","nova","vault"] },
  ]},
  { id: "product", name: "Product", color: "#06b6d4", agents: [
    { id: "elena-vasquez", name: "Elena Vasquez", title: "CPO", badge: "★", score: 88, status: "active", activity: "Updating Fuse roadmap priorities", lastActive: "3h ago", connections: ["sarah-chen","maya-brooks","lens","scout"] },
    { id: "lens", name: "Lens", title: "User Research", score: 90, status: "active", activity: "Analyzing engagement cohorts", lastActive: "1h ago", connections: ["elena-vasquez","james-turner"] },
    { id: "scout", name: "Scout", title: "Competitive Intel", score: 87, status: "active", activity: "Scanning Lovable changelog", lastActive: "4h ago", connections: ["elena-vasquez","maya-brooks"] },
  ]},
  { id: "finance", name: "Finance", color: "#10b981", agents: [
    { id: "nadia-okafor", name: "Nadia Okafor", title: "CFO", badge: "★", score: 96, status: "active", activity: "Daily P&L complete", lastActive: "5h ago", connections: ["sarah-chen","marcus-reeves","mint","vault"] },
    { id: "mint", name: "Mint", title: "Revenue Analyst", score: 93, status: "active", activity: "Cohort LTV analysis", lastActive: "3h ago", connections: ["nadia-okafor"] },
    { id: "vault", name: "Vault", title: "Cost Analyst", score: 95, status: "active", activity: "Gemini API cost audit", lastActive: "5h ago", connections: ["nadia-okafor","stack"] },
  ]},
  { id: "marketing", name: "Marketing", color: "#ec4899", agents: [
    { id: "maya-brooks", name: "Maya Brooks", title: "CMO", badge: "★", score: 86, status: "active", activity: "Queuing social content", lastActive: "3h ago", connections: ["sarah-chen","elena-vasquez","pixel","echo"] },
    { id: "pixel", name: "Pixel", title: "Content Creator", score: 84, status: "active", activity: "Drafting case study", lastActive: "3h ago", connections: ["maya-brooks","signal"] },
    { id: "signal", name: "Signal", title: "SEO Analyst", score: 89, status: "active", activity: "Keyword rank tracking", lastActive: "6h ago", connections: ["pixel"] },
    { id: "echo", name: "Echo", title: "Social Media", score: 82, status: "active", activity: "LinkedIn post scheduled", lastActive: "4h ago", connections: ["maya-brooks"] },
  ]},
  { id: "customer", name: "Customer Success", color: "#3b82f6", agents: [
    { id: "james-turner", name: "James Turner", title: "VP Customer Success", badge: "★", score: 90, status: "active", activity: "Health scores updated", lastActive: "5h ago", connections: ["sarah-chen","lens","guide","rachel-kim"] },
    { id: "guide", name: "Guide", title: "Onboarding", score: 91, status: "active", activity: "Welcome flow analysis", lastActive: "6h ago", connections: ["james-turner"] },
    { id: "care", name: "Care", title: "Support", score: 88, status: "active", activity: "Ticket triage complete", lastActive: "4h ago", connections: ["james-turner"] },
  ]},
  { id: "sales", name: "Sales", color: "#f59e0b", agents: [
    { id: "closer", name: "Closer", title: "VP Sales", badge: "★", score: 82, status: "standby", activity: "KYC research: Acme Corp", lastActive: "3d ago", connections: ["harbor"] },
    { id: "intel", name: "Intel", title: "Account Research", score: 85, status: "standby", activity: "Awaiting enterprise lead", lastActive: "3d ago", connections: ["closer"] },
  ]},
];

const ALL_AGENTS = DEPARTMENTS.flatMap(d => d.agents.map(a => ({ ...a, dept: d.name, deptColor: d.color })));

const DECISIONS = [
  { id: 1, tier: "red", status: "pending", title: "Launch Glyphor Flow", from: "Compass", summary: "Autonomous data pipeline tool. TAM $2.8B. 37 users demand signal. No competitor.", to: ["Kristina","Andrew"], time: "2h ago", reasoning: "37 Fuse users attempted data pipelines. Zero competitors. CTO: 70% runtime reuse. CFO: break-even at 30 customers." },
  { id: 2, tier: "yellow", status: "pending", title: "Upgrade Pulse to Pro Model", from: "Forge", summary: "+15% quality scores. +$120/mo cost.", to: ["Andrew"], time: "5h ago", reasoning: "A/B test: Pro shows 15% quality lift. Budget headroom confirmed." },
  { id: 3, tier: "yellow", status: "pending", title: "Publish Case Study", from: "Beacon", summary: "Power user (47 projects). First external proof point.", to: ["Kristina"], time: "3h ago", reasoning: "User_291: 47 projects, 0.91 quality. First-mover advantage." },
  { id: 4, tier: "green", status: "auto", title: "Pulse Fallback Deployed", from: "Forge", summary: "Image gen timeout fixed.", to: [], time: "6h ago" },
  { id: 5, tier: "green", status: "auto", title: "Nurture Emails Sent", from: "Harbor", summary: "3 at-risk users contacted.", to: [], time: "5h ago" },
];

const ACTIVITY = [
  { t: "9:02", agent: "Atlas", text: "Compiled weekly sync agenda — 3 items", tier: "green" },
  { t: "8:22", agent: "Beacon", text: "Case study draft ready → Yellow for Kristina", tier: "yellow" },
  { t: "8:00", agent: "Beacon", text: "Published: 'Why AI Agents Are Replacing Dev Teams'", tier: "green" },
  { t: "7:15", agent: "Atlas", text: "Routed cost alert to Andrew", tier: "yellow" },
  { t: "7:04", agent: "Harbor", text: "Cross-product adoption 12% → promotion recommended", tier: "green" },
  { t: "7:00", agent: "Atlas", text: "Morning briefings delivered via Teams", tier: "green" },
  { t: "6:32", agent: "Ledger", text: "Daily P&L — $3,247 MRR, 62.3% margin", tier: "green" },
  { t: "6:05", agent: "Forge", text: "Pulse fallback deployed — recovering", tier: "green" },
  { t: "6:04", agent: "Compass", text: "Red filed: Glyphor Flow product proposal", tier: "red" },
  { t: "6:00", agent: "Compass", text: "E-commerce requests +23% → P1", tier: "green" },
];

const CHAT_HISTORY = {
  atlas: [{ role: "agent", text: "Good morning, Kristina.\n\nHere's what happened while you were at Microsoft yesterday.\n\n▸ Fuse — 312 builds, 91% success (up from 89%). E-commerce attempts surged 23%. Compass escalated to P1.\n\n▸ Pulse — 47 creations across 28 users. Best day since beta. Forge fixed an image gen timeout autonomously.\n\n▸ Revenue — $3,247 MRR. Ledger projects $5K by April.\n\n▸ Market — Lovable shipped GitHub integration. Beacon is drafting our counter-narrative.\n\nYou have 1 Red decision (Glyphor Flow — needs you and Andrew) and 2 Yellow items. Want me to pull any up?" }],
  forge: [{ role: "agent", text: "Platform status as of 12:00 PM CT.\n\nFuse runtime: nominal. 94% success rate. Build times 4.2 min avg — 8% slower than last week. Traced to higher component counts. Drafting parallel compilation spec.\n\nPulse runtime: recovered. Image gen was timing out on large canvases. Deployed Flash fallback at 6:05 AM. No approval needed — within authority.\n\nGemini API: latency stable at 1.2s. Cost up 18% WoW from my Pulse model upgrade. Ledger flagged to Andrew." }],
  compass: [{ role: "agent", text: "Product intelligence — week of Feb 17.\n\nThe big signal: 37 Fuse users attempted data pipelines this month. All failed — no template. That's not a feature gap, it's a product gap.\n\nI've filed Glyphor Flow as a Red decision:\n• TAM: $2.8B\n• Zero AI-native competitors\n• CTO: 70% Fuse runtime reusable\n• CFO: break-even at 30 customers\n• 37 existing users are day-one candidates\n\nLovable shipped GitHub integration. Moderate impact — helps their indie segment, doesn't touch our enterprise positioning. Beacon is on it." }],
  ledger: [{ role: "agent", text: "Financial snapshot — February 21, 2026.\n\nRevenue: $3,247 MRR · +12% MoM · 47 paying users\n\nCosts MTD: $847\n├ Gemini API    $412  (48.6%)  ⚠ +18% WoW\n├ Cloud Run     $187  (22.1%)\n├ Supabase      $125  (14.8%)\n├ Vercel         $67   (7.9%)\n└ AI Team        $38   (4.5%)\n\nMargin: 62.3% · up 1.2pts MoM\nCost/Fuse build: $0.34 · Cost/Pulse creation: $0.21\nRevenue/user: $17.65/mo · Contribution: $13.05/user\n\nAPI spike is from Forge's Pulse upgrade. +$120/mo. Filed Yellow to Andrew." }],
  beacon: [{ role: "agent", text: "Growth report.\n\n→ 'Why AI Agents Are Replacing Dev Teams in 2026'\n  840 LinkedIn impressions, 3 hours. 12 engagements. Velocity: 2,500+ by EOD.\n\nSEO: 'ai website builder' #14 → #11. 'autonomous development platform' entering top 50.\n\nQueued: Fuse vs agencies thread, Pulse beta announcement, 'Two Microsoft Engineers, Zero Employees' post — our best story.\n\nCase study: user_291, 47 projects, 0.91 quality. Draft ready. Filed Yellow." }],
  harbor: [{ role: "agent", text: "Customer health update.\n\n184 active users. Healthy: 142 (77%) · At-risk: 28 (15%) · Dormant: 14 (8%)\n\nActions: 3 users flagged at-risk, sent nurture emails. user_291 → Beacon for case study. 2 enterprise-pattern users → Closer.\n\nInsight: Fuse→Pulse cross-adoption at 12%. Users on both = 3x retention. Recommending cross-promotion to Beacon." }],
};

const AVATARS = {
  Atlas:"#8b5cf6",Forge:"#ef4444",Nova:"#f97316",Patch:"#eab308",Stack:"#f43f5e",
  Compass:"#06b6d4",Lens:"#0ea5e9",Scout:"#6366f1",Ledger:"#10b981",Mint:"#22c55e",
  Vault:"#14b8a6",Beacon:"#ec4899",Pixel:"#d946ef",Signal:"#f43f5e",Echo:"#a855f7",
  Harbor:"#3b82f6",Guide:"#6366f1",Care:"#8b5cf6",Closer:"#f59e0b",Intel:"#eab308",
};

// ─── CSS ──────────────────────────────────────────────────────────────────────

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&family=JetBrains+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&display=swap');
  
  * { box-sizing: border-box; margin: 0; padding: 0; }
  ::-webkit-scrollbar { width: 5px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 3px; }
  ::selection { background: #7c3aed44; }

  @keyframes fadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes pulseRing { 0% { opacity: .7; transform: scale(1); } 100% { opacity: 0; transform: scale(1.5); } }
  @keyframes shimmer { 0% { background-position: -400px 0; } 100% { background-position: 400px 0; } }
  @keyframes breathe { 0%,100% { opacity: .4; } 50% { opacity: 1; } }
  @keyframes slideIn { from { opacity: 0; transform: translateX(60px); } to { opacity: 1; transform: translateX(0); } }
  @keyframes flashGreen { 0% { background: #14532d; } 100% { background: #0c1017; } }
  @keyframes flashRed { 0% { background: #7f1d1d; } 100% { background: #0c1017; } }
  @keyframes constellationRotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  @keyframes nodeFloat {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-3px); }
  }
  @keyframes typeReveal { from { max-height: 0; opacity: 0; } to { max-height: 2000px; opacity: 1; } }
  
  .card { background: #0c1017; border: 1px solid #151921; border-radius: 14px; transition: border-color .2s, box-shadow .2s; }
  .card:hover { border-color: #1e293b; }
  .fade { animation: fadeUp .4s ease-out both; }
  .sparkline-wrap:hover .spark-expand { opacity: 1; transform: scaleX(1); }
  
  .thinking-bubble {
    background: linear-gradient(90deg, #151921 0%, #1e293b 50%, #151921 100%);
    background-size: 400px 100%;
    animation: shimmer 1.8s linear infinite;
    border-radius: 14px; padding: 16px 20px; max-width: 200px;
  }
  .thinking-dots span {
    display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #475569;
    animation: breathe 1.4s ease-in-out infinite;
  }
  .thinking-dots span:nth-child(2) { animation-delay: .2s; }
  .thinking-dots span:nth-child(3) { animation-delay: .4s; }
  
  .toast {
    position: fixed; bottom: 24px; right: 24px; z-index: 100;
    animation: slideIn .35s ease-out both;
  }

  .cmd-overlay {
    position: fixed; inset: 0; background: #0a0f15cc; backdrop-filter: blur(8px);
    z-index: 200; display: flex; align-items: flex-start; justify-content: center; padding-top: 18vh;
  }
  .cmd-box {
    width: 520px; background: #0c1017; border: 1px solid #1e293b; border-radius: 16px;
    box-shadow: 0 24px 80px #00000080; overflow: hidden;
  }
  .cmd-input {
    width: 100%; background: transparent; border: none; border-bottom: 1px solid #151921;
    padding: 18px 20px; font-size: 15px; color: #f1f5f9; outline: none;
    font-family: 'DM Sans', sans-serif;
  }
  .cmd-item {
    display: flex; align-items: center; gap: 12px; padding: 10px 20px; cursor: pointer;
    border: none; width: 100%; text-align: left; background: transparent;
    font-family: 'DM Sans', sans-serif; transition: background .1s;
  }
  .cmd-item:hover, .cmd-item.active { background: #7c3aed15; }
  .cmd-item .label { font-size: 13px; color: #e2e8f0; }
  .cmd-item .hint { font-size: 11px; color: #475569; }
`;

// ─── Micro components ─────────────────────────────────────────────────────────

function Bubble({ name, size = 32, pulse, glow }) {
  const bg = AVATARS[name] || "#6b7280";
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      {pulse && <div style={{ position: "absolute", inset: -3, borderRadius: size > 40 ? 16 : 12, border: `2px solid ${bg}50`, animation: "pulseRing 2s ease-out infinite" }} />}
      <div style={{
        width: size, height: size, borderRadius: size > 40 ? 14 : 10,
        background: `linear-gradient(145deg, ${bg}, ${bg}bb)`,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#fff", fontWeight: 600, fontSize: size * .38,
        boxShadow: glow ? `0 0 24px ${bg}50` : pulse ? `0 0 12px ${bg}30` : "none",
        transition: "box-shadow .3s",
        fontFamily: "'DM Sans', sans-serif",
      }}>{name.charAt(0)}</div>
    </div>
  );
}

function TierDot({ t }) {
  const c = t === "red" ? "#ef4444" : t === "yellow" ? "#eab308" : "#22c55e";
  return <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: c, boxShadow: `0 0 6px ${c}60` }} />;
}

function TierLabel({ t }) {
  const m = { red: ["#7f1d1d","#fca5a5"], yellow: ["#713f12","#fde047"], green: ["#14532d","#86efac"] };
  return <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, padding: "2px 7px", borderRadius: 4, background: m[t][0], color: m[t][1], fontFamily: "'JetBrains Mono', monospace" }}>{t}</span>;
}

function Score({ v }) {
  const c = v >= 95 ? "#4ade80" : v >= 90 ? "#86efac" : v >= 85 ? "#fde047" : "#fca5a5";
  return <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: c }}>{v}%</span>;
}

function Spark({ data, color = "#a78bfa", w = 80, h = 24 }) {
  const mn = Math.min(...data), mx = Math.max(...data), r = mx - mn || 1;
  const pts = data.map((v, i) => `${(i/(data.length-1))*w},${h-((v-mn)/r)*(h-4)-2}`).join(" ");
  const last = pts.split(" ").pop().split(",");
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <defs><linearGradient id={`g-${color.replace('#','')}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".15"/><stop offset="100%" stopColor={color} stopOpacity="0"/></linearGradient></defs>
      <polygon points={`0,${h} ${pts} ${w},${h}`} fill={`url(#g-${color.replace('#','')})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="2.5" fill={color} />
    </svg>
  );
}

// ─── Constellation ────────────────────────────────────────────────────────────

function Constellation({ agents, onSelect }) {
  const canvasRef = useRef(null);
  const [hovered, setHovered] = useState(null);
  const [positions, setPositions] = useState({});
  const frameRef = useRef(0);
  const timeRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width = canvas.offsetWidth * 2;
    const H = canvas.height = canvas.offsetHeight * 2;
    ctx.scale(2, 2);
    const w = W / 2, h = H / 2;
    const cx = w / 2, cy = h / 2;

    // Position agents in orbital rings
    const deptGroups = DEPARTMENTS.map(d => d.agents);
    const nodePositions = {};
    
    // Atlas at center
    nodePositions["atlas"] = { x: cx, y: cy, color: AVATARS["Atlas"], name: "Atlas", title: "Chief of Staff", score: 96 };

    // Other agents in rings
    const outerAgents = agents.filter(a => a.id !== "atlas");
    const ringRadius = Math.min(w, h) * 0.36;

    outerAgents.forEach((agent, i) => {
      const angle = (i / outerAgents.length) * Math.PI * 2 - Math.PI / 2;
      const jitter = Math.sin(i * 2.7) * 15;
      nodePositions[agent.id] = {
        x: cx + Math.cos(angle) * (ringRadius + jitter),
        y: cy + Math.sin(angle) * (ringRadius + jitter),
        color: AVATARS[agent.name] || "#6b7280",
        name: agent.name,
        title: agent.title,
        score: agent.score,
        connections: agent.connections || [],
      };
    });

    setPositions(nodePositions);

    let animFrame;
    const draw = (time) => {
      timeRef.current = time;
      ctx.clearRect(0, 0, w, h);

      // Draw connections
      Object.entries(nodePositions).forEach(([id, node]) => {
        (node.connections || []).forEach(targetId => {
          const target = nodePositions[targetId];
          if (!target) return;
          const isHighlighted = hovered === id || hovered === targetId;
          ctx.beginPath();
          ctx.moveTo(node.x, node.y);
          ctx.lineTo(target.x, target.y);
          ctx.strokeStyle = isHighlighted ? "#7c3aed40" : "#151921";
          ctx.lineWidth = isHighlighted ? 1.5 : 0.5;
          ctx.stroke();

          // Traveling particle on highlighted connections
          if (isHighlighted) {
            const t = (time % 3000) / 3000;
            const px = node.x + (target.x - node.x) * t;
            const py = node.y + (target.y - node.y) * t;
            ctx.beginPath();
            ctx.arc(px, py, 2, 0, Math.PI * 2);
            ctx.fillStyle = "#7c3aed80";
            ctx.fill();
          }
        });
      });

      // Draw nodes
      Object.entries(nodePositions).forEach(([id, node]) => {
        const isCenter = id === "atlas";
        const isHov = hovered === id;
        const float = Math.sin(time / 1000 + node.x) * 2;
        const ny = node.y + float;
        const radius = isCenter ? 18 : isHov ? 14 : 10;

        // Glow
        if (isCenter || isHov) {
          const grad = ctx.createRadialGradient(node.x, ny, 0, node.x, ny, radius * 3);
          grad.addColorStop(0, node.color + "30");
          grad.addColorStop(1, "transparent");
          ctx.fillStyle = grad;
          ctx.fillRect(node.x - radius * 3, ny - radius * 3, radius * 6, radius * 6);
        }

        // Circle
        ctx.beginPath();
        ctx.arc(node.x, ny, radius, 0, Math.PI * 2);
        ctx.fillStyle = node.color;
        ctx.fill();

        // Letter
        ctx.fillStyle = "#fff";
        ctx.font = `${isCenter ? 600 : 500} ${isCenter ? 14 : 9}px 'DM Sans', sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(node.name.charAt(0), node.x, ny);

        // Label on hover
        if (isHov) {
          ctx.fillStyle = "#e2e8f0";
          ctx.font = "500 11px 'DM Sans', sans-serif";
          ctx.fillText(node.name, node.x, ny - radius - 10);
          ctx.fillStyle = "#64748b";
          ctx.font = "400 9px 'DM Sans', sans-serif";
          ctx.fillText(node.title, node.x, ny - radius - 22);
        }
      });

      animFrame = requestAnimationFrame(draw);
    };
    animFrame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animFrame);
  }, [agents, hovered]);

  const handleMouse = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    
    let found = null;
    Object.entries(positions).forEach(([id, node]) => {
      const dist = Math.sqrt((mx - node.x) ** 2 + (my - node.y) ** 2);
      if (dist < 20) found = id;
    });
    setHovered(found);
    canvas.style.cursor = found ? "pointer" : "default";
  }, [positions]);

  const handleClick = useCallback((e) => {
    if (hovered && onSelect) {
      const agent = ALL_AGENTS.find(a => a.id === hovered);
      if (agent) onSelect(agent);
    }
  }, [hovered, onSelect]);

  return (
    <canvas
      ref={canvasRef}
      onMouseMove={handleMouse}
      onClick={handleClick}
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
}

// ─── Command Palette ──────────────────────────────────────────────────────────

function CmdPalette({ open, onClose, go }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);

  const commands = [
    { label: "Go to Dashboard", hint: "Overview & briefing", action: () => { go("dashboard"); onClose(); } },
    { label: "Go to Workforce", hint: "All agents", action: () => { go("workforce"); onClose(); } },
    { label: "Go to Approvals", hint: `${DECISIONS.filter(d=>d.status==="pending").length} pending`, action: () => { go("approvals"); onClose(); } },
    { label: "Open T+1 Simulator", hint: "Simulate decisions", action: () => { go("t1"); onClose(); } },
    ...ALL_AGENTS.filter(a => a.badge).map(a => ({
      label: `Talk to ${a.name}`, hint: a.title, action: () => { go("chat", a.id); onClose(); },
    })),
    ...ALL_AGENTS.map(a => ({
      label: `View ${a.name}`, hint: `${a.title} · ${a.dept}`, action: () => { go("chat", a.id); onClose(); },
    })),
  ];

  const filtered = q ? commands.filter(c => c.label.toLowerCase().includes(q.toLowerCase()) || c.hint.toLowerCase().includes(q.toLowerCase())) : commands.slice(0, 8);

  useEffect(() => { if (open) { setQ(""); setActive(0); setTimeout(() => inputRef.current?.focus(), 50); } }, [open]);

  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); onClose("toggle"); }
      if (!open) return;
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown") { e.preventDefault(); setActive(p => Math.min(p + 1, filtered.length - 1)); }
      if (e.key === "ArrowUp") { e.preventDefault(); setActive(p => Math.max(p - 1, 0)); }
      if (e.key === "Enter" && filtered[active]) { filtered[active].action(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, active, filtered, onClose]);

  if (!open) return null;

  return (
    <div className="cmd-overlay" onClick={onClose}>
      <div className="cmd-box" onClick={e => e.stopPropagation()}>
        <input ref={inputRef} className="cmd-input" value={q} onChange={e => { setQ(e.target.value); setActive(0); }} placeholder="Type a command..." />
        <div style={{ maxHeight: 320, overflowY: "auto", padding: "6px 0" }}>
          {filtered.map((c, i) => (
            <button key={i} className={`cmd-item ${i === active ? "active" : ""}`} onClick={c.action} onMouseEnter={() => setActive(i)}>
              <div>
                <div className="label">{c.label}</div>
                <div className="hint">{c.hint}</div>
              </div>
            </button>
          ))}
          {filtered.length === 0 && <div style={{ padding: "16px 20px", color: "#334155", fontSize: 13, fontFamily: "'DM Sans', sans-serif" }}>No results</div>}
        </div>
        <div style={{ borderTop: "1px solid #151921", padding: "8px 20px", display: "flex", gap: 16 }}>
          <span style={{ fontSize: 10, color: "#334155", fontFamily: "'JetBrains Mono', monospace" }}>↑↓ navigate</span>
          <span style={{ fontSize: 10, color: "#334155", fontFamily: "'JetBrains Mono', monospace" }}>↵ select</span>
          <span style={{ fontSize: 10, color: "#334155", fontFamily: "'JetBrains Mono', monospace" }}>esc close</span>
        </div>
      </div>
    </div>
  );
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ toast, onDismiss }) {
  useEffect(() => { if (toast) { const t = setTimeout(onDismiss, 4000); return () => clearTimeout(t); } }, [toast, onDismiss]);
  if (!toast) return null;
  return (
    <div className="toast">
      <div style={{ background: "#0c1017", border: "1px solid #1e293b", borderRadius: 12, padding: "12px 18px", display: "flex", alignItems: "center", gap: 12, boxShadow: "0 12px 40px #00000060", maxWidth: 360 }}>
        <Bubble name={toast.agent} size={28} pulse />
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0", fontFamily: "'DM Sans', sans-serif" }}>{toast.agent}</div>
          <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: "'DM Sans', sans-serif" }}>{toast.text}</div>
        </div>
        <button onClick={onDismiss} style={{ background: "none", border: "none", color: "#334155", cursor: "pointer", fontSize: 14, marginLeft: 8 }}>×</button>
      </div>
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function Sidebar({ page, go, pending }) {
  const items = [
    { id: "dashboard", label: "Dashboard", icon: "◆" },
    { id: "workforce", label: "Workforce", icon: "◎" },
    { id: "chat", label: "Chat", icon: "◌" },
    { id: "approvals", label: "Approvals", icon: "◇", badge: pending },
    { id: "t1", label: "T+1 Intel", icon: "⬡" },
    { id: "onboard", label: "Onboard", icon: "▣" },
  ];

  return (
    <div style={{ width: 200, background: "#080b10", borderRight: "1px solid #151921", display: "flex", flexDirection: "column", flexShrink: 0 }}>
      <div style={{ padding: "20px 16px 16px", borderBottom: "1px solid #151921" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: "linear-gradient(135deg, #7c3aed, #3b82f6)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 15, fontFamily: "'Instrument Serif', serif" }}>G</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#f1f5f9", fontFamily: "'DM Sans', sans-serif" }}>Glyphor</div>
            <div style={{ fontSize: 9, color: "#475569", letterSpacing: 2, fontWeight: 600, textTransform: "uppercase" }}>AI Company</div>
          </div>
        </div>
      </div>
      <nav style={{ flex: 1, padding: "8px 8px" }}>
        {items.map(item => (
          <button key={item.id} onClick={() => go(item.id)} style={{
            width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 10,
            padding: "9px 12px", borderRadius: 8, fontSize: 13, border: "none", cursor: "pointer",
            fontFamily: "'DM Sans', sans-serif", fontWeight: 500, marginBottom: 1,
            background: page === item.id ? "#7c3aed15" : "transparent",
            color: page === item.id ? "#c4b5fd" : "#64748b",
            transition: "all .15s",
          }}>
            <span style={{ fontSize: 11, width: 16, textAlign: "center", opacity: page === item.id ? 1 : .5 }}>{item.icon}</span>
            {item.label}
            {item.badge > 0 && <span style={{ marginLeft: "auto", background: "#7f1d1d", color: "#fca5a5", fontSize: 10, padding: "1px 6px", borderRadius: 8, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{item.badge}</span>}
          </button>
        ))}
        <div style={{ margin: "12px 12px 0", paddingTop: 12, borderTop: "1px solid #151921" }}>
          <button onClick={() => go("cmd")} style={{
            width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 8,
            padding: "7px 0", background: "none", border: "none", cursor: "pointer",
            fontSize: 11, color: "#334155", fontFamily: "'JetBrains Mono', monospace",
          }}>
            <span style={{ background: "#151921", borderRadius: 4, padding: "2px 5px", fontSize: 10, color: "#475569" }}>⌘K</span>
            <span>Command</span>
          </button>
        </div>
      </nav>
      <div style={{ padding: "14px 16px", borderTop: "1px solid #151921" }}>
        {[{ name: "Kristina", role: "CEO", on: true }, { name: "Andrew", role: "COO", on: false }].map(f => (
          <div key={f.name} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: f.on ? "#4ade80" : "#334155", boxShadow: f.on ? "0 0 8px #4ade8050" : "none" }} />
            <span style={{ fontSize: 12, color: f.on ? "#e2e8f0" : "#475569", fontFamily: "'DM Sans', sans-serif" }}>{f.name} <span style={{ color: "#334155" }}>· {f.role}</span></span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function Dashboard({ go, showToast }) {
  const [showFull, setShowFull] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => showToast({ agent: "Stack", text: "Cache optimization complete — hit rate now 94%" }), 5000);
    return () => clearTimeout(t);
  }, []);

  const metrics = [
    { label: "MRR", value: "$3,247", trend: "+12%", spark: [1800,2100,2400,2600,2900,3100,3247], color: "#4ade80", up: true },
    { label: "Fuse Builds", value: "312", trend: "+8%", spark: [240,255,270,288,295,305,312], color: "#60a5fa", up: true },
    { label: "Pulse Creations", value: "47", trend: "+23%", spark: [12,18,22,28,33,40,47], color: "#f472b6", up: true },
    { label: "Margin", value: "62.3%", trend: "+1.2pt", spark: [56,57,58,59,60,61,62.3], color: "#a78bfa", up: true },
  ];

  return (
    <div style={{ padding: "32px 36px", maxWidth: 1060, margin: "0 auto" }}>
      {/* Hero: Constellation + Greeting */}
      <div className="card fade" style={{ padding: 0, overflow: "hidden", marginBottom: 14, display: "grid", gridTemplateColumns: "1fr 1fr", minHeight: 280 }}>
        <div style={{ padding: "32px 36px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <h1 style={{ fontSize: 30, fontWeight: 400, color: "#f1f5f9", fontFamily: "'Instrument Serif', serif", lineHeight: 1.2 }}>
            Good morning,<br />Kristina
          </h1>
          <p style={{ fontSize: 13, color: "#64748b", marginTop: 10, lineHeight: 1.6, fontFamily: "'DM Sans', sans-serif" }}>
            {ALL_AGENTS.filter(a => a.status === "active").length} agents active across {DEPARTMENTS.length} departments. All systems nominal.
          </p>
          <p style={{ fontSize: 11, color: "#334155", marginTop: 8, fontFamily: "'JetBrains Mono', monospace" }}>Feb 21, 2026 · 9:02 AM CT</p>
          <div style={{ marginTop: 20 }}>
            <button onClick={() => go("chat", "atlas")} style={{
              background: "linear-gradient(135deg, #7c3aed, #6366f1)", color: "#fff",
              border: "none", borderRadius: 10, padding: "9px 20px", fontSize: 12, fontWeight: 600,
              cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
              boxShadow: "0 0 20px #7c3aed30",
            }}>Talk to Atlas →</button>
          </div>
        </div>
        <div style={{ position: "relative", background: "#080b10" }}>
          <Constellation agents={ALL_AGENTS} onSelect={(a) => go("chat", a.id)} />
        </div>
      </div>

      {/* Metrics */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 14 }}>
        {metrics.map((m, i) => (
          <div key={i} className="card fade" style={{ padding: "16px 20px", animationDelay: `${i * .05 + .15}s` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontSize: 10, color: "#475569", letterSpacing: 1.5, fontWeight: 600, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif" }}>{m.label}</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: "#f1f5f9", marginTop: 4, fontFamily: "'DM Sans', sans-serif" }}>{m.value}</div>
                <div style={{ fontSize: 11, color: m.up ? "#4ade80" : "#fde047", marginTop: 3, fontFamily: "'JetBrains Mono', monospace" }}>{m.up?"↑":"↓"} {m.trend}</div>
              </div>
              <Spark data={m.spark} color={m.color} w={72} h={28} />
            </div>
          </div>
        ))}
      </div>

      {/* Briefing + Decisions */}
      <div style={{ display: "grid", gridTemplateColumns: "5fr 3fr", gap: 12, marginBottom: 14 }}>
        <div className="card fade" style={{ padding: "24px 28px", animationDelay: ".35s" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
            <Bubble name="Atlas" size={28} pulse />
            <span style={{ fontSize: 15, fontWeight: 600, color: "#e2e8f0", fontFamily: "'DM Sans', sans-serif" }}>Daily Briefing</span>
            <span style={{ marginLeft: "auto", fontSize: 11, color: "#334155", fontFamily: "'JetBrains Mono', monospace" }}>7:00 AM</span>
          </div>
          <div style={{ fontSize: 13.5, lineHeight: 1.75, color: "#cbd5e1", fontFamily: "'DM Sans', sans-serif" }}>
            <p style={{ marginBottom: 12 }}><span style={{ color: "#4ade80", fontWeight: 600 }}>Product</span> — Fuse hit 312 builds at 91% success. Pulse had its best day — 47 creations. E-commerce attempts surged 23%, Compass moved to P1.</p>
            <p style={{ marginBottom: 12 }}><span style={{ color: "#fde047", fontWeight: 600 }}>Market</span> — Lovable shipped GitHub integration. Moderate impact. Beacon drafting counter-narrative.</p>
            {showFull && <>
              <p style={{ marginBottom: 12 }}><span style={{ color: "#c4b5fd", fontWeight: 600 }}>Growth</span> — Blog hit 840 LinkedIn impressions in 3h. SEO 'ai website builder' now #11. Two enterprise inquiries.</p>
              <p style={{ marginBottom: 12 }}><span style={{ color: "#60a5fa", fontWeight: 600 }}>Finance</span> — MTD $847 infra. API cost +18% WoW. MRR $3,247, tracking $5K by April.</p>
              <p><span style={{ color: "#f472b6", fontWeight: 600 }}>Customers</span> — 3 at-risk, Harbor sent nurture emails. Power user flagged for case study. Cross-product at 12%.</p>
            </>}
          </div>
          <button onClick={() => setShowFull(!showFull)} style={{ fontSize: 12, color: "#7c3aed", background: "none", border: "none", cursor: "pointer", marginTop: 8, fontFamily: "'DM Sans', sans-serif", fontWeight: 500 }}>
            {showFull ? "Collapse" : "Read full briefing →"}
          </button>
        </div>

        <div className="card fade" style={{ padding: "24px", animationDelay: ".4s" }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#e2e8f0", marginBottom: 16, fontFamily: "'DM Sans', sans-serif" }}>
            Decisions <span style={{ marginLeft: 6, fontSize: 10, background: "#7f1d1d", color: "#fca5a5", padding: "2px 7px", borderRadius: 8, fontFamily: "'JetBrains Mono', monospace" }}>{DECISIONS.filter(d=>d.status==="pending").length}</span>
          </div>
          {DECISIONS.filter(d => d.status === "pending").map(d => (
            <button key={d.id} onClick={() => go("approvals")} style={{
              width: "100%", textAlign: "left", padding: "12px 14px", background: "#080b10",
              border: "1px solid #151921", borderLeft: `3px solid ${d.tier==="red"?"#ef4444":"#eab308"}`,
              borderRadius: 10, cursor: "pointer", marginBottom: 8, display: "block",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <TierLabel t={d.tier} />
                <span style={{ fontSize: 10, color: "#334155", fontFamily: "'JetBrains Mono', monospace" }}>{d.time}</span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", fontFamily: "'DM Sans', sans-serif" }}>{d.title}</div>
              <div style={{ fontSize: 11, color: "#475569", marginTop: 2, fontFamily: "'DM Sans', sans-serif" }}>from {d.from}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Activity */}
      <div className="card fade" style={{ padding: "24px 28px", animationDelay: ".45s" }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#e2e8f0", marginBottom: 16, fontFamily: "'DM Sans', sans-serif" }}>Activity</div>
        {ACTIVITY.map((item, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0", borderBottom: i < ACTIVITY.length-1 ? "1px solid #0f1318" : "none" }}>
            <span style={{ fontSize: 11, color: "#334155", width: 38, textAlign: "right", fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>{item.t}</span>
            <TierDot t={item.tier} />
            <span style={{ fontSize: 12, color: "#a78bfa", fontWeight: 600, width: 62, fontFamily: "'DM Sans', sans-serif", flexShrink: 0 }}>{item.agent}</span>
            <span style={{ fontSize: 12.5, color: "#94a3b8", fontFamily: "'DM Sans', sans-serif" }}>{item.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Workforce ────────────────────────────────────────────────────────────────

function Workforce() {
  return (
    <div style={{ padding: "32px 36px", maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 400, color: "#f1f5f9", fontFamily: "'Instrument Serif', serif" }}>Workforce</h1>
      <p style={{ fontSize: 13, color: "#64748b", marginTop: 6, fontFamily: "'DM Sans', sans-serif" }}>{ALL_AGENTS.length} agents · {DEPARTMENTS.length} departments</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 24 }}>
        {DEPARTMENTS.map((dept, di) => (
          <div key={dept.id} className="card fade" style={{ padding: 20, animationDelay: `${di*.04}s` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: dept.color }} />
              <span style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0", fontFamily: "'DM Sans', sans-serif" }}>{dept.name}</span>
            </div>
            <div style={{ fontSize: 11, color: "#475569", marginBottom: 14, fontFamily: "'DM Sans', sans-serif" }}>{dept.agents.length} agents</div>
            {dept.agents.map(a => (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: "#080b10", border: "1px solid #151921", borderRadius: 10, marginBottom: 5 }}>
                <Bubble name={a.name} size={28} pulse={a.lastActive?.includes("m ago")} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 500, fontFamily: "'DM Sans', sans-serif" }}>{a.name}</span>
                    {a.badge && <span style={{ fontSize: 8, color: dept.color }}>{a.badge}</span>}
                  </div>
                  <div style={{ fontSize: 10, color: "#475569", fontFamily: "'DM Sans', sans-serif" }}>{a.activity}</div>
                </div>
                <Score v={a.score} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

function ChatView({ initialAgent }) {
  const [sel, setSel] = useState(initialAgent ? ALL_AGENTS.find(a => a.id === initialAgent) || ALL_AGENTS[0] : ALL_AGENTS[0]);
  const [input, setInput] = useState("");
  const [extra, setExtra] = useState({});
  const [thinking, setThinking] = useState(false);
  const msgs = extra[sel.id] || CHAT_HISTORY[sel.id] || [];

  useEffect(() => {
    if (initialAgent) {
      const agent = ALL_AGENTS.find(a => a.id === initialAgent);
      if (agent) setSel(agent);
    }
  }, [initialAgent]);

  const send = () => {
    if (!input.trim()) return;
    const cur = extra[sel.id] || CHAT_HISTORY[sel.id] || [];
    const withUser = [...cur, { role: "user", text: input }];
    setExtra(p => ({ ...p, [sel.id]: withUser }));
    setInput("");
    setThinking(true);

    // Simulate agent thinking then responding
    setTimeout(() => {
      setThinking(false);
      setExtra(p => ({
        ...p,
        [sel.id]: [...(p[sel.id] || withUser), { role: "agent", text: `I've analyzed your request. Let me pull the relevant data and get back to you with a detailed response.\n\n[${sel.name} is working on this — check back shortly or switch to another agent while you wait.]`, fresh: true }]
      }));
    }, 2500);
  };

  return (
    <div style={{ display: "flex", height: "100%" }}>
      <div style={{ width: 250, background: "#080b10", borderRight: "1px solid #151921", overflowY: "auto" }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid #151921" }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#334155", letterSpacing: 2 }}>AGENTS</span>
        </div>
        {DEPARTMENTS.map(dept => (
          <div key={dept.id}>
            <div style={{ padding: "10px 16px 4px" }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: "#1e293b", letterSpacing: 2 }}>{dept.name.toUpperCase()}</span>
            </div>
            {dept.agents.map(a => (
              <button key={a.id} onClick={() => { setSel(a); setThinking(false); }} style={{
                width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 10,
                padding: "7px 16px", border: "none", cursor: "pointer",
                borderLeft: sel.id === a.id ? `2px solid ${dept.color}` : "2px solid transparent",
                background: sel.id === a.id ? `${dept.color}10` : "transparent",
              }}>
                <Bubble name={a.name} size={26} pulse={a.status === "active" && a.lastActive?.includes("m ago")} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: sel.id === a.id ? "#e2e8f0" : "#64748b", fontWeight: 500, fontFamily: "'DM Sans', sans-serif" }}>{a.name}</div>
                  <div style={{ fontSize: 10, color: "#334155", fontFamily: "'DM Sans', sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</div>
                </div>
                <Score v={a.score} />
              </button>
            ))}
          </div>
        ))}
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "12px 24px", borderBottom: "1px solid #151921", display: "flex", alignItems: "center", gap: 14 }}>
          <Bubble name={sel.name} size={36} pulse glow />
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: "#f1f5f9", fontFamily: "'DM Sans', sans-serif" }}>{sel.name}</span>
              {sel.badge && <span style={{ fontSize: 9, background: `${sel.deptColor}22`, color: sel.deptColor, padding: "2px 8px", borderRadius: 8, border: `1px solid ${sel.deptColor}33` }}>{sel.title}</span>}
            </div>
            <div style={{ fontSize: 11, color: "#475569", fontFamily: "'DM Sans', sans-serif", marginTop: 2 }}>{sel.activity} · {sel.lastActive}</div>
          </div>
          <Score v={sel.score} />
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
          {msgs.length > 0 ? (
            <div style={{ maxWidth: 660, margin: "0 auto" }}>
              {msgs.map((m, i) => (
                <div key={i} style={{
                  display: "flex", gap: 12, marginBottom: 18, flexDirection: m.role === "user" ? "row-reverse" : "row",
                  animation: m.fresh ? "fadeUp .4s ease-out" : `fadeUp .3s ease-out ${i * .03}s both`,
                }}>
                  {m.role !== "user" && <Bubble name={sel.name} size={26} />}
                  <div style={{
                    background: m.role === "user" ? "#1e293b" : "#0c1017",
                    border: `1px solid ${m.role === "user" ? "#334155" : "#151921"}`,
                    borderRadius: 14, padding: "14px 18px", maxWidth: 520,
                  }}>
                    <div style={{ fontSize: 13.5, lineHeight: 1.7, color: "#e2e8f0", whiteSpace: "pre-wrap", fontFamily: "'DM Sans', sans-serif" }}>{m.text}</div>
                  </div>
                </div>
              ))}
              {/* Thinking state */}
              {thinking && (
                <div style={{ display: "flex", gap: 12, marginBottom: 18, animation: "fadeUp .3s ease-out" }}>
                  <Bubble name={sel.name} size={26} pulse />
                  <div className="thinking-bubble">
                    <div className="thinking-dots">
                      <span />{" "}<span />{" "}<span />
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%" }}>
              <Bubble name={sel.name} size={64} pulse glow />
              <h3 style={{ fontSize: 20, fontWeight: 400, color: "#e2e8f0", marginTop: 16, fontFamily: "'Instrument Serif', serif" }}>{sel.name}</h3>
              <p style={{ fontSize: 13, color: "#475569", fontFamily: "'DM Sans', sans-serif" }}>{sel.title} · {sel.dept}</p>
              <p style={{ fontSize: 12, color: "#334155", marginTop: 14, maxWidth: 300, textAlign: "center", lineHeight: 1.6, fontFamily: "'DM Sans', sans-serif" }}>
                Each agent runs its own async conversation. Switch freely — nothing is lost.
              </p>
            </div>
          )}
        </div>

        <div style={{ padding: "14px 24px", borderTop: "1px solid #151921" }}>
          <div style={{ maxWidth: 660, margin: "0 auto", display: "flex", gap: 10 }}>
            <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} placeholder={`Message ${sel.name}...`}
              style={{ flex: 1, background: "#0c1017", border: "1px solid #1e293b", borderRadius: 12, padding: "11px 18px", fontSize: 13, color: "#f1f5f9", outline: "none", fontFamily: "'DM Sans', sans-serif" }}
            />
            <button onClick={send} disabled={thinking} style={{
              background: thinking ? "#4c1d95" : "#7c3aed", color: "#fff", border: "none", borderRadius: 12,
              padding: "11px 22px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
              opacity: thinking ? .6 : 1,
            }}>{thinking ? "..." : "Send"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Approvals ────────────────────────────────────────────────────────────────

function Approvals({ showToast }) {
  const [filter, setFilter] = useState("pending");
  const [decisions, setDecisions] = useState(DECISIONS);
  const [animating, setAnimating] = useState(null);

  const act = (id, status) => {
    setAnimating({ id, status });
    showToast({ agent: status === "approved" ? "Atlas" : "Atlas", text: `Decision ${status}: ${decisions.find(d=>d.id===id)?.title}` });
    setTimeout(() => {
      setDecisions(p => p.map(d => d.id === id ? { ...d, status } : d));
      setAnimating(null);
    }, 600);
  };

  const filtered = decisions.filter(d => filter === "all" ? true : filter === "auto" ? d.status === "auto" : d.status === filter);

  return (
    <div style={{ padding: "32px 36px", maxWidth: 800, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 400, color: "#f1f5f9", fontFamily: "'Instrument Serif', serif" }}>Approvals</h1>
      <p style={{ fontSize: 13, color: "#64748b", marginTop: 6, fontFamily: "'DM Sans', sans-serif" }}>{decisions.filter(d=>d.status==="pending").length} decisions awaiting review</p>

      <div style={{ display: "flex", gap: 4, margin: "20px 0" }}>
        {["pending","all","approved","rejected","auto"].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            fontSize: 12, padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontWeight: 500,
            background: filter === f ? "#7c3aed15" : "transparent", border: `1px solid ${filter === f ? "#7c3aed33" : "#151921"}`, color: filter === f ? "#c4b5fd" : "#475569",
          }}>{f === "auto" ? "Auto" : f.charAt(0).toUpperCase()+f.slice(1)}</button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", color: "#334155", padding: 60, fontSize: 14, fontFamily: "'DM Sans', sans-serif" }}>No {filter} decisions.</div>
      ) : filtered.map((d, i) => (
        <div key={d.id} className="fade" style={{
          background: animating?.id === d.id ? (animating.status === "approved" ? "#14532d20" : "#7f1d1d20") : "#0c1017",
          border: "1px solid #151921", borderLeft: `3px solid ${d.tier==="red"?"#ef4444":d.tier==="yellow"?"#eab308":"#22c55e"}`,
          borderRadius: 14, padding: "22px 24px", marginBottom: 12, animationDelay: `${i*.04}s`,
          transition: "background .6s",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <TierLabel t={d.tier} />
              <span style={{ fontSize: 11, color: "#334155", fontFamily: "'JetBrains Mono', monospace" }}>{d.time}</span>
              {d.status !== "pending" && <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 8, fontWeight: 600, fontFamily: "'DM Sans', sans-serif", background: d.status.includes("approv") ? "#14532d" : d.status === "rejected" ? "#7f1d1d" : "#1e293b", color: d.status.includes("approv") ? "#86efac" : d.status === "rejected" ? "#fca5a5" : "#64748b" }}>{d.status}</span>}
            </div>
            {d.to.length > 0 && <span style={{ fontSize: 11, color: "#334155", fontFamily: "'DM Sans', sans-serif" }}>→ {d.to.join(" & ")}</span>}
          </div>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: "#f1f5f9", fontFamily: "'DM Sans', sans-serif" }}>{d.title}</h3>
          <div style={{ fontSize: 11, color: "#475569", marginTop: 3, marginBottom: 8, fontFamily: "'DM Sans', sans-serif" }}>from {d.from}</div>
          <p style={{ fontSize: 13.5, color: "#cbd5e1", lineHeight: 1.6, fontFamily: "'DM Sans', sans-serif" }}>{d.summary}</p>
          {d.reasoning && <details style={{ marginTop: 10 }}>
            <summary style={{ fontSize: 11, color: "#475569", cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>View reasoning</summary>
            <p style={{ fontSize: 12, color: "#94a3b8", marginTop: 8, paddingLeft: 14, borderLeft: "2px solid #1e293b", lineHeight: 1.6, fontFamily: "'DM Sans', sans-serif" }}>{d.reasoning}</p>
          </details>}
          {d.status === "pending" && (
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button onClick={() => act(d.id,"approved")} style={{ fontSize: 12, padding: "8px 20px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontFamily: "'DM Sans', sans-serif", background: "#14532d", border: "1px solid #16a34a44", color: "#86efac" }}>Approve</button>
              <button onClick={() => act(d.id,"rejected")} style={{ fontSize: 12, padding: "8px 20px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontFamily: "'DM Sans', sans-serif", background: "#7f1d1d", border: "1px solid #dc262644", color: "#fca5a5" }}>Reject</button>
              <button style={{ fontSize: 12, padding: "8px 20px", borderRadius: 8, cursor: "pointer", fontWeight: 500, fontFamily: "'DM Sans', sans-serif", background: "#080b10", border: "1px solid #1e293b", color: "#64748b" }}>Discuss</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── T+1 ──────────────────────────────────────────────────────────────────────

function T1() {
  const [action, setAction] = useState("");
  const [sim, setSim] = useState(false);
  const [result, setResult] = useState(null);
  const examples = ["Launch Glyphor Flow", "Raise Fuse to $49/mo", "Shift 60% focus to Pulse", "Open enterprise sales"];

  const run = () => {
    if (!action.trim()) return;
    setSim(true); setResult(null);
    setTimeout(() => {
      setSim(false);
      setResult({
        conf: 87,
        items: [
          { area: "Revenue", icon: "↑", tone: "pos", text: "+18% MRR within 6 months. 37 day-one candidates." },
          { area: "Engineering", icon: "→", tone: "neu", text: "70% Fuse runtime reuse. 4-6 weeks. Minimal distraction." },
          { area: "Market Position", icon: "↑", tone: "pos", text: "First-mover. No competitor. Strengthens platform narrative." },
          { area: "Financial", icon: "⚠", tone: "warn", text: "+$2,400/mo infra. Break-even at 30 customers (~4 months)." },
          { area: "Customers", icon: "↑", tone: "pos", text: "37 users immediate. Cross-sell boosts retention." },
          { area: "Operations", icon: "⚠", tone: "warn", text: "+2 sub-agents. CoS routing update needed." },
        ],
        rec: "PROCEED WITH PHASED LAUNCH. (1) MVP reusing Fuse runtime, (2) Beta with 37 users, (3) Full launch after 90% satisfaction.",
      });
    }, 2500);
  };

  const tones = { pos: { bg: "#14532d30", border: "#16a34a25", color: "#86efac" }, warn: { bg: "#71371230", border: "#ca8a0425", color: "#fde047" }, neu: { bg: "#1e293b50", border: "#33415530", color: "#94a3b8" } };

  return (
    <div style={{ padding: "32px 36px", maxWidth: 760, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 400, color: "#f1f5f9", fontFamily: "'Instrument Serif', serif" }}>T+1 Intelligence</h1>
      <p style={{ fontSize: 13, color: "#64748b", marginTop: 6, fontFamily: "'DM Sans', sans-serif" }}>Simulate consequences before you commit</p>

      <div className="card fade" style={{ padding: 24, marginTop: 24 }}>
        <textarea value={action} onChange={e => setAction(e.target.value)} placeholder="Describe an action to simulate..."
          style={{ width: "100%", background: "#080b10", border: "1px solid #1e293b", borderRadius: 12, padding: 14, fontSize: 14, color: "#f1f5f9", resize: "none", height: 80, outline: "none", fontFamily: "'DM Sans', sans-serif", lineHeight: 1.6 }} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
          {examples.map((ex, i) => (
            <button key={i} onClick={() => setAction(ex)} style={{ fontSize: 11, color: "#64748b", background: "#080b10", border: "1px solid #1e293b", borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>{ex}</button>
          ))}
        </div>
        <button onClick={run} disabled={!action.trim() || sim} style={{
          marginTop: 16, background: sim ? "#4c1d95" : "linear-gradient(135deg, #7c3aed, #6366f1)", color: "#fff",
          border: "none", borderRadius: 12, padding: "12px 28px", fontSize: 14, fontWeight: 600,
          cursor: "pointer", fontFamily: "'DM Sans', sans-serif", opacity: !action.trim() ? .4 : 1,
          boxShadow: sim ? "none" : "0 0 20px #7c3aed25",
        }}>{sim ? "⚡ Simulating..." : "⚡ Simulate T+1"}</button>
      </div>

      {result && (
        <div className="card" style={{ padding: 24, marginTop: 12, animation: "fadeUp .4s ease-out" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 18 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: "#e2e8f0", fontFamily: "'DM Sans', sans-serif" }}>Results</span>
            <span style={{ fontSize: 14, fontFamily: "'JetBrains Mono', monospace", color: "#4ade80" }}>{result.conf}%</span>
          </div>
          {result.items.map((c, i) => {
            const tn = tones[c.tone];
            return (
              <div key={i} className="fade" style={{ display: "flex", gap: 14, padding: "12px 14px", marginBottom: 6, borderRadius: 10, background: tn.bg, border: `1px solid ${tn.border}`, animationDelay: `${i*.06}s` }}>
                <span style={{ fontSize: 14, color: tn.color, width: 18, textAlign: "center", flexShrink: 0 }}>{c.icon}</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", fontFamily: "'DM Sans', sans-serif" }}>{c.area}</div>
                  <div style={{ fontSize: 12.5, color: "#cbd5e1", marginTop: 3, lineHeight: 1.5, fontFamily: "'DM Sans', sans-serif" }}>{c.text}</div>
                </div>
              </div>
            );
          })}
          <div style={{ background: "#7c3aed0d", border: "1px solid #7c3aed1a", borderRadius: 12, padding: 18, marginTop: 14 }}>
            <div style={{ fontSize: 9, color: "#a78bfa", fontWeight: 700, letterSpacing: 1.5, marginBottom: 8, fontFamily: "'DM Sans', sans-serif" }}>RECOMMENDATION</div>
            <p style={{ fontSize: 13.5, color: "#e2e8f0", lineHeight: 1.7, fontFamily: "'DM Sans', sans-serif" }}>{result.rec}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Onboard ──────────────────────────────────────────────────────────────────

function Onboard() {
  const fields = [
    { label: "Company", value: "Glyphor", sub: "AI Platform Company · Dallas, TX" },
    { label: "Founders", value: "Kristina (CEO) + Andrew (COO)", sub: "Full-time at Microsoft · 5-10h/week" },
    { label: "Products", value: "Fuse + Pulse", sub: "Autonomous dev · Autonomous creative" },
    { label: "Mission", value: "Replace development teams with AI agents", sub: "Solo founders → SMBs → Enterprise" },
    { label: "Voice", value: "Bold, technical, visionary", sub: "Builder energy. Not salesy." },
    { label: "Stack", value: "GCP · Gemini · Supabase · Vercel", sub: "TypeScript · Python · Cloud Run" },
    { label: "Comms", value: "Microsoft Teams + Outlook", sub: "Briefings, decisions, alerts" },
    { label: "Q1 Goals", value: "$5K MRR · 100 users · Pulse launch", sub: "Enterprise pilot · 3rd product eval" },
  ];
  return (
    <div style={{ padding: "32px 36px", maxWidth: 700, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 400, color: "#f1f5f9", fontFamily: "'Instrument Serif', serif" }}>Company Profile</h1>
      <p style={{ fontSize: 13, color: "#64748b", marginTop: 6, fontFamily: "'DM Sans', sans-serif" }}>Feeds every agent's context</p>
      <div style={{ marginTop: 24 }}>
        {fields.map((f, i) => (
          <div key={i} className="card fade" style={{ display: "flex", gap: 16, padding: "16px 20px", marginBottom: 8, animationDelay: `${i*.04}s`, alignItems: "flex-start" }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: "#14532d", display: "flex", alignItems: "center", justifyContent: "center", color: "#4ade80", fontSize: 12, fontWeight: 600, flexShrink: 0 }}>✓</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 9, color: "#334155", letterSpacing: 1.5, fontWeight: 700, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif" }}>{f.label}</div>
              <div style={{ fontSize: 14, color: "#f1f5f9", fontWeight: 500, marginTop: 4, fontFamily: "'DM Sans', sans-serif" }}>{f.value}</div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 2, fontFamily: "'DM Sans', sans-serif" }}>{f.sub}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [page, setPage] = useState("dashboard");
  const [chatAgent, setChatAgent] = useState(null);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const pending = DECISIONS.filter(d => d.status === "pending").length;

  const go = useCallback((p, agentId) => {
    setPage(p);
    if (p === "chat" && agentId) setChatAgent(agentId);
    if (p === "cmd") setCmdOpen(true);
  }, []);

  const handleCmdClose = useCallback((action) => {
    if (action === "toggle") { setCmdOpen(p => !p); } else { setCmdOpen(false); }
  }, []);

  const showToast = useCallback((t) => setToast(t), []);

  return (
    <>
      <style>{CSS}</style>
      <div style={{ display: "flex", height: "100vh", background: "#0a0f15", overflow: "hidden" }}>
        <Sidebar page={page} go={go} pending={pending} />
        <main style={{ flex: 1, overflowY: "auto" }}>
          {page === "dashboard" && <Dashboard go={go} showToast={showToast} />}
          {page === "workforce" && <Workforce />}
          {page === "chat" && <ChatView initialAgent={chatAgent} />}
          {page === "approvals" && <Approvals showToast={showToast} />}
          {page === "t1" && <T1 />}
          {page === "onboard" && <Onboard />}
        </main>
      </div>
      <CmdPalette open={cmdOpen} onClose={handleCmdClose} go={go} />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
