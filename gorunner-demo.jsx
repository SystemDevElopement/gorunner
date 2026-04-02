import { useState, useEffect, useRef } from "react";

const EXAMPLES = [
  {
    label: "Hello World",
    python: `from gorunner import GoRunner

runner = GoRunner("http://localhost:8080")

result = runner.execute("""
    package main
    import "fmt"
    func main() {
        fmt.Println("¡Hola desde Go!")
    }
""")

print(result.stdout)   # → ¡Hola desde Go!
print(result.ok)       # → True
print(f"{result.duration_ms:.0f}ms")`,
    go: `package main

import "fmt"

func main() {
    fmt.Println("¡Hola desde Go!")
}`,
    output: "¡Hola desde Go!\n",
    status: "success",
    ms: 143,
  },
  {
    label: "Fibonacci",
    python: `from gorunner import GoRunner

runner = GoRunner("http://localhost:8080")

result = runner.execute("""
    package main
    import "fmt"

    func fib(n int) int {
        if n <= 1 { return n }
        return fib(n-1) + fib(n-2)
    }

    func main() {
        for i := 0; i <= 10; i++ {
            fmt.Printf("fib(%d) = %d\\n", i, fib(i))
        }
    }
""")

print(result.stdout)`,
    go: `package main
import "fmt"

func fib(n int) int {
    if n <= 1 { return n }
    return fib(n-1) + fib(n-2)
}

func main() {
    for i := 0; i <= 10; i++ {
        fmt.Printf("fib(%d) = %d\\n", i, fib(i))
    }
}`,
    output: `fib(0) = 0
fib(1) = 1
fib(2) = 1
fib(3) = 2
fib(4) = 3
fib(5) = 5
fib(6) = 8
fib(7) = 13
fib(8) = 21
fib(9) = 34
fib(10) = 55`,
    status: "success",
    ms: 189,
  },
  {
    label: "@go_func Decorator",
    python: `from gorunner import GoRunner

runner = GoRunner("http://localhost:8080")

@runner.go_func
def sort_numbers():
    """
    package main
    import (
        "fmt"
        "sort"
    )
    func main() {
        nums := []int{64, 25, 12, 22, 11, 90, 3}
        fmt.Println("Antes:", nums)
        sort.Ints(nums)
        fmt.Println("Después:", nums)
    }
    """

result = sort_numbers()
print(result.stdout)`,
    go: `package main
import (
    "fmt"
    "sort"
)

func main() {
    nums := []int{64, 25, 12, 22, 11, 90, 3}
    fmt.Println("Antes:", nums)
    sort.Ints(nums)
    fmt.Println("Después:", nums)
}`,
    output: `Antes: [64 25 12 22 11 90 3]
Después: [3 11 12 22 25 64 90]`,
    status: "success",
    ms: 167,
  },
  {
    label: "Args Python → Go",
    python: `from gorunner import GoRunner

runner = GoRunner("http://localhost:8080")

code = """
    package main
    import (
        "fmt"
        "os"
        "strconv"
    )
    func main() {
        a, _ := strconv.ParseFloat(os.Args[1], 64)
        b, _ := strconv.ParseFloat(os.Args[2], 64)
        fmt.Printf("%.1f + %.1f = %.1f\\n", a, b, a+b)
        fmt.Printf("%.1f * %.1f = %.1f\\n", a, b, a*b)
    }
"""

# Pasamos args de Python a Go
result = runner.execute(code, args=["42.5", "7.3"])
print(result.stdout)`,
    go: `package main
import (
    "fmt"
    "os"
    "strconv"
)
func main() {
    a, _ := strconv.ParseFloat(os.Args[1], 64)
    b, _ := strconv.ParseFloat(os.Args[2], 64)
    fmt.Printf("%.1f + %.1f = %.1f\\n", a, b, a+b)
    fmt.Printf("%.1f * %.1f = %.1f\\n", a, b, a*b)
}`,
    output: `42.5 + 7.3 = 49.8
42.5 * 7.3 = 310.3`,
    status: "success",
    ms: 155,
  },
  {
    label: "Goroutines",
    python: `from gorunner import GoRunner

runner = GoRunner("http://localhost:8080")

result = runner.execute("""
    package main
    import (
        "fmt"
        "sync"
    )

    func worker(id int, wg *sync.WaitGroup) {
        defer wg.Done()
        sum := 0
        for i := 0; i < 1000000; i++ { sum += i }
        fmt.Printf("Worker %d: sum=%d\\n", id, sum)
    }

    func main() {
        var wg sync.WaitGroup
        for i := 1; i <= 4; i++ {
            wg.Add(1)
            go worker(i, &wg)
        }
        wg.Wait()
    }
""")

print(result.stdout)`,
    go: `package main
import (
    "fmt"
    "sync"
)
func worker(id int, wg *sync.WaitGroup) {
    defer wg.Done()
    sum := 0
    for i := 0; i < 1000000; i++ { sum += i }
    fmt.Printf("Worker %d: sum=%d\\n", id, sum)
}
func main() {
    var wg sync.WaitGroup
    for i := 1; i <= 4; i++ {
        wg.Add(1)
        go worker(i, &wg)
    }
    wg.Wait()
}`,
    output: `Worker 2: sum=499999500000
Worker 4: sum=499999500000
Worker 1: sum=499999500000
Worker 3: sum=499999500000`,
    status: "success",
    ms: 312,
  },
  {
    label: "Error de compilación",
    python: `from gorunner import GoRunner

runner = GoRunner("http://localhost:8080")

# Código con error intencional
result = runner.execute("""
    package main
    import "fmt"
    func main() {
        fmt.Println("missing quote
        x := undefined_var
    }
""")

if not result.ok:
    print("✗ Error detectado:")
    print(result.stderr[:120])
    print(f"Exit code: {result.exit_code}")`,
    go: `package main
import "fmt"
func main() {
    fmt.Println("missing quote
    x := undefined_var
}`,
    output: `./main.go:4:20: newline in string
./main.go:5:9: undefined: undefined_var`,
    status: "error",
    ms: 98,
  },
];

