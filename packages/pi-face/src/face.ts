export type Mood = "idle" | "thinking" | "tool" | "happy" | "error" | "sleep" | "waiting" | "cancelled";

export type ActivityPhase =
  | "idle"
  | "model-selected"
  | "starting"
  | "running"
  | "continuing"
  | "streaming"
  | "tool"
  | "waiting"
  | "finalizing"
  | "settled"
  | "error"
  | "cancelled"
  | "manual";

export type PromptKind = "select" | "confirm" | "input" | "editor" | "custom";

type ToolActivity = {
  name: string;
  parentId?: string;
  progress?: number;
  updates: number;
};

type FaceAnimation = {
  frames: readonly (readonly string[])[];
  loop?: boolean;
};

/** Five-line poses. Repeated frames control the rhythm without claiming hidden emotions. */
export const FACE_ANIMATIONS: Record<Mood, FaceAnimation> = {
  idle: {
    frames: [
      ["  /\\_/\\  ", " ( o.o ) ", "  > ^ <  ", " /|   |\\ ", "(_|___|_)~"],
      ["  /\\_/\\  ", " ( o.o ) ", "  > ^ <  ", " /|   |\\ ", "~(_|___|_)"],
      ["  /\\_/|  ", " ( -.- ) ", "  > ^ <  ", " /|   |\\ ", " (_|___|_)"],
      ["  /\\_/\\  ", " ( o.o ) ", "  > ^ <  ", " /|   |\\ ", "(_|___|_)~"],
    ],
  },
  thinking: {
    frames: [
      ["  /\\_/\\   ", " ( o_O )  ?", "  > ^ <   .", " /|   |\\   ", "(_|___|_)  "],
      ["  /\\_/\\   ", " ( O_o )  ?", "  > ^ <  ..", " /|   |\\   ", "(_|___|_)  "],
      ["  /\\_/\\   ", " ( O_O )  ?", "  > ^ < ...", " /|   |\\   ", "(_|___|_)  "],
      ["  /\\_/\\   ", " ( o_O )  ?", "  > ^ <  ..", " /|   |\\   ", "(_|___|_)  "],
    ],
  },
  tool: {
    frames: [
      ["  /\\_/\\  ", " ( o_o ) ", "  /|_|\\  ", " /|===|\\ ", "(_|___|_)"],
      ["  /\\_/\\  ", " ( o_o ) ", "  \\|_|/  ", " /|===|\\ ", "(_|___|_)"],
    ],
  },
  happy: {
    frames: [
      ["  /\\_/\\  ", " ( ^.^ ) ", "  > w <  ", " /|~~~|\\ ", "(_|___|_)"],
      ["  /\\_/\\  ", " ( -.- ) ", "  > w <  ", " /|~p~|\\ ", "(_|___|_)"],
    ],
  },
  error: {
    frames: [
      [" /\\_/\\   ", "( >_< )  ", " > ! <   ", "/|   |\\  ", "(_|___|_)"],
      ["   /\\_/\\ ", "  ( >_< )", "   > ! < ", "  /|   |\\", " (_|___|_)"],
      ["  /\\_/\\  ", " ( x_x ) ", "  > ! <  ", " /|   |\\ ", "(_|___|_)"],
    ],
    loop: false,
  },
  sleep: {
    frames: [
      ["  /\\_/\\    ", " ( -.- )  z", "  > ^ <  z ", " /|   |\\   ", "(_|___|_)  "],
      ["  /\\_/\\   Z", " ( -.- ) z ", "  > ^ <    ", " /|  ~|\\   ", "(_|___|_)  "],
    ],
  },
  waiting: {
    frames: [
      ["  /\\_/\\   ", " ( O.O )  ", "  > ^ <  /", " /|   |_/ ", "(_|___|_) "],
      ["  /\\_/\\   ", " ( O.O )  ", "  > ^ <  |", " /|   | | ", "(_|___|_) "],
      ["  /\\_/\\   ", " ( O.O )  ", "  > ^ <  \\", " /|   |_\\ ", "(_|___|_) "],
    ],
  },
  cancelled: {
    frames: [
      ["  /\\_/\\  ", " ( O_O ) ", "  > ! <  ", " /|   |\\ ", "(_|___|_)"],
      ["  /\\_/\\  ", " ( -_- ) ", "  > - <  ", " /|   |\\ ", "(_|___|_)"],
    ],
    loop: false,
  },
};

