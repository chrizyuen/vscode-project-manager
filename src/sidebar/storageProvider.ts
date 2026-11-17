/*---------------------------------------------------------------------------------------------
*  Copyright (c) Alessandro Fragnani. All rights reserved.
*  Licensed under the GPLv3 License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import * as fs from "fs";
import { execFileSync } from "child_process";
import path = require("path");
import * as vscode from "vscode";
import { Container } from "../core/container";
import { ProjectStorage } from "../storage/storage";
import { PathUtils } from "../utils/path";
import { isRemotePath } from "../utils/remote";
import { sortProjects } from "../utils/sorter";
import { getGitBranch } from "../utils/git";
import { NO_TAGS_DEFINED } from "./constants";
import { NoTagNode, PathNode, ProjectNode, TagNode, TodoFileNode, TodoItemNode, TodoRootNode } from "./nodes";
import { getTodoConfig, todoCache, TodoItem } from "../todos/todos";

export type StorageNode = ProjectNode | TagNode | PathNode | TodoRootNode | TodoFileNode | TodoItemNode | vscode.TreeItem;

const TODO_FOLDER = ".todo";
const IGNORED_TODO_ENTRIES = new Set([ ".DS_Store" ]);
const PLAN_TAG = "@Plan";
const IGNORED_PLAN_ENTRIES = new Set([ ".git", ".DS_Store" ]);

interface ChildPath {
    fullPath: string;
    browsable: boolean;
    plan?: boolean;
}

/**
 * Entries of a folder inside `.todo` (files and subfolders), folders first,
 * then by name. Returns an empty list when the folder is missing or unreadable.
 */
function listTodoEntries(dir: string): ChildPath[] {
    try {
        return fs.readdirSync(dir, { withFileTypes: true })
            .filter(entry => !IGNORED_TODO_ENTRIES.has(entry.name) && (entry.isFile() || entry.isDirectory()))
            .sort((a, b) => (Number(b.isDirectory()) - Number(a.isDirectory())) || a.name.localeCompare(b.name))
            .map(entry => ({ fullPath: path.join(dir, entry.name), browsable: true }));
    } catch {
        return [];
    }
}

/**
 * Subset of `names` (entries of `dir`) that git ignores, honoring every
 * applicable .gitignore, .git/info/exclude and the global excludes file.
 * Returns an empty set when `dir` is not inside a git repository.
 */
function getGitIgnored(dir: string, names: string[]): Set<string> {
    if (names.length === 0) {
        return new Set();
    }
    try {
        const out = execFileSync("git", [ "check-ignore", "-z", "--stdin" ], {
            cwd: dir,
            input: names.join("\0") + "\0",
            encoding: "utf8",
            stdio: [ "pipe", "pipe", "ignore" ]
        });
        return new Set(out.split("\0").filter(n => n.length > 0));
    } catch (error) {
        // exit code 1 = nothing ignored; anything else (not a repo, no git) = no filtering
        const stdout = (error as { stdout?: string }).stdout;
        return new Set(stdout ? stdout.split("\0").filter(n => n.length > 0) : []);
    }
}

/**
 * Entries of a folder under a `@Plan` project (files and subfolders), folders
 * first, then by name, skipping whatever .gitignore excludes.
 */
function listPlanEntries(dir: string): ChildPath[] {
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
            .filter(entry => !IGNORED_PLAN_ENTRIES.has(entry.name) && (entry.isFile() || entry.isDirectory()));
        const ignored = getGitIgnored(dir, entries.map(e => e.name));
        return entries
            .filter(entry => !ignored.has(entry.name))
            .sort((a, b) => (Number(b.isDirectory()) - Number(a.isDirectory())) || a.name.localeCompare(b.name))
            .map(entry => ({ fullPath: path.join(dir, entry.name), browsable: true }));
    } catch {
        return [];
    }
}

/**
 * Removes `//` and block comments and trailing commas from JSONC text,
 * leaving string contents untouched.
 */
function stripJsonComments(text: string): string {
    let out = "";
    let i = 0;
    while (i < text.length) {
        const c = text[ i ];
        if (c === "\"") {
            let j = i + 1;
            while (j < text.length && text[ j ] !== "\"") { j += text[ j ] === "\\" ? 2 : 1; }
            out += text.slice(i, j + 1);
            i = j + 1;
        } else if (c === "/" && text[ i + 1 ] === "/") {
            while (i < text.length && text[ i ] !== "\n") { i++; }
        } else if (c === "/" && text[ i + 1 ] === "*") {
            const end = text.indexOf("*/", i + 2);
            i = end === -1 ? text.length : end + 2;
        } else {
            out += c;
            i++;
        }
    }
    return out.replace(/,(\s*[\]}])/g, "$1");
}

