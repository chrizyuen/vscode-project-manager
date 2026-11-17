/*---------------------------------------------------------------------------------------------
*  Copyright (c) Alessandro Fragnani. All rights reserved.
*  Licensed under the GPLv3 License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

/*
 * TODO scanning, modeled on the Todo Tree extension (Gruntfuggly.todo-tree):
 * search project folders for comment tags (TODO, FIXME, ...) with ripgrep,
 * honoring .gitignore, and fall back to a Node scan when ripgrep is missing.
 */

import { execFile, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

export interface TodoItem {
    /** Absolute file path */
    file: string;
    /** Project folder the file was found under */
    root: string;
    /** Zero-based line and column of the tag */
    line: number;
    column: number;
    tag: string;
    /** Text after the tag, cleaned of separators and comment terminators */
    text: string;
}

export interface TodoConfig {
    enabled: boolean;
    tags: string[];
    regex: string;
    caseSensitive: boolean;
    includeGlobs: string[];
    excludeGlobs: string[];
    maxResults: number;
    highlight: boolean;
}

export const DEFAULT_TAGS = [ "TODO", "FIXME", "BUG", "HACK", "XXX", "[ ]", "[x]" ];
export const DEFAULT_REGEX = "(//|#|<!--|;|/\\*|^|^[ \\t]*(-|\\d+.))\\s*($TAGS)";

export function getTodoConfig(): TodoConfig {
    const cfg = vscode.workspace.getConfiguration("projectManager.todos");
    const tags = cfg.get<string[]>("tags", DEFAULT_TAGS).filter(t => typeof t === "string" && t.length > 0);
    return {
        enabled: cfg.get<boolean>("enabled", true),
        tags: tags.length ? tags : DEFAULT_TAGS,
        regex: cfg.get<string>("regex", DEFAULT_REGEX) || DEFAULT_REGEX,
        caseSensitive: cfg.get<boolean>("caseSensitive", true),
        includeGlobs: cfg.get<string[]>("includeGlobs", []),
        excludeGlobs: cfg.get<string[]>("excludeGlobs", []),
        maxResults: Math.max(1, cfg.get<number>("maxResults", 5000)),
        highlight: cfg.get<boolean>("highlight", true)
    };
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The search regex with `$TAGS` replaced by the configured tags. */
export function buildPattern(config: TodoConfig): string {
    const tags = config.tags.map(escapeRegex).join("|");
    return config.regex.split("$TAGS").join(tags);
}

export function buildJsRegex(config: TodoConfig): RegExp | undefined {
    try {
        return new RegExp(buildPattern(config), config.caseSensitive ? "gm" : "gim");
    } catch {
        return undefined;
    }
}

/** Identifies which tag a match is for and extracts the text that follows it. */
function toItem(config: TodoConfig, file: string, root: string, line: number, lineText: string, matchStart: number, matchText: string): TodoItem | undefined {
    const flags = config.caseSensitive ? "" : "i";
    let best: { tag: string; index: number } | undefined;
    for (const tag of config.tags) {
        const m = new RegExp(escapeRegex(tag), flags).exec(matchText);
        if (m && (!best || m.index < best.index || (m.index === best.index && tag.length > best.tag.length))) {
            best = { tag, index: m.index };
        }
    }
    if (!best) {
        return undefined;
    }
    const tagStart = matchStart + best.index;
    const after = lineText.substring(matchStart + matchText.length)
        .replace(/\s*(\*\/|-->|#>|%>|\}\})\s*$/, "")
        .replace(/^\s*[:\-–—]?\s*/, "")
        .trim();
    return {
        file,
        root,
        line,
        column: tagStart,
        tag: best.tag,
        text: after.length > 200 ? after.substring(0, 200) + "…" : after
    };
}

let ripgrepPath: string | null | undefined;

/** Finds the ripgrep binary that ships with VS Code / Kiro. */
export function findRipgrep(): string | undefined {
    if (ripgrepPath !== undefined) {
        return ripgrepPath ?? undefined;
    }
    const exe = process.platform === "win32" ? "rg.exe" : "rg";
    const appRoot = vscode.env.appRoot;
    const platformDir = `${process.platform}-${process.arch}`;
    const candidates = [
        path.join(appRoot, "node_modules", "@vscode", "ripgrep", "bin", exe),
        path.join(appRoot, "node_modules.asar.unpacked", "@vscode", "ripgrep", "bin", exe),
        path.join(appRoot, "node_modules", "vscode-ripgrep", "bin", exe),
        path.join(appRoot, "node_modules.asar.unpacked", "vscode-ripgrep", "bin", exe),
        path.join(appRoot, "node_modules", "@vscode", "ripgrep-universal", "bin", platformDir, exe),
        path.join(appRoot, "node_modules.asar.unpacked", "@vscode", "ripgrep-universal", "bin", platformDir, exe)
    ];
    ripgrepPath = candidates.find(c => fs.existsSync(c)) ?? null;
    return ripgrepPath ?? undefined;
}

interface RgMatch {
    type: string;
    data: {
        path?: { text?: string };
        lines?: { text?: string };
        line_number?: number;
        submatches?: Array<{ match: { text?: string }; start: number }>;
    };
}

function scanWithRipgrep(rg: string, root: string, config: TodoConfig, token: { cancelled: boolean }): Promise<TodoItem[]> {
    return new Promise(resolve => {
        const args = [ "--json", "--no-messages", "--max-columns", "1000", "--max-filesize", "1M" ];
        if (!config.caseSensitive) {
            args.push("--ignore-case");
        }
        for (const g of config.includeGlobs) {
            args.push("--glob", g);
        }
        for (const g of config.excludeGlobs) {
            args.push("--glob", `!${g}`);
        }
        args.push("--regexp", buildPattern(config), "--", ".");

        const items: TodoItem[] = [];
        let buffer = "";
        const child = spawn(rg, args, { cwd: root });
        const finish = () => resolve(items);

        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
            buffer += chunk;
            let nl: number;
            while ((nl = buffer.indexOf("\n")) >= 0) {
                const line = buffer.substring(0, nl);
                buffer = buffer.substring(nl + 1);
                let msg: RgMatch;
                try {
                    msg = JSON.parse(line);
                } catch {
                    continue;
                }
                if (msg.type !== "match" || !msg.data.path?.text || msg.data.lines?.text === undefined) {
                    continue;
                }
                const file = path.resolve(root, msg.data.path.text);
                const lineText = msg.data.lines.text.replace(/\r?\n$/, "");
                for (const sub of msg.data.submatches ?? []) {
                    const item = toItem(config, file, root, (msg.data.line_number ?? 1) - 1, lineText,
                        Buffer.from(lineText, "utf8").subarray(0, sub.start).toString("utf8").length, sub.match.text ?? "");
                    if (item) {
                        items.push(item);
                    }
                }
                if (items.length >= config.maxResults || token.cancelled) {
                    child.kill();
                    return;
                }
            }
        });
        child.on("error", finish);
        child.on("close", finish);
    });
}

const FALLBACK_SKIP_DIRS = new Set([ ".git", "node_modules", ".hg", ".svn" ]);
const FALLBACK_MAX_FILES = 10000;

function listFilesFallback(root: string): Promise<string[]> {
    return new Promise(resolve => {
        execFile("git", [ "ls-files", "-z", "--cached", "--others", "--exclude-standard" ],
            { cwd: root, maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
                if (!error) {
                    return resolve(stdout.split("\0").filter(f => f.length > 0).map(f => path.join(root, f)));
                }
                // not a git repo: walk the folder, skipping well-known heavy folders
                const files: string[] = [];
                const walk = (dir: string) => {
                    let entries: fs.Dirent[];
                    try {
                        entries = fs.readdirSync(dir, { withFileTypes: true });
                    } catch {
                        return;
                    }
                    for (const entry of entries) {
                        if (files.length >= FALLBACK_MAX_FILES) {
                            return;
                        }
                        const full = path.join(dir, entry.name);
                        if (entry.isDirectory() && !FALLBACK_SKIP_DIRS.has(entry.name)) {
                            walk(full);
                        } else if (entry.isFile()) {
                            files.push(full);
                        }
                    }
                };
                walk(root);
                resolve(files);
            });
    });
}

async function scanWithNode(root: string, config: TodoConfig, token: { cancelled: boolean }): Promise<TodoItem[]> {
    const regex = buildJsRegex(config);
    if (!regex) {
        return [];
    }
    const { minimatch } = await import("minimatch");
    const items: TodoItem[] = [];
    for (const file of await listFilesFallback(root)) {
        if (token.cancelled || items.length >= config.maxResults) {
            break;
        }
        const rel = path.relative(root, file).split(path.sep).join("/");
        if (config.includeGlobs.length && !config.includeGlobs.some(g => minimatch(rel, g, { dot: true, matchBase: true }))) {
            continue;
        }
        if (config.excludeGlobs.some(g => minimatch(rel, g, { dot: true, matchBase: true }))) {
            continue;
        }
        let content: string;
        try {
            const stat = fs.statSync(file);
            if (stat.size > 1024 * 1024) {
                continue;
            }
            const buf = fs.readFileSync(file);
            if (buf.subarray(0, 8000).includes(0)) {
                continue; // binary
            }
            content = buf.toString("utf8");
        } catch {
            continue;
        }
        items.push(...findTodosInText(content, config, regex, file, root));
    }
    return items.slice(0, config.maxResults);
}

/** Finds TODO items in a document's text (also used for editor highlighting). */
export function findTodosInText(content: string, config: TodoConfig, regex: RegExp, file = "", root = ""): TodoItem[] {
    const items: TodoItem[] = [];
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const lineText = lines[ i ];
        regex.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = regex.exec(lineText)) !== null) {
            if (m[ 0 ].length === 0) {
                regex.lastIndex++;
                continue;
            }
            const item = toItem(config, file, root, i, lineText, m.index, m[ 0 ]);
            if (item) {
                items.push(item);
            }
        }
    }
    return items;
}

