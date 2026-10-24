#!/usr/bin/env bun
/**
 * `bun run setup`: asks a few questions and writes overhand.config.json on a first run, then checks everything Overhand
 * needs (run it again any time something breaks). The checks load only inside startOrExplain, so a broken config is
 * one plain line.
 */
import { startOrExplain } from "./config";

await startOrExplain(async () => (await import("./setup")).runSetup());
