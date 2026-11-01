# Figger

A design tool in one HTML file: frames, auto layout, components, vectors, prototypes. Your files stay on your disk.

**Status: scaffold only. Nothing is built yet.** Name chosen 2026-11-02. v1 scope is layers 1 and 2 (see `plan/pending.md`).

## Install

TODO. Planned: open `figger.html` from disk or from figger.naklitechie.com. No build step for users, no account, no server.

## Why

Chirag asked for a Figma-style editor built the NakliTechie way, studying the Rust project
[storytold/figcraft](https://github.com/storytold/figcraft) (MIT OR Apache-2.0, 342,526 lines of Rust, desktop plus a 10 MB WebAssembly build).
Figger keeps FigCraft's architecture (document model, one command registry for every action, layout as a pure function) and replaces its Rust renderer, text shaper and egui UI with what a browser already provides.

## Context

Study of FigCraft: `plan/research/figcraft-study.md`. Plan: `plan/`.

## License

TBD (FigCraft is MIT OR Apache-2.0; ported ideas and code need attribution in `NOTICE`).