/** Scans one folder, preferring ripgrep. */
export function scanFolder(root: string, config: TodoConfig, token: { cancelled: boolean } = { cancelled: false }): Promise<TodoItem[]> {
    const rg = findRipgrep();
    return rg ? scanWithRipgrep(rg, root, config, token) : scanWithNode(root, config, token);
}

/**
 * Caches TODO scan results per project folder. Scans run on demand (when a
 * project's TODOs node is expanded) and are invalidated when files change.
 */
export class TodoCache {
    private results = new Map<string, Promise<TodoItem[]>>();
    private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
    public readonly onDidChange = this.onDidChangeEmitter.event;

    public get(root: string): Promise<TodoItem[]> {
        let result = this.results.get(root);
        if (!result) {
            result = scanFolder(root, getTodoConfig());
            this.results.set(root, result);
        }
        return result;
    }

    public async getAll(roots: string[]): Promise<TodoItem[]> {
        const all = await Promise.all(roots.map(r => this.get(r)));
        return all.flat();
    }

    /** Whether `root` has a scan cached or in progress. */
    public isScanned(root: string): boolean {
        return this.results.has(root);
    }

    public clear(): void {
        this.results.clear();
        this.onDidChangeEmitter.fire();
    }

    /** Drops cached results for every scanned folder containing `file`. */
    public invalidateFile(file: string): void {
        let changed = false;
        for (const root of [ ...this.results.keys() ]) {
            const rel = path.relative(root, file);
            if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
                this.results.delete(root);
                changed = true;
            }
        }
        if (changed) {
            this.onDidChangeEmitter.fire();
        }
    }
}

