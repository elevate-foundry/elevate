import { AgentPresenceNetwork, type PresenceEvidenceEntry, type PresenceNetworkEvent } from "../src/collective-presence.ts";
import {
  consumeLangGraphNdjsonStream,
  LangGraphPresenceAdapter,
  parseLangGraphNdjson,
  type LangGraphStreamEvent,
} from "../src/langgraph-adapter.ts";

const canvas = document.querySelector<HTMLCanvasElement>("#collective")!;
const context = canvas.getContext("2d")!;
const evidenceLog = document.querySelector<HTMLElement>("#evidence-log")!;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const colors: Record<string, [number, number, number]> = {
  idle: [117, 211, 255], thinking: [128, 150, 255], tool: [255, 193, 94],
  waiting: [255, 139, 207], happy: [104, 239, 176], error: [255, 94, 117],
  cancelled: [180, 142, 255], sleep: [113, 147, 194],
};
const identities: Record<string, [number, number, number]> = {
  planner: [156, 128, 255], researcher: [91, 217, 232], builder: [255, 190, 93],
};

let network = new AgentPresenceNetwork(0xc011ec71);
let lastFrame = performance.now();
let lastSequence = -1;
let timers: number[] = [];
let handoffCounter = 0;
let streamAbort: AbortController | undefined;

function clearTimers() {
  for (const timer of timers) clearTimeout(timer);
  timers = [];
  streamAbort?.abort();
  streamAbort = undefined;
}

function schedule(delay: number, action: () => void) {
  timers.push(window.setTimeout(action, delay));
}

function dispatch(event: PresenceNetworkEvent) {
  network.dispatch(event);
}

function resetNetwork() {
  clearTimers();
  network = new AgentPresenceNetwork(0xc011ec71);
  dispatch({ type: "agent_added", agentId: "planner", label: "Planner" });
  dispatch({ type: "agent_added", agentId: "researcher", label: "Researcher" });
  dispatch({ type: "agent_added", agentId: "builder", label: "Builder" });
}

function playLangGraphEvents(events: readonly LangGraphStreamEvent[]) {
  clearTimers();
  network = new AgentPresenceNetwork(0xc011ec71);
  const adapter = new LangGraphPresenceAdapter();
  const origin = events[0]?.timestamp ?? 0;
  for (const event of events) {
    const delay = Math.max(0, (event.timestamp ?? origin) - origin);
    schedule(delay, () => {
      for (const presenceEvent of adapter.ingest(event)) dispatch(presenceEvent);
    });
  }
}

async function playLangGraphTrace() {
  const response = await fetch("./langgraph-example.ndjson");
  if (!response.ok) throw new Error(`Could not load LangGraph trace: HTTP ${response.status}`);
  playLangGraphEvents(parseLangGraphNdjson(await response.text()));
}

async function connectLiveStream() {
  clearTimers();
  network = new AgentPresenceNetwork(0xc011ec71);
  const adapter = new LangGraphPresenceAdapter();
  const url = document.querySelector<HTMLInputElement>("#stream-url")!.value.trim();
  streamAbort = new AbortController();
  const response = await fetch(url, { signal: streamAbort.signal, headers: { Accept: "application/x-ndjson" } });
  if (!response.ok || !response.body) throw new Error(`LangGraph stream failed: HTTP ${response.status}`);
  await consumeLangGraphNdjsonStream(response.body, (event) => {
    for (const presenceEvent of adapter.ingest(event)) dispatch(presenceEvent);
  });
  streamAbort = undefined;
}

function playStory() {
  resetNetwork();
  schedule(450, () => dispatch({ type: "agent_event", agentId: "planner", event: { type: "run_start" } }));
  schedule(900, () => dispatch({ type: "agent_event", agentId: "planner", event: { type: "tool_start", id: "plan-search", name: "search" } }));
  schedule(2300, () => dispatch({ type: "agent_event", agentId: "planner", event: { type: "tool_end", id: "plan-search", isError: false } }));
  schedule(2450, () => dispatch({ type: "handoff_started", handoffId: "plan-to-research", from: "planner", to: "researcher", artifactId: "research-brief" }));
  schedule(4400, () => {
    dispatch({ type: "handoff_completed", handoffId: "plan-to-research" });
    dispatch({ type: "agent_event", agentId: "planner", event: { type: "settled" } });
    dispatch({ type: "agent_event", agentId: "researcher", event: { type: "run_start" } });
    dispatch({ type: "agent_event", agentId: "researcher", event: { type: "tool_start", id: "evidence-read", name: "read" } });
  });
  schedule(6700, () => dispatch({ type: "agent_event", agentId: "researcher", event: { type: "tool_end", id: "evidence-read", isError: false } }));
  schedule(6900, () => dispatch({ type: "handoff_started", handoffId: "research-to-build", from: "researcher", to: "builder", artifactId: "evidence-bundle" }));
  schedule(8900, () => {
    dispatch({ type: "handoff_completed", handoffId: "research-to-build" });
    dispatch({ type: "agent_event", agentId: "researcher", event: { type: "settled" } });
    dispatch({ type: "agent_event", agentId: "builder", event: { type: "run_start" } });
    dispatch({ type: "agent_event", agentId: "builder", event: { type: "tool_start", id: "implementation", name: "edit" } });
  });
  schedule(11200, () => {
    dispatch({ type: "agent_event", agentId: "builder", event: { type: "tool_end", id: "implementation", isError: false } });
    dispatch({ type: "agent_event", agentId: "builder", event: { type: "settled" } });
  });
}

