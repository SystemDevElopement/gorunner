package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

// ============================================================
// MODELS
// ============================================================

type ExecuteRequest struct {
	Code    string            `json:"code"`
	Args    []string          `json:"args,omitempty"`
	Env     map[string]string `json:"env,omitempty"`
	Timeout int               `json:"timeout,omitempty"` // seconds, default 30
}

type ExecuteResponse struct {
	ID        string        `json:"id"`
	Status    string        `json:"status"` // "success" | "error" | "timeout"
	Stdout    string        `json:"stdout"`
	Stderr    string        `json:"stderr"`
	ExitCode  int           `json:"exit_code"`
	Duration  float64       `json:"duration_ms"`
	Timestamp time.Time     `json:"timestamp"`
}

type CompileRequest struct {
	Code       string `json:"code"`
	OutputName string `json:"output_name,omitempty"`
}

type CompileResponse struct {
	ID       string    `json:"id"`
	Status   string    `json:"status"`
	Error    string    `json:"error,omitempty"`
	Binary   string    `json:"binary_path,omitempty"`
	Duration float64   `json:"duration_ms"`
	Timestamp time.Time `json:"timestamp"`
}

type HealthResponse struct {
	Status    string `json:"status"`
	GoVersion string `json:"go_version"`
	Uptime    string `json:"uptime"`
	Version   string `json:"api_version"`
}

type ErrorResponse struct {
	Error   string `json:"error"`
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// ============================================================
// SERVER
// ============================================================

var (
	startTime  = time.Now()
	binDir     string
	mu         sync.Mutex
	compiledBins = make(map[string]string) // id -> path
)

func main() {
	var err error
	binDir, err = os.MkdirTemp("", "gorunner-bins-*")
	if err != nil {
		log.Fatal("Cannot create bin dir:", err)
	}
	defer os.RemoveAll(binDir)

	mux := http.NewServeMux()

	// Routes
	mux.HandleFunc("/health", corsMiddleware(healthHandler))
	mux.HandleFunc("/execute", corsMiddleware(executeHandler))
	mux.HandleFunc("/compile", corsMiddleware(compileHandler))
	mux.HandleFunc("/run/", corsMiddleware(runCompiledHandler))
	mux.HandleFunc("/version", corsMiddleware(versionHandler))

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("🚀 GoRunner API starting on :%s", port)
	log.Printf("📁 Binaries dir: %s", binDir)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}

// ============================================================
// MIDDLEWARE
// ============================================================

func corsMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next(w, r)
	}
}

// ============================================================
// HANDLERS
// ============================================================

func healthHandler(w http.ResponseWriter, r *http.Request) {
	goVer := ""
	out, err := exec.Command("go", "version").Output()
	if err == nil {
		goVer = strings.TrimSpace(string(out))
	}

	resp := HealthResponse{
		Status:    "ok",
		GoVersion: goVer,
		Uptime:    time.Since(startTime).Round(time.Second).String(),
		Version:   "1.0.0",
	}
	writeJSON(w, http.StatusOK, resp)
}

func versionHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"api_version": "1.0.0",
		"name":        "GoRunner",
		"description": "Execute Go code from Python",
	})
}

// executeHandler: compila y ejecuta en un solo paso
func executeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Only POST allowed")
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20)) // 1MB limit
	if err != nil {
		writeError(w, http.StatusBadRequest, "Cannot read body")
		return
	}

	var req ExecuteRequest
	if err := json.Unmarshal(body, &req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON: "+err.Error())
		return
	}

	if strings.TrimSpace(req.Code) == "" {
		writeError(w, http.StatusBadRequest, "Field 'code' is required")
		return
	}

	timeout := req.Timeout
	if timeout <= 0 {
		timeout = 30
	}
	if timeout > 120 {
		timeout = 120
	}

	id := uuid.New().String()
	start := time.Now()

	// Write code to temp file
	tmpDir, err := os.MkdirTemp("", "gorun-*")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Cannot create temp dir")
		return
	}
	defer os.RemoveAll(tmpDir)

	srcPath := filepath.Join(tmpDir, "main.go")
	binPath := filepath.Join(tmpDir, "main")

	if err := os.WriteFile(srcPath, []byte(req.Code), 0644); err != nil {
		writeError(w, http.StatusInternalServerError, "Cannot write source file")
		return
	}

	// Init module
	initCmd := exec.Command("go", "mod", "init", "gorunner_exec")
	initCmd.Dir = tmpDir
	initCmd.Run()

	// Compile
	buildCmd := exec.Command("go", "build", "-o", binPath, srcPath)
	buildCmd.Dir = tmpDir
	var buildStderr strings.Builder
	buildCmd.Stderr = &buildStderr

	if err := buildCmd.Run(); err != nil {
		elapsed := time.Since(start).Seconds() * 1000
		resp := ExecuteResponse{
			ID:        id,
			Status:    "error",
			Stderr:    buildStderr.String(),
			ExitCode:  1,
			Duration:  elapsed,
			Timestamp: time.Now(),
		}
		writeJSON(w, http.StatusOK, resp)
		return
	}

	// Run with timeout
	runCmd := exec.Command(binPath, req.Args...)

	// Set env vars
	runCmd.Env = os.Environ()
	for k, v := range req.Env {
		runCmd.Env = append(runCmd.Env, k+"="+v)
	}

	var stdout, stderr strings.Builder
	runCmd.Stdout = &stdout
	runCmd.Stderr = &stderr

	done := make(chan error, 1)
	go func() { done <- runCmd.Run() }()

	var status string
	var exitCode int

	select {
	case err := <-done:
		if err != nil {
			status = "error"
			if exitErr, ok := err.(*exec.ExitError); ok {
				exitCode = exitErr.ExitCode()
			} else {
				exitCode = 1
			}
		} else {
			status = "success"
			exitCode = 0
		}
	case <-time.After(time.Duration(timeout) * time.Second):
		runCmd.Process.Kill()
		status = "timeout"
		exitCode = -1
	}

	elapsed := time.Since(start).Seconds() * 1000
	resp := ExecuteResponse{
		ID:        id,
		Status:    status,
		Stdout:    stdout.String(),
		Stderr:    stderr.String(),
		ExitCode:  exitCode,
		Duration:  elapsed,
		Timestamp: time.Now(),
	}
	writeJSON(w, http.StatusOK, resp)
}

