import { AgentFaceEngine } from "../src/presence.ts";
import { SalVoiceAdapter } from "./sal-voice.ts";

const canvas = document.querySelector<HTMLCanvasElement>("#face")!;
const context = canvas.getContext("2d")!;
const stateText = document.querySelector<HTMLElement>("#state")!;
const motifText = document.querySelector<HTMLElement>("#motif")!;
const eventText = document.querySelector<HTMLElement>("#event")!;
const seedText = document.querySelector<HTMLElement>("#seed")!;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

function hash32(value: string) {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

const parameters = new URLSearchParams(location.search);
const identity = parameters.get("identity") ?? "agent-face:pi:ryan:primary:v1";
const session = parameters.get("session");
const seed = hash32(session ? `${identity}:${session}` : identity);
const engine = new AgentFaceEngine(seed, "idle", "emergent-face");
seedText.textContent = `0x${seed.toString(16).padStart(8, "0")}`;

let lastAdvance = performance.now();
let activeTool: string | undefined;
let toolCounter = 0;
let scheduled: number[] = [];
let lastSalPulse = 0;
const salVoice = new SalVoiceAdapter();

const colors: Record<string, [number, number, number]> = {
  idle: [117, 211, 255], thinking: [128, 150, 255], tool: [255, 193, 94],
  waiting: [255, 139, 207], happy: [104, 239, 176], error: [255, 94, 117],
  cancelled: [180, 142, 255], sleep: [113, 147, 194],
};
const salMemberColors: [number, number, number][] = [
  [158, 126, 255], [105, 174, 255], [92, 222, 222], [126, 207, 255], [191, 139, 255],
];

function record(label: string) {
  eventText.textContent = label;
}

function clearSchedule() {
  for (const timer of scheduled) clearTimeout(timer);
  scheduled = [];
  salVoice.stop();
}

function schedule(delay: number, action: () => void) {
  scheduled.push(window.setTimeout(action, delay));
}

function ensureRun() {
  if (["idle", "happy", "cancelled", "error", "sleep"].includes(engine.mood)) {
    engine.dispatch({ type: "run_start" });
  }
}

function endTool(isError = false) {
  if (!activeTool) return;
  engine.dispatch({ type: "tool_end", id: activeTool, isError });
  record(isError ? "tool error" : "tool completed");
  activeTool = undefined;
}

function startTool(name: string, duration = 5000) {
  ensureRun();
  endTool();
  const id = `demo-${++toolCounter}`;
  activeTool = id;
  engine.dispatch({ type: "tool_start", id, name });
  record(`tool started: ${name}`);
  schedule(duration, () => endTool());
}

function playStory() {
  clearSchedule();
  engine.dispatch({ type: "reset", mood: "idle" });
  activeTool = undefined;
  record("story started");
  schedule(500, () => { engine.dispatch({ type: "run_start" }); record("run started"); });
  const tools = ["bash", "read", "edit", "multi_tool_use.parallel", "custom_operation"];
  tools.forEach((tool, index) => schedule(1300 + index * 3000, () => startTool(tool, 1900)));
  const outputStart = 1300 + tools.length * 3000;
  for (let pulse = 0; pulse < 9; pulse++) {
    schedule(outputStart + pulse * 260, () => {
      engine.dispatch({ type: "output", intensity: 0.65 + (pulse % 3) * 0.16 });
      record("streaming output");
    });
  }
  schedule(outputStart + 2800, () => {
    endTool();
    engine.dispatch({ type: "settled" });
    record("run settled");
  });
}

function speak() {
  clearSchedule();
  ensureRun();
  endTool();
  for (let pulse = 0; pulse < 12; pulse++) {
    schedule(pulse * 230, () => {
      engine.dispatch({ type: "output", intensity: 0.62 + (pulse % 4) * 0.11 });
      record("streaming output");
    });
  }
  schedule(3100, () => {
    engine.dispatch({ type: "settled" });
    record("response completed");
  });
}

async function speakWithSal() {
  clearSchedule();
  ensureRun();
  endTool();
  const button = document.querySelector<HTMLButtonElement>("[data-action=sal]")!;
  button.disabled = true;
  record("loading Sal voice");
  try {
    await salVoice.play(() => {
      engine.dispatch({ type: "settled" });
      record("Sal voice completed");
    });
    record("Sal voice playing · audio drives face");
  } catch (error) {
    engine.dispatch({ type: "message_end", stopReason: "error" });
    engine.dispatch({ type: "settled" });
    record(error instanceof Error ? error.message : "Sal voice failed");
  } finally {
    button.disabled = false;
  }
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  const scale = Math.min(devicePixelRatio, 2);
  canvas.width = Math.max(1, Math.round(rect.width * scale));
  canvas.height = Math.max(1, Math.round(rect.height * scale));
  context.setTransform(scale, 0, 0, scale, 0, 0);
}

function render(now: number) {
  const elapsed = Math.max(0, Math.min(100, now - lastAdvance));
  if (!reduceMotion || elapsed >= 250) {
    engine.advanceTime(elapsed);
    lastAdvance = now;
  }

  const salIntensity = salVoice.intensity();
  if (salIntensity > 0.025 && now - lastSalPulse >= 70) {
    engine.dispatch({
      type: "output",
      intensity: salIntensity,
      members: salVoice.memberIntensities(),
    });
    lastSalPulse = now;
  }

  const frame = engine.snapshot();
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const availableWidth = Math.max(1, width - 96);
  const availableHeight = Math.max(1, height - 150);
  const drawHeight = Math.min(availableHeight, availableWidth * 0.75);
  const drawWidth = drawHeight * 4 / 3;
  const paddingX = (width - drawWidth) / 2;
  const paddingY = (height - drawHeight) / 2;
  const [red, green, blue] = colors[frame.mood] ?? colors.idle;

  context.clearRect(0, 0, width, height);
  const glow = context.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height) * 0.48);
  glow.addColorStop(0, `rgba(${red},${green},${blue},0.10)`);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);

  context.globalCompositeOperation = "lighter";
  for (const particle of frame.particles) {
    const x = paddingX + particle.x * drawWidth;
    const y = paddingY + particle.y * drawHeight;
    const scout = !particle.core && particle.role > 0.94;
    const radius = particle.core ? 2.15 : scout ? 2.7 : 1.35 + particle.role * 0.75;
    const memberColor = salVoice.active ? salMemberColors[particle.member] : [red, green, blue];
    const [particleRed, particleGreen, particleBlue] = memberColor;
    const velocityX = particle.vx * drawWidth;
    const velocityY = particle.vy * drawHeight;
    const speed = Math.hypot(velocityX, velocityY);
    if (speed > 0.5) {
      context.beginPath();
      context.moveTo(x - velocityX * 0.85, y - velocityY * 0.85);
      context.lineTo(x, y);
      context.strokeStyle = `rgba(${particleRed},${particleGreen},${particleBlue},${Math.min(0.34, speed * 0.025)})`;
      context.lineWidth = Math.max(0.55, radius * 0.42);
      context.stroke();
    }
    context.beginPath();
    context.arc(x, y, radius * (particle.core ? 4.3 : 3.2), 0, Math.PI * 2);
    context.fillStyle = `rgba(${particleRed},${particleGreen},${particleBlue},${particle.core ? 0.075 : scout ? 0.06 : 0.035})`;
    context.fill();
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    const lift = particle.core ? 70 : 35;
    context.fillStyle = `rgba(${Math.min(255, particleRed + lift)},${Math.min(255, particleGreen + lift)},${Math.min(255, particleBlue + lift)},${particle.core ? 0.98 : scout ? 0.95 : 0.78})`;
    context.fill();
  }
  context.globalCompositeOperation = "source-over";

  stateText.textContent = frame.label;
  motifText.textContent = frame.motifVisible
    ? `${frame.motif}${frame.motifEcho ? " echo" : ""}`
    : frame.outputActive && frame.homeForm === "emergent-face" ? "emergent voice"
      : frame.homeForm === "emergent-face" ? "ambient cloud" : "cat form";
  requestAnimationFrame(render);
}