/** First poses retained as a convenient mood-to-face lookup. */
export const FACES: Record<Mood, readonly string[]> = {
  idle: FACE_ANIMATIONS.idle.frames[0],
  thinking: FACE_ANIMATIONS.thinking.frames[0],
  tool: FACE_ANIMATIONS.tool.frames[0],
  happy: FACE_ANIMATIONS.happy.frames[0],
  error: FACE_ANIMATIONS.error.frames[0],
  sleep: FACE_ANIMATIONS.sleep.frames[0],
  waiting: FACE_ANIMATIONS.waiting.frames[0],
  cancelled: FACE_ANIMATIONS.cancelled.frames[0],
};

export const LABELS: Record<Mood, string> = {
  idle: "idle", thinking: "thinking", tool: "using tools", happy: "turn ended",
  error: "error observed", sleep: "sleeping", waiting: "waiting for you", cancelled: "interrupted",
};

export function isMood(value: string): value is Mood {
  return Object.hasOwn(FACES, value);
}

/** Facts supplied by the host, never guesses about task success or model emotions. */
export class FaceState {
  active = false;
  private tools = new Map<string, ToolActivity>();
  private prompts: PromptKind[] = [];
  private error = false;
  private aborted = false;
  private manual: Mood | undefined;
  private preparing = false;
  private betweenRuns = false;
  private finalizing = false;
  private streaming = false;
  private runs = 0;
  private selectedModel: string | undefined;
  private modelNotice = false;

  private resetActivity() {
    this.active = true;
    this.tools.clear();
    this.prompts = [];
    this.error = false;
    this.aborted = false;
    this.manual = undefined;
    this.preparing = false;
    this.betweenRuns = false;
    this.finalizing = false;
    this.streaming = false;
    this.runs = 0;
    this.modelNotice = false;
  }

  prepare() {
    this.resetActivity();
    this.preparing = true;
  }

  start() {
    if (!this.active) this.resetActivity();
    this.manual = undefined;
    this.preparing = false;
    this.betweenRuns = false;
    this.finalizing = false;
    this.streaming = false;
    this.modelNotice = false;
    this.runs++;
  }

  runEnd() {
    if (!this.active) return;
    this.betweenRuns = true;
    this.streaming = false;
  }

  beforeSettle() {
    if (!this.active) return;
    this.finalizing = true;
    this.betweenRuns = false;
    this.streaming = false;
  }

  observeOutput() {
    if (!this.active) return;
    this.streaming = true;
    this.preparing = false;
    this.betweenRuns = false;
    this.finalizing = false;
    this.manual = undefined;
  }

  toolStart(id: string, name = "tool", parentId?: string) {
    this.manual = undefined;
    this.streaming = false;
    this.betweenRuns = false;
    this.tools.set(id, { name, parentId, updates: 0 });
  }

  toolUpdate(id: string, progress?: number) {
    const tool = this.tools.get(id);
    if (!tool) return;
    tool.updates++;
    if (progress !== undefined && Number.isFinite(progress)) {
      tool.progress = Math.max(0, Math.min(1, progress));
    }
  }

  toolEnd(id: string, isError: boolean) {
    this.tools.delete(id);
    this.error ||= isError;
    this.manual = undefined;
  }

  messageEnd(stopReason: string) {
    this.streaming = false;
    this.error ||= stopReason === "error";
    this.aborted ||= stopReason === "aborted";
  }

  promptStart(kind: PromptKind = "custom") {
    this.prompts.push(kind);
    this.streaming = false;
    this.manual = undefined;
  }

  promptEnd() { this.prompts.pop(); }