function parallelWork() {
  clearTimers();
  for (const [agentId, tool] of [["planner", "search"], ["researcher", "read"], ["builder", "edit"]] as const) {
    dispatch({ type: "agent_event", agentId, event: { type: "run_start" } });
    dispatch({ type: "agent_event", agentId, event: { type: "tool_start", id: `parallel-${agentId}`, name: tool } });
  }
  schedule(2800, () => {
    for (const agentId of ["planner", "researcher", "builder"] as const) {
      dispatch({ type: "agent_event", agentId, event: { type: "tool_end", id: `parallel-${agentId}`, isError: false } });
      dispatch({ type: "agent_event", agentId, event: { type: "settled" } });
    }
  });
}

function handoffArtifact() {
  clearTimers();
  const handoffId = `manual-${++handoffCounter}`;
  dispatch({ type: "agent_event", agentId: "planner", event: { type: "run_start" } });
  dispatch({ type: "handoff_started", handoffId, from: "planner", to: "builder", artifactId: `artifact-${handoffCounter}` });
  schedule(2400, () => {
    dispatch({ type: "handoff_completed", handoffId });
    dispatch({ type: "agent_event", agentId: "planner", event: { type: "settled" } });
    dispatch({ type: "agent_event", agentId: "builder", event: { type: "run_start" } });
  });
}

function agentError() {
  clearTimers();
  dispatch({ type: "agent_event", agentId: "researcher", event: { type: "run_start" } });
  dispatch({ type: "agent_event", agentId: "researcher", event: { type: "tool_start", id: "failed-read", name: "read" } });
  schedule(900, () => {
    dispatch({ type: "agent_event", agentId: "researcher", event: { type: "tool_end", id: "failed-read", isError: true } });
    dispatch({ type: "agent_event", agentId: "researcher", event: { type: "message_end", stopReason: "error" } });
    dispatch({ type: "agent_event", agentId: "researcher", event: { type: "settled" } });
  });
}

function replayEvidence() {
  const tape = network.exportTape();
  if (!tape.length) return;
  clearTimers();
  network = new AgentPresenceNetwork(0xc011ec71);
  const origin = tape[0].at;
  for (const entry of tape) schedule(Math.max(0, entry.at - origin), () => dispatch(entry.event));
}

function describe(entry: PresenceEvidenceEntry) {
  const event = entry.event;
  if (event.type === "agent_event") return `${event.agentId}: ${event.event.type}`;
  if (event.type === "handoff_started") return `${event.from} → ${event.to}: ${event.artifactId}`;
  if (event.type === "handoff_completed") return `${event.handoffId}: ${event.isError ? "failed" : "completed"}`;
  if (event.type === "agent_added") return `${event.agentId}: identity created`;
  return `${event.agentId}: identity removed`;
}

function updateEvidence(tape: readonly PresenceEvidenceEntry[]) {
  const sequence = tape.at(-1)?.sequence ?? 0;
  if (sequence === lastSequence) return;
  lastSequence = sequence;
  evidenceLog.replaceChildren(...tape.slice(-8).reverse().map((entry) => {
    const element = document.createElement("div");
    element.className = "entry";
    const title = document.createElement("b");
    title.textContent = `#${entry.sequence} · ${(entry.at / 1000).toFixed(2)}s`;
    const copy = document.createElement("span");
    copy.textContent = describe(entry);
    element.append(title, copy);
    return element;
  }));
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  const scale = Math.min(devicePixelRatio, 2);
  canvas.width = Math.max(1, Math.round(rect.width * scale));
  canvas.height = Math.max(1, Math.round(rect.height * scale));
  context.setTransform(scale, 0, 0, scale, 0, 0);
}

