#!/usr/bin/env node
/**
 * Merge Wispr Flow (or any) narration audio onto the site walkthrough WebM.
 *
 * Usage:
 *   pnpm tutorial:merge-voiceover -- docs/tutorials/videos/narration.m4a
 *   pnpm tutorial:merge-voiceover -- narration.wav docs/tutorials/videos/site-walkthrough-vo.webm
 */
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2).filter((a) => a !== '--');
const audioPath = args[0];
const outPath =
  args[1] ||
  join(ROOT, 'docs/tutorials/videos/site-walkthrough-with-voiceover.webm');
const videoPath = join(ROOT, 'docs/tutorials/videos/site-walkthrough-demo.webm');
const publicOut = join(ROOT, 'apps/cloud/public/tutorials/site-walkthrough-with-voiceover.webm');

if (!audioPath || !existsSync(audioPath)) {
  console.error('Usage: pnpm tutorial:merge-voiceover -- <narration-audio> [output.webm]');
  process.exit(1);
}
if (!existsSync(videoPath)) {
  console.error(`Missing screen recording: ${videoPath}`);
  console.error('Run: pnpm tutorial:record-site');
  process.exit(1);
}

const ff = spawnSync(
  'ffmpeg',
  [
    '-y',
    '-i',
    videoPath,
    '-i',
    audioPath,
    '-c:v',
    'copy',
    '-c:a',
    'libopus',
    '-b:a',
    '128k',
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-shortest',
    outPath,
  ],
  { stdio: 'inherit' },
);

if (ff.status !== 0) {
  console.error('ffmpeg failed — install ffmpeg and retry');
  process.exit(ff.status ?? 1);
}

spawnSync('cp', [outPath, publicOut], { stdio: 'inherit' });
console.log(`Saved: ${outPath}`);
console.log(`Copied: ${publicOut}`);
