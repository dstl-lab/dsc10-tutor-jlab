import asyncio
import concurrent.futures
import shlex
from pathlib import Path

_ALLOWED_COMMANDS = {"grep", "find", "cat", "ls", "head", "tail", "wc"}

_SHELL_CHAIN_PATTERNS = ("|", "&&", "||", ";", "`", "$(")

_TIMEOUT_SECONDS = 8
_MAX_OUTPUT_BYTES = 40_000

_EXECUTOR = concurrent.futures.ThreadPoolExecutor(
    max_workers=4, thread_name_prefix="bash_tool"
)


def bash_exec(command: str, lectures_dir: str = "") -> str:
    """Run a single read-only shell command and return stdout.

    The command must start with one of: grep, find, cat, ls, head, tail, wc.
    Shell chaining operators (|, &&, ||, ;, backticks, $(...)) are blocked.
    Redirect operators (> and >>) are blocked after token parsing.
    The working directory is set to lectures_dir when provided.

    Args:
        command: The shell command string to execute.
        lectures_dir: Absolute path to the lectures directory (used as cwd).

    Returns:
        stdout of the command, truncated to 40 KB, or an error message string.
    """
    command = command.strip()
    if not command:
        return "[bash_exec] Empty command."

    for forbidden in _SHELL_CHAIN_PATTERNS:
        if forbidden in command:
            return (
                f"[bash_exec] Blocked: '{forbidden}' is not allowed. "
                "Use only simple read-only commands without pipes or chaining."
            )

    try:
        tokens = shlex.split(command)
    except ValueError as exc:
        return f"[bash_exec] Could not parse command: {exc}"

    if not tokens:
        return "[bash_exec] Empty command after parsing."

    for tok in tokens:
        if tok in (">", ">>", "<"):
            return f"[bash_exec] Blocked: redirect operator '{tok}' is not allowed."

    cmd_name = Path(tokens[0]).name
    if cmd_name not in _ALLOWED_COMMANDS:
        return (
            f"[bash_exec] Command '{cmd_name}' is not allowed. "
            f"Allowed commands: {', '.join(sorted(_ALLOWED_COMMANDS))}."
        )

    cwd = lectures_dir if lectures_dir and Path(lectures_dir).is_dir() else None

    future = _EXECUTOR.submit(_run_sync, tokens, cwd)
    try:
        return future.result(timeout=_TIMEOUT_SECONDS + 2)
    except concurrent.futures.TimeoutError:
        return f"[bash_exec] Command timed out after {_TIMEOUT_SECONDS}s."
    except Exception as exc:
        return f"[bash_exec] Execution error: {exc}"


def _run_sync(tokens: list[str], cwd: str | None) -> str:
    """Synchronous wrapper that runs the subprocess in its own event loop."""
    return asyncio.run(_run(tokens, cwd))


async def _run(tokens: list[str], cwd: str | None) -> str:
    try:
        proc = await asyncio.create_subprocess_exec(
            *tokens,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=cwd,
        )
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(), timeout=_TIMEOUT_SECONDS
        )
    except asyncio.TimeoutError:
        return f"[bash_exec] Command timed out after {_TIMEOUT_SECONDS}s."
    except FileNotFoundError:
        return f"[bash_exec] Command not found: {tokens[0]}"
    except Exception as exc:
        return f"[bash_exec] Execution error: {exc}"

    output = stdout.decode("utf-8", errors="replace")
    if len(output) > _MAX_OUTPUT_BYTES:
        output = output[:_MAX_OUTPUT_BYTES] + "\n[... output truncated ...]"

    if not output.strip() and stderr:
        err = stderr.decode("utf-8", errors="replace")[:2000]
        return f"[bash_exec] (no stdout) stderr: {err}"

    return output or "[bash_exec] (empty output)"