/**
 * Local folders declared in a `.code-workspace` file, as absolute paths.
 * Relative entries resolve against the workspace file's folder. Remote
 * (`uri`) entries and unreadable or invalid files are skipped.
 */
function listWorkspaceFolders(workspaceFile: string): string[] {
    try {
        const json = JSON.parse(stripJsonComments(fs.readFileSync(workspaceFile, "utf8")));
        const baseDir = path.dirname(workspaceFile);
        return (Array.isArray(json?.folders) ? json.folders : [])
            .map((f: { path?: unknown }) => f?.path)
            .filter((p: unknown): p is string => typeof p === "string" && p.length > 0)
            .map((p: string) => path.resolve(baseDir, PathUtils.expandHomePath(p)));
    } catch {
        return [];
    }
}

/**
 * Child paths shown under a project node: the project's configured `paths`,
 * followed by the folders of a `.code-workspace` file, or for other local
 * projects the whole folder tree for `@Plan` projects (respecting .gitignore)
 * or else the contents of `<rootPath>/.todo` (listed by default, no config
 * needed; its subfolders expand in place).
 */
function getProjectChildPaths(projectPath: string, paths?: string[], tags?: string[]): ChildPath[] {
    const rootPath = PathUtils.expandHomePath(projectPath);
    const result: ChildPath[] = (paths ?? []).map(p => ({
        fullPath: path.resolve(rootPath, PathUtils.expandHomePath(p)),
        browsable: false
    }));
    if (path.extname(rootPath) === ".code-workspace") {
        for (const folder of listWorkspaceFolders(rootPath)) {
            if (!result.some(r => r.fullPath === folder)) {
                result.push({ fullPath: folder, browsable: false });
            }
        }
        return result;
    }
    if (isRemotePath(projectPath)) {
        return result;
    }
    const isPlan = (tags ?? []).includes(PLAN_TAG);
    const entries = isPlan ? listPlanEntries(rootPath) : listTodoEntries(path.join(rootPath, TODO_FOLDER));
    for (const entry of entries) {
        if (!result.some(r => r.fullPath === entry.fullPath)) {
            result.push(isPlan ? { ...entry, plan: true } : entry);
        }
    }
    return result;
}

function isDirectory(p: string): boolean {
    try {
        return fs.statSync(p).isDirectory();
    } catch {
        return false;
    }
}

/** Folder inside a `@Plan` project that holds per-project plan folders. */
const PLAN_PROJECTS_FOLDER = "projects";

/**
 * Folders scanned for TODOs for a project: its root folder (or the local
 * folders of a `.code-workspace` file), plus `<plan>/projects/<project name>`
 * in every `@Plan` project. Remote projects only get their plan folders.
 */
function getTodoRoots(projectPath: string, projectName: string, planRoots: string[]): string[] {
    if (!getTodoConfig().enabled) {
        return [];
    }
    const roots: string[] = [];
    if (!isRemotePath(projectPath)) {
        const rootPath = PathUtils.expandHomePath(projectPath);
        roots.push(...(path.extname(rootPath) === ".code-workspace" ? listWorkspaceFolders(rootPath) : [ rootPath ]));
    }
    for (const planRoot of planRoots) {
        roots.push(path.join(planRoot, PLAN_PROJECTS_FOLDER, projectName));
    }
    return [ ...new Set(roots.map(r => path.resolve(r))) ].filter(isDirectory);
}

/** Label prefix for files under `root`: plan folders show their path inside the plan project. */
function getRootLabel(root: string, planRoots: string[]): string {
    for (const planRoot of planRoots) {
        const rel = path.relative(planRoot, root);
        if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
            return path.join(path.basename(planRoot), rel);
        }
    }
    return path.basename(root);
}

/** Groups TODO items by file, labeled relative to their folder. */
function groupTodosByFile(parentId: string, roots: string[], planRoots: string[], items: TodoItem[]): TodoFileNode[] {
    const byFile = new Map<string, TodoItem[]>();
    for (const item of items) {
        const list = byFile.get(item.file) ?? [];
        list.push(item);
        byFile.set(item.file, list);
    }
    const multiRoot = roots.length > 1;
    return [ ...byFile.entries() ]
        .map(([ file, list ]) => {
            const rel = path.relative(list[ 0 ].root, file);
            const label = multiRoot ? path.join(getRootLabel(list[ 0 ].root, planRoots), rel) : rel;
            return new TodoFileNode(parentId, file, label, list.sort((a, b) => a.line - b.line || a.column - b.column));
        })
        .sort((a, b) => (a.label as string).localeCompare(b.label as string));
}

interface ProjectInQuickPick {
    label: string;
    tags?: string[];
    description: string;
    profile: string;
    paths?: string[];
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface ProjectInQuickPickList extends Array<ProjectInQuickPick> { }

export class StorageProvider implements vscode.TreeDataProvider<StorageNode> {