document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((button) => {
  button.addEventListener("click", () => {
    clearSchedule();
    startTool(button.dataset.tool!);
  });
});

document.querySelector<HTMLButtonElement>("[data-action=story]")!.addEventListener("click", playStory);
document.querySelector<HTMLButtonElement>("[data-action=speak]")!.addEventListener("click", speak);
document.querySelector<HTMLButtonElement>("[data-action=sal]")!.addEventListener("click", speakWithSal);
const formButton = document.querySelector<HTMLButtonElement>("[data-action=form]")!;
formButton.addEventListener("click", () => {
  clearSchedule();
  const form = engine.snapshot().homeForm === "emergent-face" ? "cat" : "emergent-face";
  engine.dispatch({ type: "form", form });
  formButton.textContent = form === "emergent-face" ? "Cat form" : "Emergent face";
  record(`form changed: ${form}`);
});
document.querySelector<HTMLButtonElement>("[data-action=wait]")!.addEventListener("click", () => {
  clearSchedule(); ensureRun(); endTool(); engine.dispatch({ type: "prompt_start" }); record("waiting for user");
  schedule(1800, () => { engine.dispatch({ type: "prompt_end" }); record("prompt answered"); });
});
document.querySelector<HTMLButtonElement>("[data-action=error]")!.addEventListener("click", () => {
  clearSchedule(); ensureRun(); endTool(true); engine.dispatch({ type: "message_end", stopReason: "error" });
  engine.dispatch({ type: "settled" }); record("error observed");
});
document.querySelector<HTMLButtonElement>("[data-action=collective]")!.addEventListener("click", () => {
  location.href = "./collective.html";
});
document.querySelector<HTMLButtonElement>("[data-action=reset]")!.addEventListener("click", () => {
  clearSchedule(); activeTool = undefined; engine.dispatch({ type: "reset", mood: "idle" }); record("reset");
});

addEventListener("resize", resize);
addEventListener("beforeunload", () => salVoice.stop());
resize();
requestAnimationFrame(render);
if (parameters.get("action") === "speak") speak();
else playStory();
