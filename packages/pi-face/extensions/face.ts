import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { ambientPresenceLines, type AmbientGlyphStyle } from "../src/ambient.ts";
import { brailleFaceLines } from "../src/braille.ts";
import { faceLines, isMood } from "../src/face.ts";
import { AgentFaceEngine, type AgentFaceEvent } from "../src/presence.ts";
import { swarmSnapshotFaceLines } from "../src/swarm.ts";

type FaceStyle = "ascii" | "braille" | "ambient";
type FaceMotion = "pose" | "swarm" | "still";
type FacePreferences = {
  enabled: boolean;
  style: FaceStyle;
  ambientGlyphs: AmbientGlyphStyle;
  motion: FaceMotion;
};

const PREFERENCES_ENTRY = "pi-face-preferences";
const DEFAULT_PREFERENCES: FacePreferences = {
  enabled: true,
  style: "ascii",
  ambientGlyphs: "braille",
  motion: "pose",
};

const FACE_ARGUMENTS = [
  "status", "help", "on", "off", "compact", "character", "showcase",
  "ascii", "braille", "ambient", "ambient braille", "ambient ascii", "ambient unicode",
  "style ascii", "style braille", "style ambient",
  "motion pose", "motion swarm", "motion still",
  "preview idle", "preview thinking", "preview tool", "preview happy", "preview error",
  "preview sleep", "preview waiting", "preview cancelled",
] as const;

const HELP = [
  "Face presets:",
  "  /face compact    quiet two-line activity rail",
  "  /face character  animated Braille portrait",
  "  /face showcase   living Braille particle swarm",
  "Controls: /face on|off|status, style ascii|braille|ambient, motion pose|swarm|still",
  "Preview: /face preview idle|thinking|tool|happy|error|sleep|waiting|cancelled",
  "Narrow terminals automatically use the compact rail. Preferences survive reload/resume.",
].join("\n");

function restoredPreferences(entries: readonly unknown[]): FacePreferences {
  const preferences = { ...DEFAULT_PREFERENCES };
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index] as { type?: unknown; customType?: unknown; data?: unknown };
    if (entry?.type !== "custom" || entry.customType !== PREFERENCES_ENTRY || !entry.data || typeof entry.data !== "object") continue;
    const data = entry.data as Partial<FacePreferences>;
    if (typeof data.enabled === "boolean") preferences.enabled = data.enabled;
    if (data.style === "ascii" || data.style === "braille" || data.style === "ambient") preferences.style = data.style;
    if (data.ambientGlyphs === "ascii" || data.ambientGlyphs === "unicode" || data.ambientGlyphs === "braille") {
      preferences.ambientGlyphs = data.ambientGlyphs;
    }
    if (data.motion === "pose" || data.motion === "swarm" || data.motion === "still") preferences.motion = data.motion;
    break;
  }
  return preferences;
}

function numericProgress(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value >= 0 && value <= 1) return value;
  if (value >= 0 && value <= 100) return value / 100;
  return undefined;
}

function progressFromPartialResult(value: unknown, depth = 0): number | undefined {
  if (depth >= 3 || !value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["progress", "percent", "percentage", "completion"] as const) {
    const progress = numericProgress(record[key]);
    if (progress !== undefined) return progress;
  }
  const completed = typeof record.completed === "number" ? record.completed : undefined;
  const total = typeof record.total === "number" ? record.total : undefined;
  if (completed !== undefined && total !== undefined && total > 0) {
    return Math.max(0, Math.min(1, completed / total));
  }
  return progressFromPartialResult(record.details, depth + 1);
}

