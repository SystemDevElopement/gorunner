# GoRunner API

**Ejecuta código Go directamente desde Python** — una API REST que compila y ejecuta `.go` on-demand.

## Arquitectura

```
Python Code
    │
    ▼
GoRunner Client (Python)
    │  HTTP/JSON
    ▼
GoRunner API (Go HTTP Server)
    │
    ├─ /execute   → compile + run en un paso
    ├─ /compile   → solo compilar (guarda binario)
    ├─ /run/{id}  → ejecutar binario compilado
    └─ /health    → estado del servidor
    │
    ▼
go build + exec (subprocess)
```

## Inicio rápido

### 1. Levantar la API con Docker

```bash
docker build -t gorunner .
docker run -p 8080:8080 gorunner
```

### 2. O directamente con Go

```bash
cd api/
go mod tidy
go run main.go
# → API en http://localhost:8080
```

### 3. Usar desde Python

```python
from gorunner import GoRunner

runner = GoRunner("http://localhost:8080")

result = runner.execute('''
    package main
    import "fmt"
    func main() {
        fmt.Println("¡Hola desde Go!")
    }
''')

print(result.stdout)    # ¡Hola desde Go!
print(result.ok)        # True
print(result.duration_ms)  # ~150.0
```

## Endpoints

| Método | Endpoint       | Descripción                          |
|--------|----------------|--------------------------------------|
| POST   | `/execute`     | Compila y ejecuta código Go          |
| POST   | `/compile`     | Solo compila, devuelve ID de binario |
| POST   | `/run/{id}`    | Ejecuta binario compilado            |
| GET    | `/health`      | Estado del servidor                  |
| GET    | `/version`     | Versión de la API                    |

## Request / Response

### POST /execute

**Request:**
```json
{
  "code": "package main\nimport \"fmt\"\nfunc main() { fmt.Println(\"Hi\") }",
  "args": ["arg1", "arg2"],
  "env": {"MI_VAR": "valor"},
  "timeout": 30
}
```

**Response:**
```json
{
  "id": "uuid",
  "status": "success",
  "stdout": "Hi\n",
  "stderr": "",
  "exit_code": 0,
  "duration_ms": 145.3,
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### POST /compile

**Request:**
```json
{
  "code": "package main...",
  "output_name": "mi_programa"
}
```

**Response:**
```json
{
  "id": "binary-uuid",
  "status": "success",
  "binary_path": "/tmp/bins/mi_programa",
  "duration_ms": 120.5,
  "timestamp": "..."
}
```

## Cliente Python - API completa

```python
from gorunner import GoRunner, run_go

runner = GoRunner(
    base_url="http://localhost:8080",
    default_timeout=30,
    auto_dedent=True,       # limpia indentación automáticamente
    raise_on_error=False,   # True = lanza excepciones
)

# 1. Ejecutar directo
result = runner.execute(code, args=["a", "b"], env={"K": "V"})

# 2. Compilar una vez, ejecutar muchas veces
cr = runner.compile(code, name="mi_bin")
for x in data:
    r = runner.run_compiled("mi_bin", args=[str(x)])

# 3. Decorador
@runner.go_func
def mi_funcion():
    """package main..."""

result = mi_funcion()

# 4. Helper rápido
result = run_go("package main...", base_url="http://localhost:8080")

# 5. Verificar salud
info = runner.health()
print(info.go_version, info.uptime)

# 6. Context manager
with GoRunner("http://localhost:8080") as r:
    result = r.execute(code)
```

## Ejecutar ejemplos

```bash
cd python_client/
python3 examples.py
```

## Variables de entorno

| Variable     | Default              | Descripción              |
|--------------|----------------------|--------------------------|
| `PORT`       | `8080`               | Puerto de la API         |
| `GORUNNER_URL` | `http://localhost:8080` | URL para el cliente Python |
