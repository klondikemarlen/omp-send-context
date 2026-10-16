package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const (
	discoveryTimeout = 1500 * time.Millisecond
	healthTimeout    = 500 * time.Millisecond
)

func resolveBridgeState() (bridgeState, error) {
	statePath := os.Getenv("OMP_CONTEXT_STATE_FILE")
	if statePath == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return bridgeState{}, fmt.Errorf("failed to find home directory: %w", err)
		}
		statePath = filepath.Join(home, ".omp", "agent", "editor-context-bridge.json")
	}
	ctx, cancel := context.WithTimeout(context.Background(), discoveryTimeout)
	defer cancel()

	var pointer *bridgeState
	var candidates []*bridgeState
	readDone := make(chan struct{})
	go func() {
		pointer, _ = readState(statePath)
		candidates = readRegistry(statePath + ".d")
		close(readDone)
	}()
	select {
	case <-ctx.Done():
		return bridgeState{}, fmt.Errorf("OMP bridge discovery timed out")
	case <-readDone:
	}

	pointerRegistered := false
	if pointer != nil {
		for _, state := range candidates {
			if state.InstanceID == pointer.InstanceID {
				pointerRegistered = true
				break
			}
		}
	}
	var legacyPointer *bridgeState
	if pointer != nil && !pointerRegistered {
		legacyPointer = pointer
		candidates = append(candidates, pointer)
	}
	legacyActivity := activityOf(legacyPointer)
	if legacyPointer != nil && legacyPointer.ClaimedAt == nil {
		if parsed, err := time.Parse(time.RFC3339Nano, legacyPointer.UpdatedAt); err == nil {
			legacyActivity = float64(parsed.UnixMilli())
		}
	}
	activity := func(state *bridgeState) float64 {
		if state == legacyPointer {
			return legacyActivity
		}
		return activityOf(state)
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		left, right := candidates[i], candidates[j]
		leftActivity, rightActivity := activity(left), activity(right)
		if leftActivity != rightActivity {
			return leftActivity > rightActivity
		}
		return pointer != nil && left.InstanceID == pointer.InstanceID && right.InstanceID != pointer.InstanceID
	})
	for _, state := range candidates {
		if ctx.Err() != nil {
			break
		}
		endpoint, err := parseBridgeEndpoint(state.Endpoint)
		if err != nil || processDefinitelyGone(state.PID) {
			continue
		}
		probeCtx, probeCancel := context.WithTimeout(ctx, healthTimeout)
		result := probeBridge(probeCtx, endpoint, state.InstanceID)
		probeCancel()
		switch result {
		case probeHealthy:
			state.Endpoint = endpoint
			return *state, nil
		case probeGone:
			continue
		default:
			return bridgeState{}, fmt.Errorf("latest OMP bridge could not be verified")
		}
	}
	return bridgeState{}, fmt.Errorf("failed to find a live OMP bridge")
}

func readRegistry(directory string) []*bridgeState {
	entries, err := os.ReadDir(directory)
	if err != nil {
		return nil
	}
	states := make([]*bridgeState, 0, len(entries))
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".json") {
			continue
		}
		state, err := readState(filepath.Join(directory, name))
		if err != nil || state.InstanceID != strings.TrimSuffix(name, ".json") {
			continue
		}
		states = append(states, state)
	}
	return states
}

func readState(path string) (*bridgeState, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	state := &bridgeState{}
	if json.Unmarshal(content, state) != nil || state.Endpoint == "" || state.Token == "" || strings.ContainsAny(state.Token, "\r\n") || state.InstanceID == "" {
		return nil, fmt.Errorf("invalid OMP bridge state")
	}
	return state, nil
}

func activityOf(state *bridgeState) float64 {
	if state == nil || state.ClaimedAt == nil {
		return 0
	}
	return *state.ClaimedAt
}

func processDefinitelyGone(pid int) bool {
	if pid <= 0 {
		return false
	}
	err := syscall.Kill(pid, 0)
	return errors.Is(err, syscall.ESRCH)
}

type probeResult int

const (
	probeAmbiguous probeResult = iota
	probeHealthy
	probeGone
)

func probeBridge(ctx context.Context, endpoint, expectedInstanceID string) probeResult {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+"/health", nil)
	if err != nil {
		return probeAmbiguous
	}
	response, err := bridgeHTTPClient.Do(request)
	if err != nil {
		if errors.Is(err, syscall.ECONNREFUSED) {
			return probeGone
		}
		return probeAmbiguous
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return probeGone
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return probeAmbiguous
	}
	var health struct {
		InstanceID string `json:"instanceId"`
	}
	if json.NewDecoder(response.Body).Decode(&health) != nil {
		return probeAmbiguous
	}
	if health.InstanceID != expectedInstanceID {
		return probeGone
	}
	return probeHealthy
}

func parseBridgeEndpoint(raw string) (string, error) {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "http" || parsed.Hostname() != "127.0.0.1" || parsed.User != nil || (parsed.Path != "" && parsed.Path != "/") || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", fmt.Errorf("invalid OMP bridge state")
	}
	port, err := strconv.Atoi(parsed.Port())
	if err != nil || port < 1 || port > 65535 {
		return "", fmt.Errorf("invalid OMP bridge state")
	}
	return "http://127.0.0.1:" + strconv.Itoa(port), nil
}
