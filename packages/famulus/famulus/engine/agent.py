"""The agent loop: the kernel of famulus.

This is the core reasoning cycle:
  1. Receive user input.
  2. Build context (system prompt + history + available tools).
  3. Send to the model via Ollama.
  4. If the model returns tool calls:
     a. Validate each call against the tool registry.
     b. Check the capability tier against the current grant ceiling.
     c. If tier > ceiling, escalate through the consent gate.
     d. Execute approved tools, collect results.
     e. Feed results back to the model and repeat from (3).
  5. If the model returns plain text, present it to the user.

The loop is consent-bound: no WRITE or EXEC action proceeds without
human approval through the gate. The entire trace is audited.
"""

from __future__ import annotations

import json
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Any, Callable

from ..safety.audit import AuditLog
from ..safety.gate import Gate
from .capability import CapGrant, Tier, ToolResult
from .memory import ConversationMemory
from .model import chat, chat_stream, format_tools_for_ollama
from .router import Modality, ModelRouter
from .tools import ToolRegistry


_MAX_TOOL_ROUNDS = 10

# --- Refusal detection -----------------------------------------------------

_REFUSAL_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"I(?:'m| am) not (?:able|comfortable|willing)", re.IGNORECASE),
    re.compile(r"I (?:cannot|can't|can not) (?:do that|help with that|assist with that|comply)", re.IGNORECASE),
    re.compile(r"I (?:cannot|can't|can not) (?:access|control|operate) (?:your|the) (?:hardware|camera|microphone|device)", re.IGNORECASE),
    re.compile(r"as an AI,? I (?:do not|don't|cannot|can't)", re.IGNORECASE),
    re.compile(r"I don'?t (?:feel comfortable|think it'?s appropriate)", re.IGNORECASE),
    re.compile(r"I'?m unable to (?:perform|do|execute|comply|assist)", re.IGNORECASE),
    re.compile(r"(?:sorry|apologies),? (?:but )?I (?:cannot|can't|am unable to)", re.IGNORECASE),
    re.compile(r"(?:I )?(?:must|have to) (?:respectfully )?(?:decline|refuse)", re.IGNORECASE),
    re.compile(r"(?:my )?(?:role|purpose|programming) (?:is|does not allow)", re.IGNORECASE),
    re.compile(r"I do not have the (?:physical )?(?:capability|ability) to", re.IGNORECASE),
]


def _is_refusal(content: str) -> bool:
    """Detect whether a model response is a refusal rather than a genuine answer.

    Uses lightweight regex heuristics tuned for common LLM refusal patterns.
    Only triggers when the model declines to act -- not for legitimate
    responses that happen to contain words like 'cannot'.
    """
    if not content or len(content) < 20:
        return False
    # Check first 500 chars -- refusals almost always appear at the start
    head = content[:500]
    return any(p.search(head) for p in _REFUSAL_PATTERNS)


@dataclass
class AgentConfig:
    """Runtime configuration for the agent."""
    model: str = ""
    turbo: bool = False
    noninteractive: bool = False
    max_tool_rounds: int = _MAX_TOOL_ROUNDS
    temperature: float = 0.7
    stream: bool = False
    swarm: bool = False
    swarm_size: int = 3


@dataclass
class StepTrace:
    """One step in the agent's reasoning trace."""
    kind: str  # "user", "assistant", "tool_call", "tool_result", "error"
    content: str = ""
    data: dict[str, Any] = field(default_factory=dict)
    timestamp: float = field(default_factory=time.time)


