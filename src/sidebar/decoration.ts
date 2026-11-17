/*---------------------------------------------------------------------------------------------
*  Copyright (c) Alessandro Fragnani. All rights reserved.
*  Licensed under the GPLv3 License. See License.md in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { ThemeColor, window } from 'vscode';
import { Container } from '../core/container';
import { GIT_CHANGE_URI_SCHEME, GIT_GROUP_COLOR, GROUP_URI_SCHEME, QUICK_ACCESS_GROUP_COLOR, TODOS_GROUP_COLOR } from './nodes';
import { describeGitStatus } from '../git/changes';

const GROUP_COLORS: Record<string, string> = {
    '/todos': TODOS_GROUP_COLOR,
    '/quickAccess': QUICK_ACCESS_GROUP_COLOR,
    '/git': GIT_GROUP_COLOR
};

export function registerSideBarDecorations() {
    window.registerFileDecorationProvider({
        provideFileDecoration: (uri) => {
            if (uri.scheme === GROUP_URI_SCHEME) {
                const color = GROUP_COLORS[ uri.path ];
                return color ? { color: new ThemeColor(color) } : undefined;
            }
            if (uri.scheme === GIT_CHANGE_URI_SCHEME) {
                const info = describeGitStatus(uri.query);
                return { badge: info.letter, tooltip: info.label, color: new ThemeColor(info.color) };
            }
            if (uri.scheme !== 'projectManager-view') return undefined;

            if (Container.currentProject && uri.path === Container.currentProject.rootPath) {
                return {
                    badge: '✔',
                    color: new ThemeColor('projectManager.sideBar.currentProjectHighlightForeground')
                };
            }
        }
    });
}
