import click
import subprocess
import json

from pathlib import Path
from collections import defaultdict

WORKSPACE_FOLDER = Path("/tmp/workspaceFolder")
SHADOW_WORKSPACE = Path("/tmp/shadowPath")


def run(command: str, cwd: Path):
    return subprocess.run(command, shell=True, check=True, cwd=str(cwd), capture_output=True, text=True)


def shadow_has_changes(shadow_workspace: Path):
    return len(run('git status --porcelain', shadow_workspace).stdout) > 0


def sync(workspace_folder: Path, shadow_workspace: Path):
    run(f'rsync -a --exclude .git {str(workspace_folder)}/ {str(shadow_workspace)}', workspace_folder)
    if shadow_has_changes(shadow_workspace):
        run('git add -A', shadow_workspace)
        run(
            'git commit --author "Human <human@example.com>" -m "Human <human@example.com>"',
            shadow_workspace
        )

def parse_git_diff(diff_text):
    # All collected chunks
    chunks = []
    lines = diff_text.splitlines()

    # Index of line we currently processing
    line_i = 0
    # Current file we are processing
    current_file = None
    
    while line_i < len(lines):
        line = lines[line_i]
        
        # File diff start
        if line.startswith('diff --git'):
            # Format: diff --git a/path/to/file b/path/to/file
            parts = line.split(' ')
            # Get the filename from the b/path/to/file part (modified file)
            if len(parts) >= 4:
                current_file = parts[3][2:]  # Remove 'b/' prefix
            line_i += 1
            continue
        
        # Parse chunk header
        if line.startswith('@@'):
            # Parse the @@ -a,b +c,d @@ format to extract line numbers
            header_parts = line.split()
            minus_part = header_parts[1]  # -a,b
            plus_part = header_parts[2]   # +c,d
            
            # Extract starting line numbers and line counts
            minus_info = minus_part[1:].split(',')  # Remove the '-' prefix
            plus_info = plus_part[1:].split(',')    # Remove the '+' prefix
            
            minus_start = int(minus_info[0])
            minus_lines = int(minus_info[1]) if len(minus_info) > 1 else 1
            
            plus_start = int(plus_info[0])
            plus_lines = int(plus_info[1]) if len(plus_info) > 1 else 1
            
            # Start a new chunk
            current_chunk = {
                'filename': current_file,
                'minus_start_number': minus_start,
                'plus_start_number': plus_start,
                'minus_num_lines': minus_lines,
                'plus_num_lines': plus_lines,
                'content': [line]  # Include the header line
            }
            
            line_i += 1
            # Collect the content lines until the next chunk header or end of file
            while line_i < len(lines) and not (lines[line_i].startswith('@@') or lines[line_i].startswith('diff --git')):
                current_chunk['content'].append(lines[line_i])
                line_i += 1
            
            # Join the content lines into a single string
            current_chunk['content'] = '\n'.join(current_chunk['content'])
            chunks.append(current_chunk)
        else:
            # Skip any other lines not part of a chunk
            line_i += 1
    
    return chunks


def get_ai_footprint(chunks: list[dict], shadow_workspace: Path):
    # Get the ai footprint from the chunks
    ai_footprint = defaultdict(list)

    for chunk in chunks:
        shadow_file_blame = run(f"git blame {chunk['filename']}", shadow_workspace).stdout 

        content_lines = chunk['content'].splitlines()[1:]
        line_i = chunk['plus_start_number']

        for line in content_lines:
            if line.startswith('-'):
                continue
            if line.startswith('+'):
                cur_author = shadow_file_blame.splitlines()[line_i - 1].split(" ")[1][1:]
                if cur_author == "AI":
                    ai_footprint[chunk["filename"]].append(line_i)
            line_i += 1
    return ai_footprint

@click.command()
@click.option('--dry-run', is_flag=True, help='Dry run the script')
@click.option('--message', '-m', type=str, help='Commit message')
@click.option('--verbose', '-v', is_flag=True, help='Verbose output')
def ai_vsc(dry_run: bool, message: str, verbose: bool):
    if not WORKSPACE_FOLDER.exists() or not SHADOW_WORKSPACE.exists():
        print(f"Need both workspace and shadow workspace to be set")
        return
    
    workspace_folder = Path(WORKSPACE_FOLDER.read_text())
    shadow_workspace = Path(SHADOW_WORKSPACE.read_text())

    if verbose:
        print(f"Workspace folder: {workspace_folder}")
        print(f"Shadow workspace: {shadow_workspace}")

    sync(workspace_folder, shadow_workspace)

    # Get the staged diff
    staged_diff = run('git diff --staged', workspace_folder).stdout

    # Parse the diff into chunks
    chunks = parse_git_diff(staged_diff)
    
    # Get the ai footprint
    ai_footprint = get_ai_footprint(chunks, shadow_workspace)
    if verbose:
        print(f"AI footprint: {json.dumps(ai_footprint, indent=4)}")

    if dry_run:
        return

    assert message, "Message is required if not dry run"

    # Merge commit
    run(f'git commit -m "{message}"', workspace_folder)

    # Add git note with ai footprint
    run(f"git notes add -f -m '{json.dumps(ai_footprint, indent=4)}'", workspace_folder)

if __name__ == "__main__":
    ai_vsc()