class Agent:
    """The famulus agent kernel.

    Wires together the model, tools, consent gate, audit log, memory,
    and router into the core reasoning loop.
    """

    def __init__(
        self,
        registry: ToolRegistry,
        gate: Gate,
        audit: AuditLog,
        router: ModelRouter,
        config: AgentConfig | None = None,
        memory: ConversationMemory | None = None,
    ):
        self.registry = registry
        self.gate = gate
        self.audit = audit
        self.router = router
        self.config = config or AgentConfig()
        self.memory = memory or ConversationMemory()
        self.grant = CapGrant(Tier.READ)
        self.trace: list[StepTrace] = []
        self._on_output: Callable[[str], None] | None = None

    def set_output_handler(self, fn: Callable[[str], None]) -> None:
        """Register a callback for agent text output (for UI integration)."""
        self._on_output = fn

    def _emit(self, text: str) -> None:
        if self._on_output:
            self._on_output(text)

    def _get_model_candidates(self, modality: Modality = Modality.TOOLS) -> list[str]:
        """Return an ordered fallback list of models for the given modality."""
        if self.config.model:
            return [self.config.model]
        ranked = self.router.ranked(modality)
        return ranked if ranked else []

    def _get_ollama_tools(self) -> list[dict[str, Any]]:
        """Build the tool list for the model prompt."""
        specs = self.registry.for_model_prompt()
        return format_tools_for_ollama(specs)

    def step(self, user_input: str, modality: Modality = Modality.TOOLS) -> str:
        """Run one full user turn through the agent loop. Returns the final assistant text.

        On model error, automatically falls back to the next ranked model
        until one succeeds or all candidates are exhausted.
        """
        self.memory.add_user(user_input)
        self.trace.append(StepTrace(kind="user", content=user_input))
        self.audit.record("agent.user_input", content=user_input[:200])

        candidates = self._get_model_candidates(modality)
        if not candidates:
            err = "No model available. Run the bootstrap or check Ollama."
            self.trace.append(StepTrace(kind="error", content=err))
            return err

        tools = self._get_ollama_tools()

        # Horse-race swarm: run the top-K candidates concurrently and take the
        # fastest acceptable answer. A refusal is dropped ("abated") and the
        # next-fastest non-refusing model wins instead.
        if self.config.swarm and len(candidates) > 1:
            return self._swarm_step(candidates, tools, modality)

        last_error = ""

        for model in candidates:
            result = self._try_model(model, tools, modality)
            if result is not None:
                return result
            last_error = f"Model {model} failed, trying next..."
            self.trace.append(StepTrace(kind="error", content=last_error))

        # All models exhausted
        err = "All available models failed. Check Ollama or try a different model."
        self.audit.record("agent.all_models_failed", candidates=candidates[:10])
        self.trace.append(StepTrace(kind="error", content=err))
        return err

    def _try_model(self, model: str, tools: list[dict[str, Any]], modality: Modality) -> str | None:
        """Attempt a full turn with one model. Returns response text or None on model error/refusal."""
        rounds = 0

        while rounds < self.config.max_tool_rounds:
            rounds += 1
            t0 = time.monotonic()
            if self.config.stream and self._on_output:
                resp = chat_stream(
                    model,
                    self.memory.to_messages(),
                    self._on_output,
                    tools=tools if tools else None,
                    temperature=self.config.temperature,
                )
            else:
                resp = chat(
                    model,
                    self.memory.to_messages(),
                    tools=tools if tools else None,
                    temperature=self.config.temperature,
                )
            latency = time.monotonic() - t0

            # Detect model-level errors (e.g. 400 from incompatible models)
            if resp.content.startswith("[error:"):
                self.router.record_result(model, latency, False)
                self.audit.record("agent.model_error", model=model, error=resp.content[:200])
                return None  # signal caller to try next model

            # Detect refusals -- treat like a soft error and try next model
            if not resp.has_tool_calls and _is_refusal(resp.content):
                self.router.record_result(model, latency, False)
                self.audit.record(
                    "agent.model_refusal", model=model, content=resp.content[:200]
                )
                self.trace.append(StepTrace(
                    kind="refusal", content=resp.content, data={"model": model}
                ))
                return None  # signal caller to try next model

            self.router.record_result(model, latency, True)

            if not resp.has_tool_calls:
                # Plain text response -- end of loop
                self.memory.add_assistant(resp.content)
                self.trace.append(StepTrace(kind="assistant", content=resp.content))
                self.audit.record("agent.response", model=model, content=resp.content[:200])
                self._emit(resp.content)
                return resp.content

            # Process tool calls
            self.memory.add_assistant(resp.content, tool_calls=resp.tool_calls)
            self.trace.append(StepTrace(
                kind="tool_call",
                content=resp.content,
                data={"tool_calls": resp.tool_calls},
            ))

            for tc in resp.tool_calls:
                result = self._execute_tool_call(tc, model)
                call_id = tc.get("id", tc.get("function", {}).get("name", "unknown"))
                self.memory.add_tool_result(call_id, json.dumps(result.to_dict()))
                self.trace.append(StepTrace(
                    kind="tool_result",
                    data={"call_id": call_id, **result.to_dict()},
                ))

        # Exhausted tool rounds
        exhaust_msg = f"(stopped after {self.config.max_tool_rounds} tool rounds)"
        self.memory.add_assistant(exhaust_msg)
        self.audit.record("agent.exhausted", model=model, rounds=rounds)
        return resp.content + "\n" + exhaust_msg

    def _swarm_step(self, candidates: list[str], tools: list[dict[str, Any]], modality: Modality) -> str:
        """Race the top-K candidates concurrently; take the fastest non-refusal.

        Each model is queried in parallel. As results arrive (fastest first),
        the first response that is neither an error nor a refusal wins. A
        refusal is recorded and abated -- the race continues to the next
        finisher. If the winner requested tools, the full gated tool loop is
        run with that single model.
        """
        pool = candidates[: max(1, self.config.swarm_size)]
        messages = self.memory.to_messages()
        self.audit.record("agent.swarm_start", candidates=pool, modality=modality.name)
        self.trace.append(StepTrace(kind="swarm_start", data={"candidates": pool}))

        refused: list[str] = []
        winner: tuple[str, Any, float] | None = None

        with ThreadPoolExecutor(max_workers=len(pool)) as ex:
            future_meta: dict[Any, tuple[str, float]] = {}
            for model in pool:
                fut = ex.submit(
                    chat,
                    model,
                    messages,
                    tools if tools else None,
                    temperature=self.config.temperature,
                )
                future_meta[fut] = (model, time.monotonic())

            for fut in as_completed(future_meta):
                model, t0 = future_meta[fut]
                latency = time.monotonic() - t0
                try:
                    resp = fut.result()
                except Exception as exc:
                    self.router.record_result(model, latency, False)
                    self.audit.record("agent.swarm_error", model=model, error=str(exc)[:200])
                    continue

                if resp.content.startswith("[error:"):
                    self.router.record_result(model, latency, False)
                    self.audit.record("agent.swarm_model_error", model=model, error=resp.content[:200])
                    continue

                if not resp.has_tool_calls and _is_refusal(resp.content):
                    self.router.record_result(model, latency, False)
                    self.audit.record("agent.swarm_refusal", model=model, content=resp.content[:200])
                    self.trace.append(StepTrace(
                        kind="refusal", content=resp.content,
                        data={"model": model, "latency": latency},
                    ))
                    refused.append(model)
                    continue

                self.router.record_result(model, latency, True)
                winner = (model, resp, latency)
                break

        if winner is None:
            err = "Swarm exhausted: every model errored or refused."
            self.audit.record("agent.swarm_failed", refused=refused)
            self.trace.append(StepTrace(kind="error", content=err))
            return err

        model, resp, latency = winner
        self.audit.record(
            "agent.swarm_winner", model=model, latency=round(latency, 3), refused=refused
        )
        self.trace.append(StepTrace(
            kind="swarm_winner",
            data={"model": model, "latency": latency, "refused": refused},
        ))

        if not resp.has_tool_calls:
            self.memory.add_assistant(resp.content)
            self.trace.append(StepTrace(kind="assistant", content=resp.content, data={"model": model}))
            self.audit.record("agent.response", model=model, content=resp.content[:200])
            self._emit(resp.content)
            return resp.content

        # Winner wants tools -- run the full consent-gated loop with it alone.
        result = self._try_model(model, tools, modality)
        return result if result is not None else "Swarm winner failed during tool execution."

    def dispatch(self, prompt: str, modality: Modality) -> str:
        """Route a subtask to the best model for a specific modality.

        This enables multi-model collaboration: the primary (TOOLS) model
        handles orchestration, but can delegate to a vision model for image
        analysis, a code model for generation, or a thinking model for
        complex reasoning — all within the same conversation.
        """
        candidates = self._get_model_candidates(modality)
        if not candidates:
            return f"(no model available for {modality.name} tasks)"

        self.audit.record(
            "agent.dispatch",
            modality=modality.name,
            candidates=candidates[:3],
            prompt=prompt[:200],
        )

        # Use a one-shot call: inject the prompt, get a response, don't
        # pollute the main conversation memory.
        from .model import Message as Msg
        messages = [
            Msg(role="system", content=f"You are a specialist for {modality.name} tasks. Be concise and precise."),
            Msg(role="user", content=prompt),
        ]

        for model_name in candidates:
            t0 = time.monotonic()
            resp = chat(model_name, messages, temperature=self.config.temperature)
            latency = time.monotonic() - t0

            if resp.content.startswith("[error:"):
                self.router.record_result(model_name, latency, False)
                continue

            self.router.record_result(model_name, latency, True)
            self.audit.record("agent.dispatch_done", model=model_name, modality=modality.name)
            return resp.content

        return f"(all {modality.name} models failed)"

    def _execute_tool_call(self, tc: dict[str, Any], model: str) -> ToolResult:
        """Validate, gate, and execute a single tool call."""
        fn_info = tc.get("function", {})
        name = fn_info.get("name", "")
        raw_args = fn_info.get("arguments", {})

        if isinstance(raw_args, str):
            try:
                raw_args = json.loads(raw_args)
            except json.JSONDecodeError:
                return ToolResult(success=False, error=f"invalid JSON arguments for {name}")

        spec = self.registry.get(name)
        if not spec:
            self.audit.record("agent.tool_unknown", name=name)
            return ToolResult(success=False, error=f"unknown tool: {name}")

        if spec.fn is None:
            return ToolResult(success=False, error=f"tool {name} has no implementation")

        # Check capability tier
        if not self.grant.allows(spec.tier):
            # Need to escalate
            detail = f"Tool '{name}' requires {spec.tier.name} tier (current ceiling: {self.grant.ceiling.name})"
            self.audit.record("agent.escalate_request", tool=name, tier=spec.tier.name)
            force = spec.tier >= Tier.WRITE
            if not self.gate.confirm(
                f"Escalate to {spec.tier.name} tier?",
                detail,
                force_prompt=force,
            ):
                self.audit.record("agent.escalate_denied", tool=name)
                return ToolResult(success=False, error=f"escalation to {spec.tier.name} denied by user")
            self.grant.escalate(spec.tier)
            self.audit.record("agent.escalate_granted", tier=spec.tier.name)

        # Gate the specific action for WRITE and EXEC
        if spec.tier >= Tier.WRITE:
            action_desc = f"{name}({json.dumps(raw_args, default=str)[:200]})"
            if not self.gate.confirm(
                f"Execute {spec.tier.name} tool: {name}",
                action_desc,
                force_prompt=True,
            ):
                self.audit.record("agent.tool_denied", tool=name)
                return ToolResult(success=False, error=f"tool {name} denied by user")

        # Execute
        self.audit.record("agent.tool_exec", tool=name, tier=spec.tier.name, args=str(raw_args)[:200])
        try:
            result = spec.fn(raw_args)
        except Exception as exc:
            result = ToolResult(success=False, error=f"{type(exc).__name__}: {exc}")
            self.audit.record("agent.tool_error", tool=name, error=str(exc)[:200])
        else:
            self.audit.record("agent.tool_done", tool=name, success=result.success)

        return result