// compileHandler: solo compila, guarda el binario para ejecución posterior
func compileHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Only POST allowed")
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Cannot read body")
		return
	}

	var req CompileRequest
	if err := json.Unmarshal(body, &req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON: "+err.Error())
		return
	}

	if strings.TrimSpace(req.Code) == "" {
		writeError(w, http.StatusBadRequest, "Field 'code' is required")
		return
	}

	id := uuid.New().String()
	start := time.Now()

	tmpDir, err := os.MkdirTemp("", "gocompile-*")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Cannot create temp dir")
		return
	}

	srcPath := filepath.Join(tmpDir, "main.go")
	outputName := req.OutputName
	if outputName == "" {
		outputName = id
	}
	binPath := filepath.Join(binDir, outputName)

	if err := os.WriteFile(srcPath, []byte(req.Code), 0644); err != nil {
		os.RemoveAll(tmpDir)
		writeError(w, http.StatusInternalServerError, "Cannot write source")
		return
	}
	defer os.RemoveAll(tmpDir)

	initCmd := exec.Command("go", "mod", "init", "gorunner_compile")
	initCmd.Dir = tmpDir
	initCmd.Run()

	buildCmd := exec.Command("go", "build", "-o", binPath, srcPath)
	buildCmd.Dir = tmpDir
	var buildStderr strings.Builder
	buildCmd.Stderr = &buildStderr

	elapsed := time.Since(start).Seconds() * 1000

	if err := buildCmd.Run(); err != nil {
		resp := CompileResponse{
			ID:        id,
			Status:    "error",
			Error:     buildStderr.String(),
			Duration:  elapsed,
			Timestamp: time.Now(),
		}
		writeJSON(w, http.StatusOK, resp)
		return
	}

	mu.Lock()
	compiledBins[id] = binPath
	mu.Unlock()

	resp := CompileResponse{
		ID:         id,
		Status:     "success",
		Binary:     binPath,
		Duration:   elapsed,
		Timestamp:  time.Now(),
	}
	writeJSON(w, http.StatusCreated, resp)
}

// runCompiledHandler: ejecuta un binario previamente compilado
func runCompiledHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Only POST allowed")
		return
	}

	// Extract ID from URL: /run/{id}
	id := strings.TrimPrefix(r.URL.Path, "/run/")
	if id == "" {
		writeError(w, http.StatusBadRequest, "Missing binary ID in path")
		return
	}

	mu.Lock()
	binPath, exists := compiledBins[id]
	mu.Unlock()

	if !exists {
		writeError(w, http.StatusNotFound, fmt.Sprintf("Binary '%s' not found", id))
		return
	}

	body, _ := io.ReadAll(io.LimitReader(r.Body, 64*1024))
	var req ExecuteRequest
	json.Unmarshal(body, &req)

	timeout := req.Timeout
	if timeout <= 0 {
		timeout = 30
	}

	start := time.Now()
	runCmd := exec.Command(binPath, req.Args...)
	runCmd.Env = os.Environ()
	for k, v := range req.Env {
		runCmd.Env = append(runCmd.Env, k+"="+v)
	}

	var stdout, stderr strings.Builder
	runCmd.Stdout = &stdout
	runCmd.Stderr = &stderr

	done := make(chan error, 1)
	go func() { done <- runCmd.Run() }()

	var status string
	var exitCode int

	select {
	case err := <-done:
		if err != nil {
			status = "error"
			if exitErr, ok := err.(*exec.ExitError); ok {
				exitCode = exitErr.ExitCode()
			} else {
				exitCode = 1
			}
		} else {
			status = "success"
		}
	case <-time.After(time.Duration(timeout) * time.Second):
		runCmd.Process.Kill()
		status = "timeout"
		exitCode = -1
	}

	elapsed := time.Since(start).Seconds() * 1000
	resp := ExecuteResponse{
		ID:        uuid.New().String(),
		Status:    status,
		Stdout:    stdout.String(),
		Stderr:    stderr.String(),
		ExitCode:  exitCode,
		Duration:  elapsed,
		Timestamp: time.Now(),
	}
	writeJSON(w, http.StatusOK, resp)
}

// ============================================================
// HELPERS
// ============================================================

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, ErrorResponse{
		Error:   http.StatusText(code),
		Code:    code,
		Message: msg,
	})
}
