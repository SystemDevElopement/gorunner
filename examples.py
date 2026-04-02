"""
GoRunner - Ejemplos de uso completos
=====================================
Ejecuta código Go directamente desde Python.
"""

import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from gorunner import GoRunner, run_go, CompilationError, ExecutionError

# ============================================================
# CONFIGURACIÓN
# ============================================================

API_URL = os.getenv("GORUNNER_URL", "http://localhost:8080")
runner = GoRunner(API_URL, default_timeout=30, raise_on_error=False)


def separator(title: str):
    print(f"\n{'='*55}")
    print(f"  {title}")
    print('='*55)


# ============================================================
# EJEMPLO 1: Hola Mundo
# ============================================================

separator("Ejemplo 1: Hello World")

result = runner.execute("""
    package main
    import "fmt"
    func main() {
        fmt.Println("¡Hola desde Go ejecutado por Python!")
    }
""")

print(f"Status : {result.status}")
print(f"Output : {result.stdout.strip()}")
print(f"Tiempo : {result.duration_ms:.1f}ms")


# ============================================================
# EJEMPLO 2: Fibonacci en Go
# ============================================================

separator("Ejemplo 2: Fibonacci en Go")

fib_code = """
package main

import "fmt"

func fibonacci(n int) int {
    if n <= 1 {
        return n
    }
    return fibonacci(n-1) + fibonacci(n-2)
}

func main() {
    for i := 0; i <= 10; i++ {
        fmt.Printf("fib(%d) = %d\\n", i, fibonacci(i))
    }
}
"""

result = runner.execute(fib_code)
if result.ok:
    print(result.stdout)
else:
    print("Error:", result.stderr)


# ============================================================
# EJEMPLO 3: Pasar argumentos desde Python
# ============================================================

separator("Ejemplo 3: Pasar argumentos de Python a Go")

calc_code = """
package main

import (
    "fmt"
    "os"
    "strconv"
)

func main() {
    if len(os.Args) < 3 {
        fmt.Println("Uso: programa <num1> <num2>")
        os.Exit(1)
    }
    a, _ := strconv.ParseFloat(os.Args[1], 64)
    b, _ := strconv.ParseFloat(os.Args[2], 64)
    fmt.Printf("%.2f + %.2f = %.2f\\n", a, b, a+b)
    fmt.Printf("%.2f * %.2f = %.2f\\n", a, b, a*b)
}
"""

# Pasamos argumentos Python → Go
result = runner.execute(calc_code, args=["42.5", "7.3"])
print(result.stdout.strip())


# ============================================================
# EJEMPLO 4: Variables de entorno
# ============================================================

separator("Ejemplo 4: Variables de entorno")

env_code = """
package main

import (
    "fmt"
    "os"
)

func main() {
    nombre := os.Getenv("NOMBRE")
    ciudad := os.Getenv("CIUDAD")
    if nombre == "" { nombre = "Mundo" }
    if ciudad == "" { ciudad = "desconocida" }
    fmt.Printf("Hola %s desde %s!\\n", nombre, ciudad)
}
"""

result = runner.execute(env_code, env={"NOMBRE": "Python", "CIUDAD": "Madrid"})
print(result.stdout.strip())


# ============================================================
# EJEMPLO 5: Compilar una vez, ejecutar múltiples veces
# ============================================================

separator("Ejemplo 5: Compilar → Ejecutar múltiples veces")

heavy_code = """
package main

import (
    "fmt"
    "os"
    "strconv"
    "math"
)

func main() {
    n, _ := strconv.Atoi(os.Args[1])
    sum := 0.0
    for i := 1; i <= n; i++ {
        sum += math.Sqrt(float64(i))
    }
    fmt.Printf("Suma de raíces hasta %d = %.4f\\n", n, sum)
}
"""

print("Compilando...")
compile_result = runner.compile(heavy_code, name="raices")
if compile_result.ok:
    print(f"✓ Compilado en {compile_result.duration_ms:.0f}ms (ID: {compile_result.id[:8]}...)")

    for n in [100, 1000, 10000]:
        r = runner.run_compiled("raices", args=[str(n)])
        print(f"  n={n:>6}: {r.stdout.strip()} ({r.duration_ms:.1f}ms)")
else:
    print("Error de compilación:", compile_result.error)


# ============================================================
# EJEMPLO 6: Decorator @go_func
# ============================================================

separator("Ejemplo 6: Decorator @runner.go_func")

@runner.go_func
def sort_numbers():
    """
    package main

    import (
        "fmt"
        "sort"
    )

    func main() {
        nums := []int{64, 25, 12, 22, 11, 90, 3, 77}
        fmt.Println("Antes:", nums)
        sort.Ints(nums)
        fmt.Println("Después:", nums)
    }
    """

result = sort_numbers()
print(result.stdout.strip())


# ============================================================
# EJEMPLO 7: Go concurrente (goroutines)
# ============================================================

separator("Ejemplo 7: Concurrencia con goroutines")

concurrent_code = """
package main

import (
    "fmt"
    "sync"
)

func worker(id int, wg *sync.WaitGroup) {
    defer wg.Done()
    fmt.Printf("Worker %d iniciado\\n", id)
    sum := 0
    for i := 0; i < 1000000; i++ {
        sum += i
    }
    fmt.Printf("Worker %d terminado, suma=%d\\n", id, sum)
}

func main() {
    var wg sync.WaitGroup
    for i := 1; i <= 4; i++ {
        wg.Add(1)
        go worker(i, &wg)
    }
    wg.Wait()
    fmt.Println("¡Todos los workers completados!")
}
"""

result = runner.execute(concurrent_code)
print(result.stdout)


# ============================================================
# EJEMPLO 8: Manejo de errores de compilación
# ============================================================

separator("Ejemplo 8: Manejo de errores de compilación")

bad_code = """
package main

import "fmt"

func main() {
    fmt.Println("Este código tiene un error
    x := undefined_variable
}
"""

result = runner.execute(bad_code)
if not result.ok:
    print("✓ Error detectado correctamente")
    print("Exit code:", result.exit_code)
    print("Stderr:", result.stderr[:200].strip())


# ============================================================
# EJEMPLO 9: run_go() - helper de una línea
# ============================================================

separator("Ejemplo 9: Función run_go() rápida")

from gorunner import run_go

r = run_go("""
    package main
    import (
        "fmt"
        "runtime"
    )
    func main() {
        fmt.Printf("Go %s en %s/%s\\n",
            runtime.Version(),
            runtime.GOOS,
            runtime.GOARCH)
    }
""", base_url=API_URL)
print(r.stdout.strip())


# ============================================================
# EJEMPLO 10: Context manager
# ============================================================

separator("Ejemplo 10: Context Manager")

with GoRunner(API_URL) as gr:
    r = gr.execute("""
        package main
        import "fmt"
        func main() {
            fmt.Println("Usando context manager!")
        }
    """)
    print(r.stdout.strip())

# ============================================================
# RESUMEN
# ============================================================

separator("✅ Todos los ejemplos completados")
print("\nCaracterísticas demostradas:")
features = [
    "execute()  → Compilar + ejecutar en un paso",
    "compile()  → Solo compilar, guardar binario",
    "run_compiled() → Reusar binarios compilados",
    "@go_func   → Decorador para funciones Go",
    "run_go()   → Helper de una línea",
    "args=[]    → Pasar argumentos Python→Go",
    "env={}     → Variables de entorno",
    "Goroutines → Código Go concurrente",
    "Error handling → Compilación y ejecución",
]
for f in features:
    print(f"  ✓ {f}")
