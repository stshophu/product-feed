// render_trigger.js — run by a Render cron job every 15 minutes.
//
// GitHub's own `schedule:` trigger is unreliable for this repo: after the
// workflows were re-enabled on 12 Nov 2026 they fired every 5–6 hours instead
// of hourly. Render's cron runs on time, so it starts the GitHub workflows
// via workflow_dispatch instead:
//   :00        -> sync.yml (incremental catalog sync)
//   :15, :45   -> sync_stock_light.yml (stock / sold-out refresh)
//   :30        -> nothing (catalog sync used to run hourly only)
//
// The GitHub schedules stay in place as a fallback. Both workflows share the
// "marketplace-api" concurrency group, so an extra trigger just queues behind
// a running sync instead of running in parallel.
//
// Needs env GH_TOKEN: a fine-grained GitHub token with access to
// stshophu/product-feed only, permission "Actions: Read and write".

const REPO = process.env.GH_REPO || "stshophu/product-feed";
const TOKEN = process.env.GH_TOKEN;

async function dispatch(workflow, inputs) {
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "render-wsnl-trigger",
      },
      body: JSON.stringify({ ref: "main", ...(inputs ? { inputs } : {}) }),
    }
  );
  if (res.status !== 204) {
    throw new Error(`${workflow}: HTTP ${res.status} ${await res.text()}`);
  }
  console.log(`✅ dispatched ${workflow}${inputs ? " " + JSON.stringify(inputs) : ""}`);
}

(async () => {
  if (!TOKEN) {
    console.error("💥 GH_TOKEN is not set");
    process.exit(1);
  }
  // Round to the nearest quarter hour so a job that starts a few seconds
  // late (e.g. 10:00:40 or 09:59:55) still maps to the right slot.
  const now = new Date();
  const mins = now.getUTCMinutes() + now.getUTCSeconds() / 60;
  const slot = (Math.round(mins / 15) * 15) % 60;
  const force = process.argv[2]; // optional: "catalog" | "stock"

  if (force === "catalog" || (!force && slot === 0)) {
    await dispatch("sync.yml", { mode: "incremental" });
  } else if (force === "stock" || (!force && (slot === 15 || slot === 45))) {
    await dispatch("sync_stock_light.yml");
  } else {
    console.log(`⏭️  slot :${String(slot).padStart(2, "0")} - nothing to start`);
  }
})().catch((e) => {
  console.error("💥", e.message);
  process.exit(1);
});