  end(aborted = false) {
    this.aborted ||= aborted;
    this.active = false;
    this.tools.clear();
    this.prompts = [];
    this.preparing = false;
    this.betweenRuns = false;
    this.finalizing = false;
    this.streaming = false;
  }

  modelSelected(name: string) {
    this.selectedModel = name;
    this.modelNotice = !this.active;
  }

  setManual(mood: Mood) {
    this.manual = mood;
    this.modelNotice = false;
  }

  idle() { if (this.mood === "happy") this.manual = "idle"; }

  get currentToolName(): string | undefined {
    return [...this.tools.values()].at(-1)?.name;
  }

  get currentToolProgress(): number | undefined {
    return [...this.tools.values()].at(-1)?.progress;
  }

  get activeToolCount() { return this.tools.size; }
  get nestedToolCount() { return [...this.tools.values()].filter((tool) => tool.parentId !== undefined).length; }
  get runCount() { return this.runs; }
  get modelName() { return this.selectedModel; }

  get mood(): Mood {
    if (this.prompts.length > 0) return "waiting";
    if (this.manual) return this.manual;
    if (this.tools.size > 0) return "tool";
    if (this.aborted) return "cancelled";
    if (this.active) return this.error ? "error" : "thinking";
    if (this.error) return "error";
    return "happy";
  }

  get phase(): ActivityPhase {
    if (this.prompts.length > 0) return "waiting";
    if (this.modelNotice && !this.active && this.manual === "idle") return "model-selected";
    if (this.manual) return this.manual === "idle" ? "idle" : "manual";
    if (this.tools.size > 0) return "tool";
    if (this.aborted) return "cancelled";
    if (this.error) return "error";
    if (this.active && this.finalizing) return "finalizing";
    if (this.active && this.streaming) return "streaming";
    if (this.active && this.preparing) return "starting";
    if (this.active && (this.betweenRuns || this.runs > 1)) return "continuing";
    if (this.active) return "running";
    if (this.modelNotice) return "model-selected";
    return this.mood === "happy" ? "settled" : "idle";
  }

  get label(): string {
    if (this.prompts.length > 0) {
      const kind = this.prompts.at(-1);
      if (kind === "confirm") return "waiting for approval";
      if (kind === "select") return "waiting for selection";
      if (kind === "input" || kind === "editor") return "waiting for input";
      return "waiting for you";
    }
    if (this.modelNotice && !this.active && this.manual === "idle") return "model selected";
    if (this.manual) return LABELS[this.manual];
    if (this.tools.size > 0) {
      const count = this.tools.size;
      const nested = this.nestedToolCount;
      const base = count > 1 ? `using ${count} tools` : nested > 0 ? "using nested tool" : "using tools";
      const progress = this.currentToolProgress;
      return progress === undefined ? base : `${base} · ${Math.round(progress * 100)}%`;
    }
    if (this.aborted) return "interrupted";
    if (this.error) return "error observed";
    if (this.active && this.finalizing) return "finalizing";
    if (this.active && this.streaming) return "streaming output";
    if (this.active && this.preparing) return "starting run";
    if (this.active && this.betweenRuns) return "checking next step";
    if (this.active && this.runs > 1) return "continuing run";
    if (this.active) return "thinking";
    if (this.modelNotice) return "model selected";
    return LABELS[this.mood];
  }
}

export function faceLines(mood: Mood, tick = 0, label = LABELS[mood]): string[] {
  const step = Math.max(0, Math.floor(tick));
  const animation = FACE_ANIMATIONS[mood];
  const frameIndex = animation.loop === false
    ? Math.min(step, animation.frames.length - 1)
    : step % animation.frames.length;
  const face = animation.frames[frameIndex];
  const pulse = [".", "o", "O", "o"][step % 4];
  const title = `pi face ${pulse} ${label}`;
  const innerWidth = Math.max(title.length, 11, ...face.map((line) => line.length));
  const border = `+${"-".repeat(innerWidth + 2)}+`;
  const row = (text: string) => `| ${text.padEnd(innerWidth)} |`;
  return [border, row(title), ...face.map(row), border];
}
