/*---------------------------------------------------------------------------------------------
*  Copyright (c) Alessandro Fragnani. All rights reserved.
*  Licensed under the GPLv3 License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { buildJsRegex, findTodosInText, getTagStyle, getTodoConfig } from "./todos";

/**
 * Highlights TODO tags in visible editors, like Todo Tree does:
 * the tag gets a colored background, and the overview ruler gets a mark.
 */
export function registerTodoHighlight(context: vscode.ExtensionContext): void {
    let decorations = new Map<string, vscode.TextEditorDecorationType>();
    let timer: NodeJS.Timeout | undefined;

    const disposeDecorations = () => {
        for (const d of decorations.values()) {
            d.dispose();
        }
        decorations = new Map();
    };

    const decorationFor = (tag: string): vscode.TextEditorDecorationType => {
        let d = decorations.get(tag);
        if (!d) {
            const style = getTagStyle(tag);
            d = vscode.window.createTextEditorDecorationType({
                backgroundColor: style.background,
                fontWeight: "bold",
                borderRadius: "2px",
                overviewRulerColor: new vscode.ThemeColor(style.color),
                overviewRulerLane: vscode.OverviewRulerLane.Right
            });
            decorations.set(tag, d);
        }
        return d;
    };

    const update = (editor: vscode.TextEditor) => {
        const config = getTodoConfig();
        const regex = config.enabled && config.highlight ? buildJsRegex(config) : undefined;
        const ranges = new Map<string, vscode.Range[]>();
        if (regex) {
            for (const item of findTodosInText(editor.document.getText(), config, regex)) {
                const list = ranges.get(item.tag) ?? [];
                list.push(new vscode.Range(item.line, item.column, item.line, item.column + item.tag.length));
                ranges.set(item.tag, list);
            }
            for (const tag of config.tags) {
                if (!ranges.has(tag)) {
                    ranges.set(tag, []);
                }
            }
        }
        for (const [ tag, list ] of ranges) {
            editor.setDecorations(decorationFor(tag), list);
        }
        for (const [ tag, d ] of decorations) {
            if (!ranges.has(tag)) {
                editor.setDecorations(d, []);
            }
        }
    };

    const updateVisible = () => {
        for (const editor of vscode.window.visibleTextEditors) {
            update(editor);
        }
    };

    const schedule = () => {
        if (timer) {
            clearTimeout(timer);
        }
        timer = setTimeout(updateVisible, 300);
    };

    context.subscriptions.push(
        vscode.window.onDidChangeVisibleTextEditors(schedule),
        vscode.workspace.onDidChangeTextDocument(e => {
            if (vscode.window.visibleTextEditors.some(ed => ed.document === e.document)) {
                schedule();
            }
        }),
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration("projectManager.todos")) {
                disposeDecorations();
                updateVisible();
            }
        }),
        { dispose: () => { disposeDecorations(); if (timer) { clearTimeout(timer); } } }
    );
    updateVisible();
}
