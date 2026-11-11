import { FaceState, type ActivityPhase, type Mood, type PromptKind } from "./face.ts";
import {
  BrailleSwarm,
  type NormalizedParticle,
  type SwarmHomeForm,
  type SwarmSnapshot,
  type ToolMotif,
} from "./swarm.ts";
import { ToolAlgebraTrace, type ToolExpression, type ToolVisualPlan } from "./tool-algebra.ts";

export type AgentFaceEvent =
  | { type: "reset"; mood?: Mood }
  | { type: "run_prepare" }
  | { type: "run_start" }
  | { type: "run_end" }
  | { type: "finalizing" }
  | { type: "tool_start"; id: string; name: string; parentId?: string }
  | { type: "tool_update"; id: string; progress?: number }
  | { type: "tool_end"; id: string; isError: boolean }
  | { type: "message_end"; stopReason: string }
  | { type: "prompt_start"; kind?: PromptKind }
  | { type: "prompt_end" }
  | { type: "settled"; aborted?: boolean }
  | { type: "model_selected"; name: string }
  | { type: "manual"; mood: Mood }
  | { type: "output"; intensity?: number; members?: readonly number[] }
  | { type: "form"; form: SwarmHomeForm }
  | { type: "idle" };

export interface AgentFaceFrame {
  mood: Mood;
  phase: ActivityPhase;
  label: string;
  tick: number;
  runCount: number;
  activeToolName?: string;
  activeToolCount: number;
  nestedToolCount: number;
  toolProgress?: number;
  modelName?: string;
  toolExpression: ToolExpression;
  toolExpressionKey: string;
  toolExpressionText: string;
  toolSummary: string;
  toolVisualPlan: ToolVisualPlan;
  activeMotifs: readonly ToolMotif[];
  motifs: readonly ToolMotif[];
  toolOperator: ToolVisualPlan["operator"];
  motif: ToolMotif;
  motifVisible: boolean;
  motifEcho: boolean;
  homeForm: SwarmHomeForm;
  outputActive: boolean;
  particles: readonly NormalizedParticle[];
}

/**
 * Frontend-neutral agent presence engine.
 *
 * Adapters feed it observable lifecycle events, call advance() on their own
 * animation clock, then render normalized particles however they want.
 */
export class AgentFaceEngine {
  private state = new FaceState();
  private swarm: BrailleSwarm;
  private toolAlgebra = new ToolAlgebraTrace();
  private animationTick = 0;

  constructor(seed?: number, initialMood: Mood = "idle", homeForm: SwarmHomeForm = "cat") {
    this.state.setManual(initialMood);
    this.swarm = new BrailleSwarm(seed, initialMood, homeForm);
  }

  get mood(): Mood {
    return this.state.mood;
  }

  get tick(): number {
    return this.animationTick;
  }

