/*---------------------------------------------------------------------------------------------
*  Copyright (c) Alessandro Fragnani. All rights reserved.
*  Licensed under the GPLv3 License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { Command, IconPath, MarkdownString, Position, Range, ThemeColor, ThemeIcon, TreeItem, TreeItemCollapsibleState, Uri } from "vscode";
import { getTagStyle, TodoItem } from "../todos/todos";
import { describeGitStatus, GitChange } from "../git/changes";
import { ThemeIcons } from "vscode-ext-codicons";
import { currentIconThemeHasFolderIcon, getProjectIcon, getIconDetailsFromProjectPath } from "../utils/icons";
import * as fs from "fs";
import * as path from "path";
import { REMOTE_PREFIX, VIRTUAL_WORKSPACE_PREFIX } from "../utils/remote";

export interface ProjectPreview {
    name: string;
    path: string;
    detail?: string;
    paths?: string[];
}

export class ProjectNode extends TreeItem {

    constructor(
        public readonly label: string,
        public readonly collapsibleState: TreeItemCollapsibleState,
        public readonly icon: string | undefined,
        public readonly preview: ProjectPreview,
        public readonly command?: Command
    ) {
        super(label, collapsibleState);

        if (icon) {
            this.iconPath = this.getIconPath(icon, preview.path);
            this.contextValue = "ProjectNodeKind";
        } else {
            this.contextValue = "ConfigNodeKind";
        }

        this.resourceUri = Uri.from({
            scheme: 'projectManager-view',
            path: preview.path
        });

        const tooltipIcon = getIconDetailsFromProjectPath(preview.path);
        this.tooltip = new MarkdownString(
            `${label}\n\n_${preview.path}_\n\n${tooltipIcon.icon} ${tooltipIcon.title}`, true);
        this.description = preview.detail;
    }

    private getIconPath(icon: string, projectPath: string): string | IconPath {
        if (currentIconThemeHasFolderIcon()) {
            return getProjectIcon(icon, projectPath);
        } else {
            // if icon is a string that matches the pattern $(icon-name), returns corresponding ThemeIcon
            if (/^\$\([a-z-]+\)$/.test(icon)) {
                return new ThemeIcon(icon.substring(2, icon.length - 1));
            }
            switch (icon) {
                case "Git":
                case "Mercurial":
                    return ThemeIcons.git_merge;

                case "SVN":
                    return ThemeIcons.zap;

                case "VSCode":
                    return ThemeIcons.file_code;

                case "Any":
                    return ThemeIcons.folder;

                case "favorites":
                    return ThemeIcons.folder;

                case "favorites-workspace":
                    return ThemeIcons.root_folder;

                case "favorites-remote":
                    if (projectPath.startsWith(`${REMOTE_PREFIX}://codespaces`)) {
                        return ThemeIcons.github;
                    }
                    if (projectPath.startsWith(`${REMOTE_PREFIX}://dev-container`)) {
                        return new ThemeIcon('symbol-method', new ThemeColor("icon.foreground"));
                    }
                    if (projectPath.startsWith(`${REMOTE_PREFIX}://ssh`)) {
                        return ThemeIcons.terminal;
                    }
                    if (projectPath.startsWith(`${REMOTE_PREFIX}://wsl`)) {
                        return ThemeIcons.terminal_linux;
                    }
                    if (projectPath.startsWith(`${VIRTUAL_WORKSPACE_PREFIX}://`)) {
                        return ThemeIcons.remote;
                    }
                    return ThemeIcons.remote_explorer;

                default:
                    return getProjectIcon(icon, projectPath);
            }
        }
    }

}


export class TagNode extends TreeItem {

    constructor(
        public readonly label: string,
        public readonly collapsibleState: TreeItemCollapsibleState,
    ) {
        super(label, collapsibleState);
        this.iconPath = ThemeIcons.tag;
    }
}

export class NoTagNode extends TagNode {

    constructor(
        label: string,
        public readonly collapsibleState: TreeItemCollapsibleState,
    ) {
        super("", collapsibleState);
        this.description = label;
    }
}

/**
 * A file or folder listed under a project (from the project's `paths`, or the
 * contents of its `.todo` folder, under Quick Access).
 * Clicking a file opens it in the current window, regardless of the current project.
 * Clicking a folder opens it as a project, unless `browsable` is set: browsable
 * folders (those inside `.todo`) expand in place to show their own contents.
 */
export class PathNode extends TreeItem {
    constructor(public readonly label: string, public readonly fullPath: string, public readonly browsable = false) {
        super(label, TreeItemCollapsibleState.None);
        this.contextValue = "PathNodeKind";
        this.tooltip = fullPath;
        this.resourceUri = Uri.file(fullPath);
        let isDirectory = false;
        try {
            isDirectory = fs.statSync(fullPath).isDirectory();
        } catch {
            // missing path: treat as file, `vscode.open` will report the error
        }
        if (isDirectory && browsable) {
            this.collapsibleState = TreeItemCollapsibleState.Collapsed;
            this.contextValue = "QuickAccessFolderKind";
            this.iconPath = ThemeIcons.folder;
        } else if (isDirectory) {
            this.iconPath = ThemeIcons.folder;
            this.command = { command: "_projectManager.openOnClick", title: "", arguments: [ fullPath, path.basename(fullPath), "" ] };
        } else {
            this.iconPath = ThemeIcons.file;
            this.command = { command: "vscode.open", title: "", arguments: [ Uri.file(fullPath) ] };
        }
    }
}

