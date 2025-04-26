import * as vscode from "vscode";
import { Author, runCommand, ShadowWorkspace } from "./shadow_workspace";
import path from "path";

// Decorations when AI-code-attribution is enabled
const HumanWrittenCodeDecorationType = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: "rgba(46, 204, 113, 0.1)",
    gutterIconPath: vscode.Uri.file("/Users/yuri/Downloads/icons8-bust-in-silhouette-96.png"),
    gutterIconSize: "16px",
});
const AiWrittenCodeDecorationType = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: "rgba(30, 144, 255, 0.1)",
    gutterIconPath: vscode.Uri.file("/Users/yuri/Downloads/icons8-robot-emoji-94.png"),
    gutterIconSize: "16px",
});

type Note = Record<string, number[]>;
const NOTES_CACHE: Record<string, Note | null> = {};
let AI_CODE_ATTTRIBUTION_ENABLED = false;
let TIMEOUT: NodeJS.Timeout | undefined = undefined;

export function setupAiCodeAttribution(workspacePath: string, shadowPath: string, context: vscode.ExtensionContext) {
    let activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
        return;
    }

    function triggerUpdateAiCodeAttribution(throttle: boolean) {
        if (!AI_CODE_ATTTRIBUTION_ENABLED) {
            if (activeEditor) {
                activeEditor.setDecorations(HumanWrittenCodeDecorationType, []);
                activeEditor.setDecorations(AiWrittenCodeDecorationType, []);
            }
            return;
        }

        if (TIMEOUT) {
            clearTimeout(TIMEOUT);
            TIMEOUT = undefined;
        }

        if (throttle) {
            TIMEOUT = setTimeout(() => updateDecorations(activeEditor, workspacePath, shadowPath), 500);
        } else {
            updateDecorations(activeEditor, workspacePath, shadowPath);
        }
    }

    vscode.window.onDidChangeActiveTextEditor(editor => {
        activeEditor = editor;
        if (editor) {
            triggerUpdateAiCodeAttribution(false);
        }
    }, null, context.subscriptions);

    vscode.workspace.onDidChangeTextDocument(event => {
        if (activeEditor && event.document === activeEditor.document) {
            triggerUpdateAiCodeAttribution(true);
        }
    }, null, context.subscriptions);

    context.subscriptions.push(
        vscode.commands.registerCommand("cline.toggleAiCodeAttribution", async() => {
            AI_CODE_ATTTRIBUTION_ENABLED = !AI_CODE_ATTTRIBUTION_ENABLED;
            triggerUpdateAiCodeAttribution(false);
        }),
    )
    context.subscriptions.push(
        vscode.commands.registerCommand("cline.refreshAiCodeAttribution", async() => {
            await updateDecorations(activeEditor, workspacePath, shadowPath);
        }),
    )
}

async function updateDecorations(activeEditor: vscode.TextEditor | undefined, workspacePath: string, shadowPath: string) {
    if (!activeEditor) {
        return;
    }

    // Sync the shadow workspace
    await ShadowWorkspace.getInstance(workspacePath).sync("Human", false);
    if (!workspacePath) { throw Error("empty folder"); }
    const fileName = path.relative(workspacePath, activeEditor.document.fileName);
    
    const shadowBlame = (await runCommand(`git blame ${fileName}`, shadowPath)).trim(); 
    const workspaceBlame = (await runCommand(`git blame ${fileName}`, workspacePath)).trim(); 

    // Accumulate decorations
    const humanDecorations: vscode.DecorationOptions[] = [];
    const aiDecorations: vscode.DecorationOptions[] = [];

    for (let i = 0; i < shadowBlame.split("\n").length; i++) {
        const shadowBlameLine = shadowBlame.split("\n")[i];         
        const shadowAuthor = getAuthor(shadowBlameLine);
        if (shadowAuthor === "AI") {
            aiDecorations.push({ range: new vscode.Range(i, 0, i, 0) });
        } else if (shadowAuthor === "Human") {
            humanDecorations.push({ range: new vscode.Range(i, 0, i, 0) });
        } else {
            const workspaceBlameLine = workspaceBlame.split("\n")[i];
            const workspaceCommitHash = getCommitHash(workspaceBlameLine);

            if (!(workspaceCommitHash in NOTES_CACHE)) {
                let notes = null;
                try{
                    notes = await runCommand(`git notes show ${workspaceCommitHash}`, workspacePath);
                    NOTES_CACHE[workspaceCommitHash] = JSON.parse(notes.replace(/(\s*)([^"'\s:]+)(\s*):(\s*)/g, '$1"$2"$3:$4'));
                } catch(error) {
                    // Command throws an error, when notes are absent
                    NOTES_CACHE[workspaceCommitHash] = null;
                }
            }

            const commitNotes = NOTES_CACHE[workspaceCommitHash];
            if (commitNotes && fileName in commitNotes && commitNotes[fileName].includes(i + 1)) {
                aiDecorations.push({ range: new vscode.Range(i, 0, i, 0) });
            } else {
                humanDecorations.push({ range: new vscode.Range(i, 0, i, 0) });
            }
        }
    }

    activeEditor.setDecorations(HumanWrittenCodeDecorationType, humanDecorations);
    activeEditor.setDecorations(AiWrittenCodeDecorationType, aiDecorations);
}

function getAuthor(line: string): Author {
    let author_raw = line.split(" ")[1];
    if (author_raw.startsWith("(")) {
        author_raw = author_raw.substring(1);
    }
    if (author_raw === "AI") {
        return "AI";
    } else if (author_raw === "Human") {
        return "Human";
    } else if (author_raw === "Init") {
        return "Init";
    } else {
        return "Unknown";
    }
}

function getCommitHash(line: string): string {
    let hash = line.split(" ")[0];
    if (hash.startsWith('^')) {
        hash = hash.substring(1);
    }

    return hash;
}