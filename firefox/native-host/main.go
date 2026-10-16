package main

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

const maxMessageBytes = 2 * 1024 * 1024

var bridgeHTTPClient = &http.Client{
	Timeout:   10 * time.Second,
	Transport: &http.Transport{Proxy: nil},
	CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

type bridgeState struct {
	Endpoint   string `json:"endpoint"`
	Token      string `json:"token"`
	InstanceID string `json:"instanceId"`
	PID        int    `json:"pid"`
	// A missing timestamp is legacy state; an explicit zero is an inactive startup.
	ClaimedAt *float64 `json:"claimedAt"`
	UpdatedAt string   `json:"updatedAt"`
}

type contextEnvelope struct {
	Version  int             `json:"version"`
	Source   string          `json:"source"`
	Prompt   string          `json:"prompt"`
	Metadata json.RawMessage `json:"metadata"`
}

type response struct {
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
}

func main() {
	reader := bufio.NewReader(os.Stdin)
	writer := bufio.NewWriter(os.Stdout)
	for {
		payload, err := readMessage(reader)
		if errors.Is(err, io.EOF) {
			return
		}
		if err != nil {
			_ = writeMessage(writer, response{Error: err.Error()})
			return
		}

		result := response{OK: true}
		if err := deliverEnvelope(payload); err != nil {
			result = response{Error: err.Error()}
		}
		if err := writeMessage(writer, result); err != nil {
			return
		}
	}
}

func readMessage(reader io.Reader) ([]byte, error) {
	var header [4]byte
	if _, err := io.ReadFull(reader, header[:]); err != nil {
		return nil, err
	}
	length := binary.LittleEndian.Uint32(header[:])
	if length > maxMessageBytes {
		return nil, fmt.Errorf("message is too large")
	}
	payload := make([]byte, length)
	if _, err := io.ReadFull(reader, payload); err != nil {
		return nil, fmt.Errorf("failed to read message: %w", err)
	}
	return payload, nil
}

func writeMessage(writer *bufio.Writer, value response) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	var header [4]byte
	binary.LittleEndian.PutUint32(header[:], uint32(len(payload)))
	if _, err := writer.Write(header[:]); err != nil {
		return err
	}
	if _, err := writer.Write(payload); err != nil {
		return err
	}
	return writer.Flush()
}

func deliverEnvelope(payload []byte) error {
	if len(payload) > maxMessageBytes {
		return fmt.Errorf("context envelope is too large")
	}
	var envelope contextEnvelope
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return fmt.Errorf("invalid context envelope: %w", err)
	}
	if err := validateEnvelope(envelope); err != nil {
		return err
	}

	state, err := resolveBridgeState()
	if err != nil {
		return err
	}

	req, err := http.NewRequest(http.MethodPost, state.Endpoint+"/context", bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("failed to create OMP bridge request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+state.Token)
	req.Header.Set("X-OMP-Instance-Id", state.InstanceID)
	res, err := bridgeHTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to reach OMP bridge: %w", err)
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, res.Body)
	if res.StatusCode < http.StatusOK || res.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("OMP bridge returned %d", res.StatusCode)
	}
	return nil
}

func validateEnvelope(envelope contextEnvelope) error {
	if envelope.Version != 1 || (envelope.Source != "vscode" && envelope.Source != "firefox" && envelope.Source != "ptyxis") || envelope.Prompt == "" {
		return fmt.Errorf("expected a version 1 context envelope")
	}
	if len(envelope.Metadata) == 0 {
		return nil
	}
	if string(envelope.Metadata) == "null" {
		return fmt.Errorf("expected object metadata")
	}
	var metadata map[string]interface{}
	if err := json.Unmarshal(envelope.Metadata, &metadata); err != nil || metadata == nil {
		return fmt.Errorf("expected object metadata")
	}
	if value, ok := metadata["url"]; ok {
		if _, ok := value.(string); !ok {
			return fmt.Errorf("expected string metadata URL")
		}
	}
	if value, ok := metadata["title"]; ok {
		if _, ok := value.(string); !ok {
			return fmt.Errorf("expected string metadata title")
		}
	}
	return nil
}
