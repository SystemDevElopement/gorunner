"""
GoRunner Python Client
======================
Execute Go code directly from Python via the GoRunner API.

Usage:
    from gorunner import GoRunner

    runner = GoRunner("http://localhost:8080")

    result = runner.execute('''
        package main
        import "fmt"
        func main() {
            fmt.Println("Hello from Go!")
        }
    ''')
    print(result.stdout)
"""

from __future__ import annotations

import json
import time
import textwrap
from dataclasses import dataclass, field
from typing import Optional, Dict, List, Any
from datetime import datetime

try:
    import urllib.request as urlrequest
    import urllib.error as urlerror
except ImportError:
    raise ImportError("Python 3.x is required")


# ============================================================
# DATA CLASSES
# ============================================================

@dataclass
class ExecuteResult:
    """Result of a Go code execution."""
    id: str
    status: str          # "success" | "error" | "timeout"
    stdout: str
    stderr: str
    exit_code: int
    duration_ms: float
    timestamp: datetime

    @property
    def ok(self) -> bool:
        """True if execution was successful."""
        return self.status == "success"

    @property
    def output(self) -> str:
        """Alias for stdout."""
        return self.stdout

    def __repr__(self) -> str:
        lines = self.stdout.strip().splitlines()
        preview = lines[0][:60] + "..." if lines and len(lines[0]) > 60 else (lines[0] if lines else "")
        return (
            f"ExecuteResult(status={self.status!r}, "
            f"exit_code={self.exit_code}, "
            f"duration={self.duration_ms:.1f}ms, "
            f"output={preview!r})"
        )


@dataclass
class CompileResult:
    """Result of a Go code compilation."""
    id: str
    status: str      # "success" | "error"
    error: str
    binary_path: str
    duration_ms: float
    timestamp: datetime

    @property
    def ok(self) -> bool:
        return self.status == "success"

    def __repr__(self) -> str:
        return (
            f"CompileResult(status={self.status!r}, "
            f"id={self.id!r}, "
            f"duration={self.duration_ms:.1f}ms)"
        )


@dataclass
class HealthInfo:
    """API health information."""
    status: str
    go_version: str
    uptime: str
    api_version: str

    @property
    def healthy(self) -> bool:
        return self.status == "ok"

    def __repr__(self) -> str:
        return f"HealthInfo(status={self.status!r}, go={self.go_version!r}, uptime={self.uptime!r})"


# ============================================================
# EXCEPTIONS
# ============================================================

class GoRunnerError(Exception):
    """Base exception for GoRunner errors."""
    pass

class ConnectionError(GoRunnerError):
    """Cannot connect to GoRunner API."""
    pass

class APIError(GoRunnerError):
    """API returned an error response."""
    def __init__(self, message: str, status_code: int = 0):
        super().__init__(message)
        self.status_code = status_code

class CompilationError(GoRunnerError):
    """Go code compilation failed."""
    def __init__(self, stderr: str):
        super().__init__(f"Compilation failed:\n{stderr}")
        self.stderr = stderr

class ExecutionError(GoRunnerError):
    """Go code execution failed."""
    def __init__(self, result: ExecuteResult):
        super().__init__(f"Execution failed (exit={result.exit_code}):\n{result.stderr}")
        self.result = result

class TimeoutError(GoRunnerError):
    """Execution timed out."""
    pass


# ============================================================
# HTTP HELPER (no external deps)
# ============================================================

def _http_post(url: str, data: dict, timeout: int = 60) -> dict:
    payload = json.dumps(data).encode("utf-8")
    req = urlrequest.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urlrequest.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urlerror.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        try:
            err = json.loads(body)
            msg = err.get("message", body)
        except Exception:
            msg = body
        raise APIError(msg, e.code)
    except urlerror.URLError as e:
        raise ConnectionError(f"Cannot connect to GoRunner at {url}: {e.reason}")


def _http_get(url: str, timeout: int = 10) -> dict:
    req = urlrequest.Request(url, method="GET")
    try:
        with urlrequest.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urlerror.HTTPError as e:
        raise APIError(e.reason, e.code)
    except urlerror.URLError as e:
        raise ConnectionError(f"Cannot connect to {url}: {e.reason}")