    public readonly onDidChangeTreeData: vscode.Event<StorageNode | void>;

    private projectSource: ProjectStorage;
    private internalOnDidChangeTreeData: vscode.EventEmitter<StorageNode | void> = new vscode.EventEmitter<StorageNode | void>();
    private static readonly TAGS_EXPANSION_STATE_KEY = "projectsExplorerFavorites.tagsExpansionState";

    constructor(projectSource: ProjectStorage) {
        this.projectSource = projectSource;
        this.onDidChangeTreeData = this.internalOnDidChangeTreeData.event;
        todoCache.onDidChange(() => this.refresh());
    }

    private static getTagExpansionState(): Record<string, boolean> {
        return Container.context.globalState.get<Record<string, boolean>>(StorageProvider.TAGS_EXPANSION_STATE_KEY, {});
    }

    public static async resetTagExpansionState(): Promise<void> {
        await Container.context.globalState.update(StorageProvider.TAGS_EXPANSION_STATE_KEY, {});
    }

    public static getTagCollapsibleState(tagId: string, behavior: string): vscode.TreeItemCollapsibleState {
        switch (behavior) {
            case "alwaysExpanded":
                return vscode.TreeItemCollapsibleState.Expanded;
            case "alwaysCollapsed":
                return vscode.TreeItemCollapsibleState.Collapsed;
            case "startExpanded":
            case "startCollapsed": {
                const expansionState = StorageProvider.getTagExpansionState();
                const isExpanded = expansionState[ tagId ];
                if (isExpanded === undefined) {
                    return behavior === "startExpanded" ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
                }
                return isExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
            }
            default:
                return vscode.TreeItemCollapsibleState.Expanded;
        }
    }

    public static async setTagExpanded(tagId: string, expanded: boolean): Promise<void> {
        const expansionState = StorageProvider.getTagExpansionState();
        const newExpansionState = { ...expansionState, [ tagId ]: expanded };
        await Container.context.globalState.update(StorageProvider.TAGS_EXPANSION_STATE_KEY, newExpansionState);
    }

    public refresh(): void {
        this.internalOnDidChangeTreeData.fire();
    }

    public getTreeItem(element: StorageNode): vscode.TreeItem {
        return element;
    }

    /** Local root folders of the enabled `@Plan` projects. */
    private getPlanRoots(): string[] {
        return (<ProjectInQuickPickList>this.projectSource.getProjectsByTag(PLAN_TAG))
            .filter(p => !isRemotePath(p.description))
            .map(p => path.resolve(PathUtils.expandHomePath(p.description)));
    }

    private hasChildren(projectPath: string, projectName: string, paths?: string[], tags?: string[]): boolean {
        return getProjectChildPaths(projectPath, paths, tags).length > 0
            || getTodoRoots(projectPath, projectName, this.getPlanRoots()).length > 0;
    }

    private async getProjectChildren(element: ProjectNode): Promise<StorageNode[]> {
        const nodes: StorageNode[] = getProjectChildPaths(element.preview.path, element.preview.paths, element.preview.tags)
            .map(c => new PathNode(path.basename(c.fullPath), c.fullPath, c.browsable, c.plan));
        const roots = getTodoRoots(element.preview.path, element.preview.name, this.getPlanRoots());
        if (roots.length) {
            const count = roots.every(r => todoCache.isScanned(r)) ? (await todoCache.getAll(roots)).length : undefined;
            nodes.unshift(new TodoRootNode(element.preview.name, roots, count));
        }
        return nodes;
    }

    private async getTodoChildren(element: TodoRootNode | TodoFileNode): Promise<StorageNode[]> {
        if (element instanceof TodoFileNode) {
            return element.items.map(item => new TodoItemNode(element.id as string, item));
        }
        const items = await todoCache.getAll(element.roots);
        if (items.length === 0) {
            const empty = new vscode.TreeItem(vscode.l10n.t("No TODOs found"));
            empty.id = `${element.id}:empty`;
            return [ empty ];
        }
        return groupTodosByFile(element.id as string, element.roots, this.getPlanRoots(), items);
    }

