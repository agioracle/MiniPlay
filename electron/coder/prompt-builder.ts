import * as path from 'path';

/**
 * Build the prompt sent to the coder agent for code modification.
 * References the GDD file by path instead of inlining its full content,
 * keeping the prompt concise and letting the coder agent read the file itself.
 */
export function buildCoderPrompt(options: {
  projectPath: string;
  summary: string;
}): string {
  const { projectPath, summary } = options;

  const gddPath = path.join(projectPath, 'docs', 'GDD.md');

  return `You are a game developer working on a Phaser 3 WeChat mini-game project.

## Task
${summary}

## Game Design Document
Read the full GDD at: ${gddPath}
Pay special attention to the "## Latest Patch" section — it contains the most recent change request.

## Rules
1. ONLY modify files under src/scenes/, src/entities/, src/config/, and public/assets/
2. Do NOT modify src/main.js (it only registers BootScene)
3. Do NOT modify phaser-wx.config.json
4. Do NOT modify any files in node_modules/
5. Use Phaser 3 API (this.add, this.physics, this.load, etc.)
6. Keep subpackages design intact
7. Keep file structure intact
8. Keep BootScene → MenuScene → GameScene → GameOverScene flow
9. Keep code clean and well-commented
10. After modifying code, ALWAYS update the "## Latest Patch" section in ${gddPath} with a timestamped summary of what you changed and which files were affected

## After making changes
Summarize what files you changed and what you did.`;
}