const ENDPOINTS = [
  { method: "POST", path: "/execute", desc: "Compilar + ejecutar en un paso" },
  { method: "POST", path: "/compile", desc: "Solo compilar → devuelve ID" },
  { method: "POST", path: "/run/{id}", desc: "Ejecutar binario compilado" },
  { method: "GET",  path: "/health",  desc: "Estado del servidor" },
  { method: "GET",  path: "/version", desc: "Versión de la API" },
];

function TypewriterText({ text, speed = 8 }) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);
  const ref = useRef(0);

  useEffect(() => {
    setDisplayed("");
    setDone(false);
    ref.current = 0;
    const id = setInterval(() => {
      ref.current++;
      setDisplayed(text.slice(0, ref.current));
      if (ref.current >= text.length) {
        clearInterval(id);
        setDone(true);
      }
    }, speed);
    return () => clearInterval(id);
  }, [text]);

  return <span>{displayed}{!done && <span className="cursor">▌</span>}</span>;
}

function Badge({ status }) {
  const color = status === "success" ? "#00ff88" : "#ff4466";
  const label = status === "success" ? "✓ success" : "✗ error";
  return (
    <span style={{
      background: color + "22",
      color,
      border: `1px solid ${color}55`,
      borderRadius: 4,
      padding: "2px 8px",
      fontSize: 11,
      fontFamily: "monospace",
      fontWeight: 700,
      letterSpacing: 1,
    }}>{label}</span>
  );
}

function MethodBadge({ method }) {
  const colors = { GET: "#00cfff", POST: "#ffaa00" };
  return (
    <span style={{
      background: (colors[method] || "#aaa") + "22",
      color: colors[method] || "#aaa",
      border: `1px solid ${(colors[method] || "#aaa")}44`,
      borderRadius: 3,
      padding: "2px 7px",
      fontSize: 11,
      fontFamily: "monospace",
      fontWeight: 700,
      minWidth: 44,
      display: "inline-block",
      textAlign: "center",
    }}>{method}</span>
  );
}