export default function faceExtension(pi: ExtensionAPI) {
  let engine = new AgentFaceEngine(undefined, "idle");
  let enabled = DEFAULT_PREFERENCES.enabled;
  let style: FaceStyle = DEFAULT_PREFERENCES.style;
  let ambientGlyphs: AmbientGlyphStyle = DEFAULT_PREFERENCES.ambientGlyphs;
  let motion: FaceMotion = DEFAULT_PREFERENCES.motion;
  let animation: ReturnType<typeof setInterval> | undefined;
  let animationDelay: number | undefined;
  let settle: ReturnType<typeof setTimeout> | undefined;
  let context: ExtensionContext | undefined;
  let lastOutputRenderAt: number | undefined;

  function clearTimers() {
    if (animation) clearInterval(animation);
    if (settle) clearTimeout(settle);
    animation = undefined;
    animationDelay = undefined;
    settle = undefined;
  }

  function remove(ctx: ExtensionContext) {
    if (ctx.mode !== "tui") return;
    ctx.ui.setWidget("face", undefined);
    ctx.ui.setStatus("face", undefined);
  }

  function render(ctx: ExtensionContext) {
    if (ctx.mode !== "tui") return;
    if (!enabled) { remove(ctx); return; }
    // Use the host's current theme and available width on every render.
    ctx.ui.setWidget("face", (_tui, theme) => ({
      render(width) {
        const frame = engine.snapshot();
        const color = frame.mood === "error" ? "error" : frame.mood === "tool" || frame.mood === "waiting" ? "warning"
          : frame.mood === "thinking" ? "accent" : "muted";
        let lines = style === "ambient" ? ambientPresenceLines(frame, width, ambientGlyphs)
          : motion === "swarm" ? swarmSnapshotFaceLines({
            motif: frame.motif,
            motifs: frame.motifs,
            toolOperator: frame.toolOperator,
            toolSummary: frame.toolSummary,
            homeForm: frame.homeForm,
            echoActive: frame.motifEcho,
            outputActive: frame.outputActive,
            particles: frame.particles,
          }, frame.mood, frame.tick, frame.label)
            : style === "braille" ? brailleFaceLines(frame.mood, frame.tick, frame.label)
              : faceLines(frame.mood, frame.tick, frame.label);
        if (style !== "ambient" && lines.some((line) => visibleWidth(line) > width)) {
          lines = ambientPresenceLines(frame, width, style === "ascii" ? "ascii" : "braille");
        }
        return lines.map((line) => truncateToWidth(theme.fg(color, line), width));
      },
      invalidate() {},
    }));
    ctx.ui.setStatus("face", `face: ${engine.snapshot().label}`);
  }

  function refresh(ctx: ExtensionContext) {
    if (ctx.mode !== "tui") return;
    context = ctx;
    render(ctx);
    const desiredDelay = !enabled || motion === "still" ? undefined
      : style === "ambient" ? 180
        : motion === "swarm" ? 125 : 500;
    if (animation && animationDelay !== desiredDelay) {
      clearInterval(animation);
      animation = undefined;
      animationDelay = undefined;
    }
    if (desiredDelay !== undefined && !animation) {
      animationDelay = desiredDelay;
      animation = setInterval(() => {
        if (!context) return;
        engine.advance();
        render(context);
      }, desiredDelay);
      animation.unref();
    }
  }

  function update(ctx: ExtensionContext, event: AgentFaceEvent) {
    if (ctx.mode !== "tui") return;
    if (settle) clearTimeout(settle);
    settle = undefined;
    engine.dispatch(event);
    refresh(ctx);
  }

  function savePreferences() {
    pi.appendEntry(PREFERENCES_ENTRY, { enabled, style, ambientGlyphs, motion });
  }

  function applyPreset(name: "compact" | "character" | "showcase", ctx: ExtensionContext) {
    enabled = true;
    if (name === "compact") {
      style = "ambient";
      ambientGlyphs = "braille";
      motion = "pose";
    } else if (name === "character") {
      style = "braille";
      motion = "pose";
    } else {
      style = "braille";
      motion = "swarm";
    }
    engine.restartAnimation(name === "showcase");
    savePreferences();
    refresh(ctx);
    ctx.ui.notify(`Face preset “${name}” enabled.`, "info");
  }

  function observeOutput(ctx: ExtensionContext, intensity: number) {
    if (ctx.mode !== "tui") return;
    if (settle) clearTimeout(settle);
    settle = undefined;
    context = ctx;
    engine.dispatch({ type: "output", intensity });
    const now = Date.now();
    if (lastOutputRenderAt === undefined || now - lastOutputRenderAt >= 80) {
      lastOutputRenderAt = now;
      refresh(ctx);
    }
  }

  pi.on("session_start", (_event, ctx) => {
    clearTimers();
    engine = new AgentFaceEngine(undefined, "idle");
    const preferences = restoredPreferences(ctx.sessionManager.getEntries());
    enabled = preferences.enabled;
    style = preferences.style;
    ambientGlyphs = preferences.ambientGlyphs;
    motion = preferences.motion;
    context = undefined;
    lastOutputRenderAt = undefined;
    refresh(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    clearTimers();
    context = undefined;
    lastOutputRenderAt = undefined;
    remove(ctx);
  });

  pi.on("before_agent_start", (_event, ctx) => {
    lastOutputRenderAt = undefined;
    update(ctx, { type: "run_prepare" });
  });
  pi.on("agent_start", (_event, ctx) => update(ctx, { type: "run_start" }));
  pi.on("agent_end", (_event, ctx) => update(ctx, { type: "run_end" }));
  pi.on("tool_execution_start", (event, ctx) => update(ctx, {
    type: "tool_start",
    id: event.toolCallId,
    name: event.toolName,
    parentId: event.parentToolCallId,
  }));
  pi.on("tool_execution_update", (event, ctx) => update(ctx, {
    type: "tool_update",
    id: event.toolCallId,
    progress: progressFromPartialResult(event.partialResult),
  }));
  pi.on("tool_execution_end", (event, ctx) => update(ctx, {
    type: "tool_end", id: event.toolCallId, isError: event.isError,
  }));
  pi.on("message_update", (event, ctx) => {
    if (event.assistantMessageEvent.type !== "text_delta") return;
    const length = event.assistantMessageEvent.delta.length;
    if (length > 0) observeOutput(ctx, Math.max(0.18, Math.min(1, length / 28)));
  });
  pi.on("message_end", (event, ctx) => {
    if (event.message.role === "assistant") {
      update(ctx, { type: "message_end", stopReason: event.message.stopReason });
    }
  });
  pi.on("ui_prompt_start", (event, ctx) => update(ctx, { type: "prompt_start", kind: event.kind }));
  pi.on("ui_prompt_end", (_event, ctx) => update(ctx, { type: "prompt_end" }));
  pi.on("agent_before_settle", (_event, ctx) => update(ctx, { type: "finalizing" }));
  pi.on("model_select", (event, ctx) => update(ctx, {
    type: "model_selected",
    name: `${event.model.provider}/${event.model.id}`,
  }));

  // Settled is later than agent_end: automatic retries/queued work have finished.
  pi.on("agent_settled", (event, ctx) => {
    const aborted = (event as { aborted?: boolean }).aborted === true;
    update(ctx, { type: "settled", aborted });
    if (ctx.mode !== "tui" || !enabled || engine.mood !== "happy") return;
    settle = setTimeout(() => {
      settle = undefined;
      engine.dispatch({ type: "idle" });
      engine.restartAnimation();
      if (context) refresh(context);
    }, 2500);
    settle.unref();
  });

  pi.registerCommand("face", {
    description: "Control the visual presence: compact, character, showcase, or preview.",
    getArgumentCompletions: (prefix) => {
      const matches = FACE_ARGUMENTS.filter((value) => value.startsWith(prefix.toLowerCase()));
      return matches.length > 0 ? matches.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") {
        if (ctx.hasUI) ctx.ui.notify("Pi face renders only in interactive terminal mode.", "info");
        return;
      }
      const value = args.trim().toLowerCase();
      const previewMood = value.startsWith("preview ") ? value.slice("preview ".length) : undefined;
      if (!value || value === "status") {
        const frame = engine.snapshot();
        ctx.ui.notify(
          `Face is ${enabled ? "on" : "off"}; mood=${frame.mood}; phase=${frame.phase}; tools=${frame.activeToolCount}; style=${style}${style === "ambient" ? `; glyphs=${ambientGlyphs}` : ""}; motion=${motion}`,
          "info",
        );
      } else if (value === "help") {
        ctx.ui.notify(HELP, "info");
      } else if (value === "compact" || value === "character" || value === "showcase") {
        applyPreset(value, ctx);
      } else if (value === "off") {
        enabled = false;
        clearTimers();
        remove(ctx);
        context = undefined;
        savePreferences();
      } else if (value === "ambient ascii" || value === "ambient unicode" || value === "ambient braille") {
        enabled = true;
        style = "ambient";
        ambientGlyphs = value.endsWith("ascii") ? "ascii" : value.endsWith("unicode") ? "unicode" : "braille";
        if (motion === "swarm") motion = "pose";
        engine.restartAnimation();
        savePreferences();
        refresh(ctx);
      } else if (value === "ascii" || value === "braille" || value === "ambient") {
        enabled = true;
        style = value;
        if (value === "ambient") ambientGlyphs = "braille";
        if ((value === "ascii" || value === "ambient") && motion === "swarm") motion = "pose";
        engine.restartAnimation();
        savePreferences();
        refresh(ctx);
      } else if (value === "style") {
        ctx.ui.notify(`Face style is ${style}`, "info");
      } else if (value === "style ascii" || value === "style braille" || value === "style ambient") {
        enabled = true;
        style = value.slice("style ".length) as FaceStyle;
        if ((style === "ascii" || style === "ambient") && motion === "swarm") motion = "pose";
        engine.restartAnimation();
        savePreferences();
        refresh(ctx);
      } else if (value === "motion") {
        ctx.ui.notify(`Face motion is ${motion}`, "info");
      } else if (value === "motion swarm") {
        enabled = true;
        style = "braille";
        motion = "swarm";
        engine.restartAnimation(true);
        savePreferences();
        refresh(ctx);
      } else if (value === "motion pose" || value === "motion still") {
        enabled = true;
        motion = value.slice("motion ".length) as FaceMotion;
        engine.restartAnimation();
        savePreferences();
        refresh(ctx);
      } else if (value === "on") {
        enabled = true;
        savePreferences();
        refresh(ctx);
      } else if (previewMood && isMood(previewMood)) {
        enabled = true;
        update(ctx, { type: "manual", mood: previewMood });
        ctx.ui.notify("Cosmetic preview enabled; real activity restores automatic state.", "info");
      } else if (isMood(value)) {
        enabled = true;
        update(ctx, { type: "manual", mood: value });
      } else {
        ctx.ui.notify("Unknown face option. Run /face help for presets and controls.", "warning");
      }
    },
  });
}