function render(now: number) {
  const elapsed = Math.max(0, Math.min(80, now - lastFrame));
  if (!reduceMotion || elapsed >= 250) {
    network.advanceTime(elapsed);
    lastFrame = now;
  }
  const frame = network.snapshot();
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  context.clearRect(0, 0, width, height);

  const centers = new Map(frame.agents.map((agent) => [agent.agentId, {
    x: (agent.viewport.x + agent.viewport.width / 2) * width,
    y: (agent.viewport.y + agent.viewport.height / 2) * height,
  }]));
  for (const handoff of frame.handoffs) {
    const start = centers.get(handoff.from)!;
    const end = centers.get(handoff.to)!;
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.quadraticCurveTo((start.x + end.x) / 2, Math.min(start.y, end.y) - 70, end.x, end.y);
    context.strokeStyle = handoff.status === "error" ? "rgba(255,94,117,.32)" : "rgba(126,220,255,.22)";
    context.lineWidth = 1;
    context.stroke();
    for (const particle of handoff.particles) {
      const x = particle.x * width;
      const y = particle.y * height;
      context.beginPath();
      context.arc(x, y, 2.2, 0, Math.PI * 2);
      context.fillStyle = handoff.status === "error" ? "#ff6c82" : "#a9ecff";
      context.fill();
    }
  }

  context.globalCompositeOperation = "lighter";
  for (const agent of frame.agents) {
    const identity = identities[agent.agentId] ?? colors[agent.frame.mood] ?? colors.idle;
    const moodColor = colors[agent.frame.mood] ?? identity;
    const red = Math.round((identity[0] + moodColor[0]) / 2);
    const green = Math.round((identity[1] + moodColor[1]) / 2);
    const blue = Math.round((identity[2] + moodColor[2]) / 2);
    for (const particle of agent.frame.particles) {
      const x = (agent.viewport.x + particle.x * agent.viewport.width) * width;
      const y = (agent.viewport.y + particle.y * agent.viewport.height) * height;
      const vx = particle.vx * agent.viewport.width * width;
      const vy = particle.vy * agent.viewport.height * height;
      const speed = Math.hypot(vx, vy);
      if (speed > 0.4) {
        context.beginPath();
        context.moveTo(x - vx * 0.7, y - vy * 0.7);
        context.lineTo(x, y);
        context.strokeStyle = `rgba(${red},${green},${blue},${Math.min(.24, speed * .02)})`;
        context.lineWidth = .7;
        context.stroke();
      }
      const radius = particle.core ? 1.8 : 0.9 + particle.role * 0.8;
      context.beginPath();
      context.arc(x, y, radius * 3.5, 0, Math.PI * 2);
      context.fillStyle = `rgba(${red},${green},${blue},${particle.core ? .055 : .025})`;
      context.fill();
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fillStyle = `rgba(${Math.min(255, red + 45)},${Math.min(255, green + 45)},${Math.min(255, blue + 45)},.82)`;
      context.fill();
    }
    const labelX = (agent.viewport.x + agent.viewport.width / 2) * width;
    const labelY = (agent.viewport.y + agent.viewport.height) * height + 15;
    context.globalCompositeOperation = "source-over";
    context.textAlign = "center";
    context.font = "700 11px ui-monospace, monospace";
    context.fillStyle = `rgb(${red},${green},${blue})`;
    context.fillText(`${agent.label.toUpperCase()} · ${agent.frame.label.toUpperCase()}`, labelX, Math.min(height - 76, labelY));
    context.globalCompositeOperation = "lighter";
  }
  context.globalCompositeOperation = "source-over";

  const count = Math.max(1, frame.agents.length);
  const mean = (key: "cohesion" | "polarization") => frame.agents.reduce((sum, agent) => sum + agent.order[key], 0) / count;
  document.querySelector("#agent-count")!.textContent = String(frame.agents.length);
  document.querySelector("#handoff-count")!.textContent = String(frame.handoffs.length);
  document.querySelector("#cohesion")!.textContent = mean("cohesion").toFixed(2);
  document.querySelector("#polarization")!.textContent = mean("polarization").toFixed(2);
  document.querySelector("#clusters")!.textContent = `${frame.agents.reduce((sum, agent) => sum + agent.order.clusters, 0)} clusters`;
  document.querySelector("#sequence")!.textContent = String(frame.sequence);
  updateEvidence(network.exportTape());
  requestAnimationFrame(render);
}

document.querySelector("[data-action=live]")!.addEventListener("click", () => {
  connectLiveStream().catch((error) => {
    if (error instanceof DOMException && error.name === "AbortError") return;
    console.error(error);
  });
});
document.querySelector("[data-action=langgraph]")!.addEventListener("click", () => {
  playLangGraphTrace().catch((error) => console.error(error));
});
const langGraphFile = document.querySelector<HTMLInputElement>("#langgraph-file")!;
document.querySelector("[data-action=load]")!.addEventListener("click", () => langGraphFile.click());
langGraphFile.addEventListener("change", async () => {
  const file = langGraphFile.files?.[0];
  if (!file) return;
  try { playLangGraphEvents(parseLangGraphNdjson(await file.text())); }
  catch (error) { console.error(error); }
  finally { langGraphFile.value = ""; }
});
document.querySelector("[data-action=story]")!.addEventListener("click", playStory);
document.querySelector("[data-action=parallel]")!.addEventListener("click", parallelWork);
document.querySelector("[data-action=handoff]")!.addEventListener("click", handoffArtifact);
document.querySelector("[data-action=error]")!.addEventListener("click", agentError);
document.querySelector("[data-action=replay]")!.addEventListener("click", replayEvidence);
document.querySelector("[data-action=reset]")!.addEventListener("click", resetNetwork);
addEventListener("resize", resize);
resize();
playLangGraphTrace().catch(() => playStory());
requestAnimationFrame(render);