/** URI scheme of the group nodes (TODOs, Quick Access), used to color their titles. */
export const GROUP_URI_SCHEME = "projectManager-group";
export const TODOS_GROUP_COLOR = "projectManager.sideBar.todosGroupForeground";
export const QUICK_ACCESS_GROUP_COLOR = "projectManager.sideBar.quickAccessGroupForeground";
export const GIT_GROUP_COLOR = "projectManager.sideBar.gitGroupForeground";
/** URI scheme of changed-file nodes under GIT, used to show their status letter and color. */
export const GIT_CHANGE_URI_SCHEME = "projectManager-gitChange";

/** The "GIT" node under a project: expands to the files with uncommitted changes. */
export class GitRootNode extends TreeItem {
    constructor(public readonly projectName: string, public readonly roots: string[]) {
        super("GIT", TreeItemCollapsibleState.Collapsed);
        this.id = `git:${projectName}:${roots.join("|")}`;
        this.contextValue = "GitRootNodeKind";
        this.iconPath = new ThemeIcon("source-control", new ThemeColor(GIT_GROUP_COLOR));
        this.resourceUri = Uri.from({ scheme: GROUP_URI_SCHEME, path: "/git", query: this.id });
        this.tooltip = roots.join("\n");
    }
}

/** A changed file under GIT: clicking opens it in the current window. */
export class GitChangeNode extends TreeItem {
    constructor(parentId: string, public readonly change: GitChange, label: string) {
        super(label, TreeItemCollapsibleState.None);
        const info = describeGitStatus(change.status);
        this.id = `${parentId}:${change.file}`;
        this.contextValue = info.deleted ? "GitChangeDeletedNodeKind" : "GitChangeNodeKind";
        this.iconPath = ThemeIcon.File;
        // custom scheme: the file icon still follows the file name; the decoration adds the status letter
        this.resourceUri = Uri.from({ scheme: GIT_CHANGE_URI_SCHEME, path: Uri.file(change.file).path, query: change.status });
        const dir = path.dirname(label);
        this.description = dir === "." ? undefined : dir;
        this.label = path.basename(label);
        this.tooltip = `${change.file}\n${info.label}${change.originalFile ? ` (from ${change.originalFile})` : ""}`;
        if (!info.deleted) {
            this.command = { command: "vscode.open", title: "", arguments: [ Uri.file(change.file) ] };
        }
    }
}

/**
 * The "Quick Access" node under a project: expands to the contents of the
 * project's `.todo` folder (subfolders expand in place).
 */
export class QuickAccessNode extends TreeItem {
    constructor(public readonly projectName: string, public readonly folder: string) {
        super("Quick Access", TreeItemCollapsibleState.Collapsed);
        this.id = `quickAccess:${projectName}:${folder}`;
        this.contextValue = "QuickAccessNodeKind";
        this.iconPath = new ThemeIcon("star-empty", new ThemeColor(QUICK_ACCESS_GROUP_COLOR));
        this.resourceUri = Uri.from({ scheme: GROUP_URI_SCHEME, path: "/quickAccess", query: this.id });
        this.tooltip = folder;
    }
}

/**
 * The "TODOs" node under a project: expands to the files containing TODO tags
 * in the project's folders (root folder, or the folders of a `.code-workspace`).
 */
export class TodoRootNode extends TreeItem {
    constructor(public readonly projectName: string, public readonly roots: string[], count?: number) {
        super("TODOs", TreeItemCollapsibleState.Collapsed);
        this.id = `todos:${projectName}:${roots.join("|")}`;
        this.contextValue = "TodoRootNodeKind";
        this.iconPath = new ThemeIcon("checklist", new ThemeColor(TODOS_GROUP_COLOR));
        this.resourceUri = Uri.from({ scheme: GROUP_URI_SCHEME, path: "/todos", query: this.id });
        this.tooltip = roots.join("\n");
        if (count !== undefined) {
            this.description = `${count}`;
        }
    }
}

/** A file with TODO items, under a project's TODOs node. */
export class TodoFileNode extends TreeItem {
    constructor(public readonly parentId: string, public readonly fullPath: string, label: string, public readonly items: TodoItem[]) {
        super(label, TreeItemCollapsibleState.Collapsed);
        this.id = `${parentId}:${fullPath}`;
        this.contextValue = "TodoFileNodeKind";
        this.resourceUri = Uri.file(fullPath);
        this.iconPath = ThemeIcon.File;
        this.description = `${items.length}`;
        this.tooltip = fullPath;
    }
}

/** A single TODO item: clicking it opens the file at the tag. */
export class TodoItemNode extends TreeItem {
    constructor(parentId: string, public readonly item: TodoItem) {
        super(item.text || item.tag, TreeItemCollapsibleState.None);
        this.id = `${parentId}:${item.line}:${item.column}`;
        this.contextValue = "TodoItemNodeKind";
        const style = getTagStyle(item.tag);
        this.iconPath = new ThemeIcon(style.icon, new ThemeColor(style.color));
        this.description = item.text ? `${item.tag} · line ${item.line + 1}` : `line ${item.line + 1}`;
        this.tooltip = new MarkdownString(`**${item.tag}** ${item.text}\n\n_${item.file}:${item.line + 1}_`);
        const position = new Position(item.line, item.column);
        this.command = {
            command: "vscode.open",
            title: "",
            arguments: [ Uri.file(item.file), { selection: new Range(position, position) } ]
        };
    }
}
