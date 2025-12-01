// Chat logging service for quality control and model refinement
// Creates daily JSON log files with all chat interactions

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export interface ChatLogMetadata {
  responseTimeMs: number;
  llmProvider: string;
  model: string;
  queryComplexity: string;
  topK: number;
  contextChunksUsed: number;
}

export interface ChatLogEntry {
  timestamp: string;
  sessionId: string;
  question: string;
  response: string;
  metadata: ChatLogMetadata;
}

const LOG_DIR = join(process.cwd(), 'server', 'chat-logs');

/**
 * Get the log file path for a given date
 * Format: chat-logs/YYYY-MM-DD.json
 */
function getLogFilePath(date: Date = new Date()): string {
  const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
  return join(LOG_DIR, `${dateStr}.json`);
}

/**
 * Ensure the log directory exists
 */
function ensureLogDir(): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
    console.log(`📁 Created chat log directory: ${LOG_DIR}`);
  }
}

/**
 * Read existing log entries for today (or create empty array)
 */
function readTodaysLog(): ChatLogEntry[] {
  const logPath = getLogFilePath();

  if (!existsSync(logPath)) {
    return [];
  }

  try {
    const content = readFileSync(logPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Error reading log file, starting fresh:', error);
    return [];
  }
}

/**
 * Write log entries to today's file
 */
function writeTodaysLog(entries: ChatLogEntry[]): void {
  const logPath = getLogFilePath();
  writeFileSync(logPath, JSON.stringify(entries, null, 2), 'utf-8');
}

/**
 * Log a chat interaction
 */
export function logChatInteraction(entry: ChatLogEntry): void {
  try {
    ensureLogDir();
    const entries = readTodaysLog();
    entries.push(entry);
    writeTodaysLog(entries);
  } catch (error) {
    // Log errors should not break the chat functionality
    console.error('Failed to log chat interaction:', error);
  }
}

/**
 * Generate a simple session ID based on timestamp and random string
 */
export function generateSessionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`;
}

/**
 * Map TOP_K values to complexity labels
 */
export function topKToComplexity(topK: number): string {
  if (topK <= 10) return 'simple';
  if (topK <= 30) return 'medium';
  if (topK <= 80) return 'complex';
  return 'comprehensive';
}