    public getChildren(element?: StorageNode): Thenable<StorageNode[]> {

        if (element instanceof ProjectNode) {
            return this.getProjectChildren(element);
        }
        if (element instanceof TodoRootNode || element instanceof TodoFileNode) {
            return this.getTodoChildren(element);
        }
        if (element instanceof TodoItemNode) {
            return Promise.resolve([]);
        }

        // loop !!!
        return new Promise(resolve => {

            if (element instanceof PathNode) {
                resolve(element.browsable
                    ? (element.plan ? listPlanEntries(element.fullPath) : listTodoEntries(element.fullPath)).map(c => new PathNode(path.basename(c.fullPath), c.fullPath, true, element.plan))
                    : []);
            } else if (element) {

                const nodes: ProjectNode[] = [];

                let projectsMapped = <ProjectInQuickPickList>this.projectSource.getProjectsByTag(element.label as string);

                if (projectsMapped.length === 0) {
                    resolve(nodes);
                }

                projectsMapped = sortProjects(projectsMapped);

                const showGitBranch = vscode.workspace.getConfiguration("projectManager").get<string>("git.showBranchName", "never");

                for (let index = 0; index < projectsMapped.length; index++) {
                    const prj: ProjectInQuickPick = projectsMapped[ index ];

                    let iconFavorites = "favorites";
                    if (path.extname(prj.description) === ".code-workspace") {
                        iconFavorites = "favorites-workspace";
                    } else if (isRemotePath(prj.description)) {
                        iconFavorites = "favorites-remote";
                    }

                    const projectPath = PathUtils.expandHomePath(prj.description);
                    const gitBranch = (showGitBranch === "always" || showGitBranch === "onlyInSideBar") ? getGitBranch(projectPath) : undefined;

                    nodes.push(new ProjectNode(prj.label, this.hasChildren(projectPath, prj.label, prj.paths, prj.tags) ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                        iconFavorites, {
                            name: prj.label,
                            path: projectPath,
                            detail: gitBranch,
                            paths: prj.paths,
                            tags: prj.tags
                        }, {
                            command: "_projectManager.open",
                            title: "",
                            arguments: [ projectPath, prj.label, prj.profile ],
                        }));
                }

                resolve(nodes);

            } else { // ROOT

                // no project saved yet, returns [] `empty`...
                if (this.projectSource.length() === 0) {
                    return resolve([]);
                }

                // choose the view
                const viewAsList = Container.context.globalState.get<boolean>("viewAsList", true);

                // viewAsTags - must have at least one tag otherwise, use `viewAsList`
                if (!viewAsList) {
                    let nodes: TagNode[] = [];

                    const tagsCollapseBehavior = vscode.workspace.getConfiguration("projectManager").get<string>("tags.collapseItems", "startExpanded");
                    const tags = this.projectSource.getAvailableTags().sort();
                    for (const tag of tags) {
                        nodes.push(new TagNode(tag, StorageProvider.getTagCollapsibleState(tag, tagsCollapseBehavior)));
                    }

                    // has any, then OK
                    if (nodes.length > 0) {
                        if (this.projectSource.getProjectsByTag('').length !== 0) {
                            nodes.push(new NoTagNode(NO_TAGS_DEFINED, StorageProvider.getTagCollapsibleState(NO_TAGS_DEFINED, tagsCollapseBehavior)));
                        }

                        // should filter ?
                        const filterByTags = Container.context.globalState.get<string[]>("filterByTags", []);
                        if (filterByTags.length > 0) {
                            nodes = nodes.filter(node => filterByTags.includes(node.label)
                                || (filterByTags.includes(NO_TAGS_DEFINED) && node.label === ""));
                        }

                        resolve(nodes);
                        return;
                    }
                }

                // viewAsList OR no Tags
                // raw list
                const nodes: ProjectNode[] = [];

                let projectsMapped: ProjectInQuickPickList;

                const filterByTags = Container.context.globalState.get<string[]>("filterByTags", []);
                if (filterByTags.length > 0) {
                    projectsMapped = <ProjectInQuickPickList>this.projectSource.getProjectsByTags(filterByTags);
                } else {
                    projectsMapped = <ProjectInQuickPickList>this.projectSource.map();
                }

                projectsMapped = sortProjects(projectsMapped);

                const showGitBranch = vscode.workspace.getConfiguration("projectManager").get<string>("git.showBranchName", "never");

                for (let index = 0; index < projectsMapped.length; index++) {
                    const prj: ProjectInQuickPick = projectsMapped[ index ];

                    let iconFavorites = "favorites";
                    if (path.extname(prj.description) === ".code-workspace") {
                        iconFavorites = "favorites-workspace";
                    } else if (isRemotePath(prj.description)) {
                        iconFavorites = "favorites-remote";
                    }

                    const projectPath = PathUtils.expandHomePath(prj.description);
                    const gitBranch = (showGitBranch === "always" || showGitBranch === "onlyInSideBar") ? getGitBranch(projectPath) : undefined;

                    nodes.push(new ProjectNode(prj.label, this.hasChildren(projectPath, prj.label, prj.paths, prj.tags) ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                        iconFavorites, {
                            name: prj.label,
                            path: projectPath,
                            detail: gitBranch,
                            paths: prj.paths,
                            tags: prj.tags
                        },
                        {
                            command: "_projectManager.open",
                            title: "",
                            arguments: [ projectPath, prj.label, prj.profile ],
                        }));
                }

                resolve(nodes);
            }
        });
    }

}
