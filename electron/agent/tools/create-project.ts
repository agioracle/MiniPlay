import { tool, zodSchema } from 'ai';
import { z } from 'zod';
import { scaffoldProject } from '../../project/scaffold';
import { addProject } from '../../storage/projects';
import { setActiveProject } from '../../project/state';

const inputSchema = zodSchema(
  z.object({
    name: z.string().describe('Project name in kebab-case, e.g. "space-runner"'),
    orientation: z.enum(['portrait', 'landscape']).describe('Screen orientation: portrait (竖屏 9:16) or landscape (横屏 16:9)'),
  })
);

export const createProjectTool = tool({
  description: 'Create a new game project with the phaser-wx scaffold. Call this once when starting a new game.',
  inputSchema,
  execute: async (input) => {
    console.log('[create_project] Creating project: %s (%s)', input.name, input.orientation);
    try {
      const projectPath = scaffoldProject({
        name: input.name,
        orientation: input.orientation,
      });

      // Register in project index
      addProject({
        name: input.name,
        path: projectPath,
        template: input.orientation,
        lastOpened: new Date().toISOString(),
        versionCount: 1,
        thumbnail: null,
      });

      // Set as active project
      setActiveProject(projectPath);
      console.log('[create_project] Project created at:', projectPath);

      return {
        success: true,
        projectPath,
        orientation: input.orientation,
        message: `Project "${input.name}" created at ${projectPath} (${input.orientation}). Template scaffold includes: src/main.js, src/scenes/ (BootScene, MenuScene, GameScene), public/assets/, docs/ directory. Ready for GDD generation.`,
      };
    } catch (err: any) {
      console.error('[create_project] Failed:', err.message);
      return {
        success: false,
        projectPath: null,
        orientation: input.orientation,
        message: `Failed to create project: ${err.message}`,
      };
    }
  },
});
