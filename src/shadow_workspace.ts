import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { exec } from 'child_process';

export type Author = "Human" | "AI" | "Init" | "Unknown"

export class ShadowWorkspace {
  private static instance: ShadowWorkspace | undefined = undefined;
  private workspacePath: string;
  private shadowPath: string;

  public getShadowPath(): string {
    return this.shadowPath;
  }

  public static getInstance(workspacePath?: string): ShadowWorkspace {
    if (!ShadowWorkspace.instance ) {
      if (!workspacePath) {
        throw new Error("Workspace path is required");
      }
      ShadowWorkspace.instance = new ShadowWorkspace(workspacePath);
    }
    return ShadowWorkspace.instance;
  }
  
  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
    this.shadowPath = createTmpDir();
  }

  public async sync(author: Author, isInitialSync: boolean = false): Promise<void> {
    if (isInitialSync) {
        await runCommand(`git init`, this.shadowPath);
    }

    if (await this.shadowHasChanges()) {
        await runCommand(`git --git-dir=${this.shadowPath}/.git add -A`, this.workspacePath);
        
        let authorString = author === "Human" ? "Human <human@example.com>" : "AI <ai@example.com>";
        if (isInitialSync) {
            authorString = "Init <init@example.com>";
        }
        await runCommand(`git --git-dir=${this.shadowPath}/.git commit --author "${authorString}" -m "Sync from ${authorString}"`, this.workspacePath);
    }
  }

  public async shadowHasChanges(): Promise<boolean> {
    const response = await runCommand(`git --git-dir=${this.shadowPath}/.git status --porcelain`, this.workspacePath);
    return response.length > 0;
  }

  public cleanup(): void {
    fs.rmSync(this.shadowPath, { recursive: true, force: true });
  }
}

function createTmpDir(): string {
  const tmpDir = os.tmpdir();
  const uniqueName = `shadow_workspace_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  const fullPath = path.join(tmpDir, uniqueName);
  fs.mkdirSync(fullPath, { recursive: true });
  return fullPath;
}

export function runCommand(command: string, cwd?: string): Promise<string> {
    return new Promise((resolve, reject) => {
        exec(command, { cwd, maxBuffer: 10 * 1024 * 1024  }, (error, stdout, stderr) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(stdout);
        });
    });
}