# ============================================================
# MAIN CLIENT
# ============================================================

class GoRunner:
    """
    Python client for the GoRunner API.
    Allows compiling and executing Go code from Python.

    Args:
        base_url: GoRunner API URL (e.g. "http://localhost:8080")
        default_timeout: Default execution timeout in seconds (max 120)
        auto_dedent: Automatically remove common leading whitespace from code
        raise_on_error: If True, raise exceptions on compilation/execution errors

    Example:
        runner = GoRunner("http://localhost:8080")

        # Simple execution
        result = runner.execute('''
            package main
            import "fmt"
            func main() { fmt.Println("Hello!") }
        ''')
        print(result.stdout)

        # With decorator
        @runner.go_func
        def fibonacci():
            '''
            package main
            import "fmt"
            func main() {
                a, b := 0, 1
                for i := 0; i < 10; i++ {
                    fmt.Printf("%d ", a)
                    a, b = b, a+b
                }
            }
            '''
        fibonacci()  # executes Go and prints result
    """

    def __init__(
        self,
        base_url: str = "http://localhost:8080",
        default_timeout: int = 30,
        auto_dedent: bool = True,
        raise_on_error: bool = False,
    ):
        self.base_url = base_url.rstrip("/")
        self.default_timeout = min(default_timeout, 120)
        self.auto_dedent = auto_dedent
        self.raise_on_error = raise_on_error
        self._compiled: Dict[str, str] = {}  # name -> binary_id

    # ----------------------------------------------------------
    # CORE METHODS
    # ----------------------------------------------------------

    def execute(
        self,
        code: str,
        args: Optional[List[str]] = None,
        env: Optional[Dict[str, str]] = None,
        timeout: Optional[int] = None,
    ) -> ExecuteResult:
        """
        Compile and execute Go code in one step.

        Args:
            code: Go source code (package main required)
            args: Command-line arguments passed to the program
            env: Extra environment variables
            timeout: Execution timeout in seconds

        Returns:
            ExecuteResult with stdout, stderr, exit_code, etc.

        Raises:
            CompilationError: if raise_on_error=True and compilation fails
            ExecutionError: if raise_on_error=True and execution fails
            TimeoutError: if raise_on_error=True and execution times out
        """
        if self.auto_dedent:
            code = textwrap.dedent(code).strip()

        payload: Dict[str, Any] = {"code": code}
        if args:
            payload["args"] = args
        if env:
            payload["env"] = env
        if timeout is not None:
            payload["timeout"] = min(timeout, 120)
        else:
            payload["timeout"] = self.default_timeout

        raw = _http_post(f"{self.base_url}/execute", payload, timeout=payload["timeout"] + 10)
        result = self._parse_execute_result(raw)

        if self.raise_on_error:
            if result.status == "timeout":
                raise TimeoutError(f"Execution timed out after {payload['timeout']}s")
            if result.status == "error":
                if result.exit_code == 1 and not result.stdout and result.stderr:
                    raise CompilationError(result.stderr)
                raise ExecutionError(result)

        return result

    def compile(self, code: str, name: Optional[str] = None) -> CompileResult:
        """
        Compile Go code and store the binary for later execution.

        Args:
            code: Go source code
            name: Optional name for the binary (auto-generated if omitted)

        Returns:
            CompileResult with id for use in run_compiled()
        """
        if self.auto_dedent:
            code = textwrap.dedent(code).strip()

        payload: Dict[str, Any] = {"code": code}
        if name:
            payload["output_name"] = name

        raw = _http_post(f"{self.base_url}/compile", payload)
        result = self._parse_compile_result(raw)

        if self.raise_on_error and not result.ok:
            raise CompilationError(result.error)

        if name and result.ok:
            self._compiled[name] = result.id

        return result

    def run_compiled(
        self,
        binary_id: str,
        args: Optional[List[str]] = None,
        env: Optional[Dict[str, str]] = None,
        timeout: Optional[int] = None,
    ) -> ExecuteResult:
        """
        Execute a previously compiled binary.

        Args:
            binary_id: ID returned by compile()
            args: Command-line arguments
            env: Extra environment variables
            timeout: Execution timeout in seconds

        Returns:
            ExecuteResult
        """
        # Check if it's a name alias
        if binary_id in self._compiled:
            binary_id = self._compiled[binary_id]

        payload: Dict[str, Any] = {}
        if args:
            payload["args"] = args
        if env:
            payload["env"] = env
        payload["timeout"] = min(timeout or self.default_timeout, 120)

        raw = _http_post(
            f"{self.base_url}/run/{binary_id}",
            payload,
            timeout=payload["timeout"] + 10
        )
        return self._parse_execute_result(raw)

    def health(self) -> HealthInfo:
        """Check API health status."""
        raw = _http_get(f"{self.base_url}/health")
        return HealthInfo(
            status=raw.get("status", "unknown"),
            go_version=raw.get("go_version", ""),
            uptime=raw.get("uptime", ""),
            api_version=raw.get("api_version", ""),
        )

    def is_alive(self) -> bool:
        """Return True if the API is reachable and healthy."""
        try:
            return self.health().healthy
        except (ConnectionError, APIError):
            return False

    # ----------------------------------------------------------
    # DECORATOR
    # ----------------------------------------------------------

    def go_func(self, fn):
        """
        Decorator: treat a Python function's docstring as Go code.

        @runner.go_func
        def hello():
            '''
            package main
            import "fmt"
            func main() { fmt.Println("Hello from Go!") }
            '''

        result = hello()
        print(result.stdout)
        """
        go_code = textwrap.dedent(fn.__doc__ or "").strip()
        fn_name = fn.__name__

        # Pre-compile
        compile_result = self.compile(go_code, name=fn_name)
        if not compile_result.ok and self.raise_on_error:
            raise CompilationError(compile_result.error)

        def wrapper(*args, **kwargs):
            str_args = [str(a) for a in args]
            if compile_result.ok:
                return self.run_compiled(fn_name, args=str_args or None)
            else:
                return self.execute(go_code, args=str_args or None)

        wrapper.__name__ = fn_name
        wrapper.__doc__ = fn.__doc__
        wrapper._go_code = go_code
        wrapper._compile_result = compile_result
        return wrapper

    # ----------------------------------------------------------
    # CONTEXT MANAGER
    # ----------------------------------------------------------

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def __repr__(self) -> str:
        return f"GoRunner(base_url={self.base_url!r}, timeout={self.default_timeout}s)"

    # ----------------------------------------------------------
    # PARSERS
    # ----------------------------------------------------------

    def _parse_execute_result(self, raw: dict) -> ExecuteResult:
        ts_str = raw.get("timestamp", "")
        try:
            ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        except Exception:
            ts = datetime.now()

        return ExecuteResult(
            id=raw.get("id", ""),
            status=raw.get("status", "error"),
            stdout=raw.get("stdout", ""),
            stderr=raw.get("stderr", ""),
            exit_code=raw.get("exit_code", -1),
            duration_ms=raw.get("duration_ms", 0.0),
            timestamp=ts,
        )

    def _parse_compile_result(self, raw: dict) -> CompileResult:
        ts_str = raw.get("timestamp", "")
        try:
            ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        except Exception:
            ts = datetime.now()

        return CompileResult(
            id=raw.get("id", ""),
            status=raw.get("status", "error"),
            error=raw.get("error", ""),
            binary_path=raw.get("binary_path", ""),
            duration_ms=raw.get("duration_ms", 0.0),
            timestamp=ts,
        )


# ============================================================
# CONVENIENCE FUNCTION
# ============================================================

def run_go(
    code: str,
    base_url: str = "http://localhost:8080",
    args: Optional[List[str]] = None,
    env: Optional[Dict[str, str]] = None,
    timeout: int = 30,
) -> ExecuteResult:
    """
    One-shot helper: execute Go code and return the result.

    Example:
        from gorunner import run_go

        result = run_go('''
            package main
            import "fmt"
            func main() { fmt.Println("Quick run!") }
        ''')
        print(result.stdout)
    """
    runner = GoRunner(base_url=base_url, default_timeout=timeout)
    return runner.execute(code, args=args, env=env, timeout=timeout)