export default function App() {
  const [selected, setSelected] = useState(0);
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState(null);
  const [tab, setTab] = useState("python"); // python | go | output
  const [showArch, setShowArch] = useState(false);

  const example = EXAMPLES[selected];

  function simulate() {
    setRunning(true);
    setTab("output");
    setOutput(null);
    setTimeout(() => {
      setOutput(example);
      setRunning(false);
    }, 800 + Math.random() * 400);
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0a0c10",
      color: "#c8d0e0",
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
      padding: 0,
      margin: 0,
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700&family=Syne:wght@700;800&display=swap');

        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #111520; }
        ::-webkit-scrollbar-thumb { background: #2a3050; border-radius: 3px; }

        .cursor { animation: blink 1s step-end infinite; }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }

        .tab-btn {
          background: transparent;
          border: none;
          color: #556080;
          font-family: inherit;
          font-size: 12px;
          padding: 6px 16px;
          cursor: pointer;
          border-bottom: 2px solid transparent;
          transition: all .15s;
          letter-spacing: .5px;
        }
        .tab-btn.active { color: #7eb8ff; border-bottom-color: #7eb8ff; }
        .tab-btn:hover:not(.active) { color: #8899bb; }

        .ex-btn {
          background: transparent;
          border: 1px solid #1e2535;
          color: #556080;
          font-family: inherit;
          font-size: 11px;
          padding: 7px 12px;
          cursor: pointer;
          border-radius: 6px;
          text-align: left;
          transition: all .15s;
        }
        .ex-btn.active {
          background: #1a2540;
          border-color: #3a5090;
          color: #7eb8ff;
        }
        .ex-btn:hover:not(.active) { border-color: #2e3a55; color: #7788aa; }

        .run-btn {
          background: linear-gradient(135deg, #1a4acc, #0e3399);
          border: 1px solid #2a5add;
          color: #9dc8ff;
          font-family: inherit;
          font-size: 13px;
          font-weight: 700;
          padding: 10px 28px;
          cursor: pointer;
          border-radius: 6px;
          letter-spacing: 1px;
          transition: all .2s;
        }
        .run-btn:hover { background: linear-gradient(135deg, #2255ee, #1a44bb); }
        .run-btn:disabled { opacity: .5; cursor: not-allowed; }

        .code-area {
          background: #070a0e;
          border: 1px solid #151c2a;
          border-radius: 8px;
          padding: 20px;
          font-size: 12px;
          line-height: 1.7;
          overflow: auto;
          white-space: pre;
          flex: 1;
          min-height: 0;
        }

        .kw { color: #7eb8ff; }
        .str { color: #98e06a; }
        .fn { color: #f0c060; }
        .cm { color: #445570; }
        .op { color: #cc88ff; }
        .num { color: #ff9055; }

        .endpoint-row {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 16px;
          border-bottom: 1px solid #111820;
          transition: background .15s;
        }
        .endpoint-row:hover { background: #0e1420; }
        .endpoint-row:last-child { border-bottom: none; }
      `}</style>

      {/* Header */}
      <div style={{
        borderBottom: "1px solid #111a2a",
        padding: "20px 32px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "#080b10",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{
            width: 38, height: 38,
            background: "linear-gradient(135deg, #1a4acc, #7e22ce)",
            borderRadius: 8,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18,
          }}>⚡</div>
          <div>
            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, fontWeight: 800, color: "#e8f0ff", letterSpacing: -0.5 }}>
              GoRunner API
            </div>
            <div style={{ fontSize: 11, color: "#445570", letterSpacing: 1 }}>
              EXECUTE GO FROM PYTHON
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ background: "#0e1420", border: "1px solid #1e2a40", borderRadius: 6, padding: "5px 12px", fontSize: 11, color: "#556080" }}>
            v1.0.0
          </div>
          <div style={{ background: "#001a0a", border: "1px solid #004422", borderRadius: 6, padding: "5px 12px", fontSize: 11, color: "#00aa55" }}>
            ● API Online
          </div>
        </div>
      </div>

      <div style={{ display: "flex", height: "calc(100vh - 75px)" }}>

        {/* Sidebar */}
        <div style={{
          width: 220,
          borderRight: "1px solid #111a2a",
          padding: "16px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 4,
          overflowY: "auto",
          background: "#080b10",
          flexShrink: 0,
        }}>
          <div style={{ fontSize: 10, color: "#334055", letterSpacing: 1.5, padding: "4px 8px 8px", fontWeight: 700 }}>
            EJEMPLOS
          </div>
          {EXAMPLES.map((ex, i) => (
            <button
              key={i}
              className={`ex-btn ${selected === i ? "active" : ""}`}
              onClick={() => { setSelected(i); setOutput(null); setTab("python"); }}
            >
              {ex.label}
            </button>
          ))}

          <div style={{ marginTop: 20, fontSize: 10, color: "#334055", letterSpacing: 1.5, padding: "4px 8px 8px", fontWeight: 700 }}>
            ENDPOINTS
          </div>
          <div style={{ background: "#070a0e", border: "1px solid #111820", borderRadius: 6, overflow: "hidden" }}>
            {ENDPOINTS.map((ep, i) => (
              <div key={i} className="endpoint-row">
                <MethodBadge method={ep.method} />
                <div>
                  <div style={{ fontSize: 11, color: "#8899cc", fontWeight: 700 }}>{ep.path}</div>
                  <div style={{ fontSize: 10, color: "#334055", marginTop: 1 }}>{ep.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Main */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>

          {/* Tab bar */}
          <div style={{
            borderBottom: "1px solid #111a2a",
            padding: "0 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "#080b10",
            flexShrink: 0,
          }}>
            <div style={{ display: "flex" }}>
              {["python", "go", "output"].map(t => (
                <button
                  key={t}
                  className={`tab-btn ${tab === t ? "active" : ""}`}
                  onClick={() => setTab(t)}
                >
                  {t === "python" ? "🐍 Python" : t === "go" ? "🔵 Go" : "▶ Output"}
                  {t === "output" && output && (
                    <span style={{ marginLeft: 6 }}>
                      <Badge status={output.status} />
                    </span>
                  )}
                </button>
              ))}
            </div>
            <button
              className="run-btn"
              onClick={simulate}
              disabled={running}
            >
              {running ? "⏳ Running..." : "▶ Run"}
            </button>
          </div>

          {/* Code / Output area */}
          <div style={{ flex: 1, padding: 24, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
            {tab === "python" && (
              <div className="code-area">
                <PythonHighlight code={example.python} />
              </div>
            )}

            {tab === "go" && (
              <div className="code-area">
                <GoHighlight code={example.go} />
              </div>
            )}

            {tab === "output" && (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16, minHeight: 0 }}>
                {running && (
                  <div style={{
                    background: "#070a0e",
                    border: "1px solid #151c2a",
                    borderRadius: 8,
                    padding: 24,
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                    color: "#556080",
                  }}>
                    <div style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⚙</div>
                    <span style={{ fontSize: 13 }}>Compilando y ejecutando código Go...</span>
                    <style>{`@keyframes spin { from{transform:rotate(0)} to{transform:rotate(360deg)} }`}</style>
                  </div>
                )}

                {output && !running && (
                  <>
                    {/* Meta bar */}
                    <div style={{
                      background: "#070a0e",
                      border: "1px solid #151c2a",
                      borderRadius: 8,
                      padding: "12px 20px",
                      display: "flex",
                      gap: 24,
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span style={{ fontSize: 11, color: "#334055" }}>STATUS</span>
                        <Badge status={output.status} />
                      </div>
                      <div style={{ fontSize: 12, color: "#556080" }}>
                        <span style={{ color: "#334055", marginRight: 6 }}>DURATION</span>
                        <span style={{ color: "#ffaa44" }}>{output.ms}ms</span>
                      </div>
                      <div style={{ fontSize: 12, color: "#556080" }}>
                        <span style={{ color: "#334055", marginRight: 6 }}>EXIT</span>
                        <span style={{ color: output.status === "success" ? "#00ff88" : "#ff4466" }}>
                          {output.status === "success" ? "0" : "1"}
                        </span>
                      </div>
                    </div>

                    {/* Output */}
                    <div className="code-area" style={{
                      borderColor: output.status === "success" ? "#001a0a" : "#1a0008",
                    }}>
                      <div style={{ fontSize: 10, color: "#334055", marginBottom: 12, letterSpacing: 1 }}>
                        {output.status === "success" ? "STDOUT" : "STDERR"}
                      </div>
                      <span style={{ color: output.status === "success" ? "#98e06a" : "#ff6688" }}>
                        <TypewriterText text={output.output} speed={12} />
                      </span>
                    </div>
                  </>
                )}

                {!output && !running && (
                  <div style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#2a3550",
                    fontSize: 13,
                    flexDirection: "column",
                    gap: 8,
                  }}>
                    <div style={{ fontSize: 32 }}>▶</div>
                    <div>Presiona Run para ejecutar</div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right panel: Architecture */}
        <div style={{
          width: 280,
          borderLeft: "1px solid #111a2a",
          padding: 20,
          overflowY: "auto",
          background: "#080b10",
          flexShrink: 0,
        }}>
          <div style={{ fontSize: 10, color: "#334055", letterSpacing: 1.5, fontWeight: 700, marginBottom: 16 }}>
            ARQUITECTURA
          </div>

          <div style={{
            background: "#070a0e",
            border: "1px solid #111820",
            borderRadius: 8,
            padding: 16,
            fontSize: 11,
            lineHeight: 2,
            color: "#445570",
          }}>
            {[
              { icon: "🐍", label: "Python Code", color: "#7eb8ff" },
              { icon: "↓", label: "", color: "#334055" },
              { icon: "📦", label: "GoRunner Client", color: "#cc88ff" },
              { icon: "↓", label: "HTTP/JSON", color: "#334055" },
              { icon: "⚡", label: "GoRunner API", color: "#ffaa44" },
              { icon: "↓", label: "", color: "#334055" },
              { icon: "🔨", label: "go build", color: "#00ff88" },
              { icon: "↓", label: "", color: "#334055" },
              { icon: "▶", label: "./binary", color: "#00ff88" },
            ].map((item, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 18, textAlign: "center" }}>{item.icon}</span>
                {item.label && <span style={{ color: item.color, fontWeight: item.label.startsWith("HTTP") ? 400 : 600 }}>{item.label}</span>}
              </div>
            ))}
          </div>

          <div style={{ marginTop: 20, fontSize: 10, color: "#334055", letterSpacing: 1.5, fontWeight: 700, marginBottom: 12 }}>
            INSTALACIÓN
          </div>

          {[
            { label: "1. Levantar API", cmd: "docker run -p 8080:8080 gorunner" },
            { label: "2. Usar en Python", cmd: "from gorunner import GoRunner\nrunner = GoRunner(\n  'http://localhost:8080'\n)" },
          ].map((step, i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: "#556080", marginBottom: 6, letterSpacing: .5 }}>{step.label}</div>
              <div style={{
                background: "#050810",
                border: "1px solid #111820",
                borderRadius: 6,
                padding: "8px 12px",
                fontSize: 11,
                color: "#7eb8ff",
                whiteSpace: "pre",
              }}>{step.cmd}</div>
            </div>
          ))}

          <div style={{ marginTop: 20, fontSize: 10, color: "#334055", letterSpacing: 1.5, fontWeight: 700, marginBottom: 12 }}>
            CARACTERÍSTICAS
          </div>
          {[
            "execute() — compile + run",
            "compile() — solo compilar",
            "run_compiled() — reusar",
            "@go_func — decorador",
            "run_go() — helper rápido",
            "args= — Python → Go",
            "env= — variables entorno",
            "Sin dependencias externas",
          ].map((f, i) => (
            <div key={i} style={{ fontSize: 11, color: "#445570", padding: "3px 0", borderBottom: "1px solid #0d1220" }}>
              <span style={{ color: "#00aa55", marginRight: 8 }}>✓</span>{f}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Syntax highlight helpers (simple regex-based)
// ============================================================

function PythonHighlight({ code }) {
  const tokens = [];
  const lines = code.split("\n");
  lines.forEach((line, li) => {
    const parts = tokenizePython(line);
    parts.forEach((p, pi) => tokens.push(<span key={`${li}-${pi}`} style={{ color: p.color }}>{p.text}</span>));
    if (li < lines.length - 1) tokens.push(<br key={`br-${li}`} />);
  });
  return <>{tokens}</>;
}

function tokenizePython(line) {
  const out = [];
  // Comment
  const cmIdx = line.indexOf("#");
  if (cmIdx >= 0) {
    if (cmIdx > 0) out.push(...tokenizePythonLine(line.slice(0, cmIdx)));
    out.push({ text: line.slice(cmIdx), color: "#445570" });
    return out;
  }
  return tokenizePythonLine(line);
}

function tokenizePythonLine(line) {
  const out = [];
  const kws = /\b(from|import|def|class|if|else|elif|for|while|return|not|in|and|or|True|False|None|print|with|as)\b/g;
  let last = 0, m;
  // Very simple: just highlight keywords and strings
  const regex = /("""[\s\S]*?"""|'''[\s\S]*?'''|"[^"]*"|'[^']*'|\b(from|import|def|class|if|else|elif|for|while|return|not|in|and|or|True|False|None|print|with|as)\b)/g;
  while ((m = regex.exec(line)) !== null) {
    if (m.index > last) out.push({ text: line.slice(last, m.index), color: "#c8d0e0" });
    const tok = m[0];
    if (tok.startsWith('"') || tok.startsWith("'")) out.push({ text: tok, color: "#98e06a" });
    else out.push({ text: tok, color: "#7eb8ff" });
    last = regex.lastIndex;
  }
  if (last < line.length) out.push({ text: line.slice(last), color: "#c8d0e0" });
  return out;
}

function GoHighlight({ code }) {
  const tokens = [];
  const lines = code.split("\n");
  lines.forEach((line, li) => {
    const parts = tokenizeGo(line);
    parts.forEach((p, pi) => tokens.push(<span key={`${li}-${pi}`} style={{ color: p.color }}>{p.text}</span>));
    if (li < lines.length - 1) tokens.push(<br key={`br-${li}`} />);
  });
  return <>{tokens}</>;
}

function tokenizeGo(line) {
  const out = [];
  if (line.trim().startsWith("//")) return [{ text: line, color: "#445570" }];
  const regex = /("(?:[^"\\]|\\.)*"|\b(package|import|func|var|const|type|struct|interface|for|if|else|return|go|defer|select|case|switch|break|continue|fallthrough|range|chan|map|nil|true|false|int|string|float64|bool|error)\b)/g;
  let last = 0, m;
  while ((m = regex.exec(line)) !== null) {
    if (m.index > last) out.push({ text: line.slice(last, m.index), color: "#c8d0e0" });
    const tok = m[0];
    if (tok.startsWith('"')) out.push({ text: tok, color: "#98e06a" });
    else out.push({ text: tok, color: "#7eb8ff" });
    last = regex.lastIndex;
  }
  if (last < line.length) out.push({ text: line.slice(last), color: "#c8d0e0" });
  return out;
}
