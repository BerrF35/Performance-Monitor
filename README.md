# Performance Monitor

A real-time Windows desktop system monitoring dashboard built with Electron, React, TypeScript, Tailwind CSS, Zustand, and Recharts.

## Features

- CPU, GPU, RAM, storage, network, power, thermal, and system health tracking
- Live charts and 60-point rolling trend histories
- Process-level summaries
- Snapshot-driven renderer model with raw collector values and display-ready fields
- Modular data layer for Windows OS metrics with fallback and estimated values where hardware telemetry is unavailable

## Stack

- Electron
- React + TypeScript
- Tailwind CSS
- Zustand
- Recharts

## Commands

```bash
npm install
npm run dev
npm run typecheck
npm run build
```

## Data Layer

The Electron main process exposes a typed `PerformanceSnapshot` over IPC. Renderer components consume `snapshot.display` only.

Windows collectors use native OS surfaces where available:

- CPU, memory, process, disk, network, and system info: Node `os`, PowerShell, WMI/CIM, and Windows performance counters
- GPU: `nvidia-smi` first, GPU performance counters and WMI as fallback
- Battery and power: WMI battery classes with estimated platform power when package telemetry is unavailable
- Storage health: `Get-PhysicalDisk` and `Get-StorageReliabilityCounter` when exposed
- Fans and sensors: OpenHardwareMonitor or LibreHardwareMonitor WMI namespaces when present, with clean fallbacks

Unavailable hardware or vendor telemetry stays behind adapter interfaces and falls back to sensible seeded values so the dashboard remains readable.

## Status

In active development.