  dispatch(event: AgentFaceEvent): AgentFaceFrame {
    const previousMood = this.state.mood;

    if (event.type === "reset") {
      this.state = new FaceState();
      this.state.setManual(event.mood ?? "idle");
      this.toolAlgebra.reset();
      this.swarm.clearToolExpression();
      this.animationTick = 0;
      this.swarm.reset(this.state.mood);
      return this.snapshot();
    }
    if (event.type === "run_prepare") {
      this.toolAlgebra.reset();
      this.swarm.clearToolExpression();
      this.state.prepare();
    } else if (event.type === "run_start") {
      if (!this.state.active) {
        this.toolAlgebra.reset();
        this.swarm.clearToolExpression();
      }
      this.state.start();
    }
    else if (event.type === "run_end") this.state.runEnd();
    else if (event.type === "finalizing") this.state.beforeSettle();
    else if (event.type === "tool_start") {
      this.toolAlgebra.start(event.id, event.name, event.parentId);
      this.state.toolStart(event.id, event.name, event.parentId);
      this.swarm.setToolExpression(this.toolAlgebra.expression());
    } else if (event.type === "tool_update") {
      this.toolAlgebra.update(event.id, event.progress);
      this.state.toolUpdate(event.id, event.progress);
      this.swarm.setToolExpression(this.toolAlgebra.expression());
      this.swarm.pulseOutput(0.24);
    } else if (event.type === "tool_end") {
      this.toolAlgebra.end(event.id, event.isError);
      this.state.toolEnd(event.id, event.isError);
      this.swarm.setToolExpression(this.toolAlgebra.expression());
      this.swarm.finishTool(event.isError);
      if (this.state.activeToolCount > 0) this.swarm.setToolExpression(this.toolAlgebra.expression());
    } else if (event.type === "message_end") this.state.messageEnd(event.stopReason);
    else if (event.type === "output") {
      this.state.observeOutput();
      this.swarm.pulseOutput(event.intensity, event.members);
    } else if (event.type === "form") this.swarm.setHomeForm(event.form);
    else if (event.type === "prompt_start") this.state.promptStart(event.kind);
    else if (event.type === "prompt_end") this.state.promptEnd();
    else if (event.type === "settled") {
      this.toolAlgebra.settle(event.aborted);
      this.swarm.setToolExpression(this.toolAlgebra.expression());
      this.state.end(event.aborted);
    }
    else if (event.type === "model_selected") this.state.modelSelected(event.name);
    else if (event.type === "manual") this.state.setManual(event.mood);
    else if (event.type === "idle") this.state.idle();

    if (this.state.mood !== previousMood) {
      this.animationTick = 0;
      this.swarm.setMood(this.state.mood);
    }
    return this.snapshot();
  }

  advance(steps = 1): AgentFaceFrame {
    for (let step = 0; step < Math.max(0, Math.floor(steps)); step++) {
      this.animationTick++;
      this.swarm.step(this.state.mood, this.animationTick);
    }
    return this.snapshot();
  }

  /** Advance with a fixed-step 60 Hz physics clock while preserving legacy 125 ms animation time. */
  advanceTime(milliseconds: number): AgentFaceFrame {
    const boundedMilliseconds = Math.max(0, Math.min(250, milliseconds));
    if (boundedMilliseconds === 0) return this.snapshot();
    const totalScale = boundedMilliseconds / 125;
    const substeps = Math.max(1, Math.ceil(boundedMilliseconds / (1000 / 60)));
    const stepScale = totalScale / substeps;
    for (let step = 0; step < substeps; step++) {
      this.animationTick += stepScale;
      this.swarm.step(this.state.mood, this.animationTick, stepScale);
    }
    return this.snapshot();
  }

  restartAnimation(resetParticles = false): AgentFaceFrame {
    this.animationTick = 0;
    if (resetParticles) this.swarm.reset(this.state.mood);
    return this.snapshot();
  }

  snapshot(): AgentFaceFrame {
    const swarm: SwarmSnapshot = this.swarm.snapshot();
    const algebra = this.toolAlgebra.snapshot();
    const motifVisible = this.state.mood === "tool" || swarm.echoActive;
    return {
      mood: this.state.mood,
      phase: this.state.phase,
      label: this.state.label,
      tick: this.animationTick,
      runCount: this.state.runCount,
      activeToolName: this.state.currentToolName,
      activeToolCount: this.state.activeToolCount,
      nestedToolCount: this.state.nestedToolCount,
      toolProgress: this.state.currentToolProgress,
      modelName: this.state.modelName,
      toolExpression: algebra.expression,
      toolExpressionKey: algebra.key,
      toolExpressionText: algebra.text,
      toolSummary: algebra.motifText,
      toolVisualPlan: algebra.visualPlan,
      activeMotifs: algebra.activeMotifs,
      motifs: swarm.motifs,
      toolOperator: swarm.toolOperator,
      motif: swarm.motif,
      motifVisible,
      motifEcho: swarm.echoActive,
      homeForm: swarm.homeForm,
      outputActive: swarm.outputActive,
      particles: swarm.particles,
    };
  }
}