export const todoCache = new TodoCache();

export interface TagStyle {
    icon: string;
    color: string;
    background: string;
}

const TAG_STYLES: Record<string, TagStyle> = {
    TODO: { icon: "check", color: "charts.green", background: "rgba(0, 200, 0, 0.25)" },
    FIXME: { icon: "flame", color: "charts.red", background: "rgba(255, 0, 0, 0.25)" },
    BUG: { icon: "bug", color: "charts.red", background: "rgba(255, 0, 0, 0.25)" },
    HACK: { icon: "tools", color: "charts.orange", background: "rgba(255, 140, 0, 0.25)" },
    XXX: { icon: "warning", color: "charts.yellow", background: "rgba(255, 220, 0, 0.25)" },
    "[ ]": { icon: "circle-large-outline", color: "charts.blue", background: "rgba(0, 120, 255, 0.25)" },
    "[X]": { icon: "pass-filled", color: "charts.green", background: "rgba(0, 200, 0, 0.15)" }
};

const DEFAULT_TAG_STYLE: TagStyle = { icon: "pass", color: "charts.blue", background: "rgba(0, 120, 255, 0.25)" };

export function getTagStyle(tag: string): TagStyle {
    return TAG_STYLES[ tag.toUpperCase() ] ?? DEFAULT_TAG_STYLE;
}
