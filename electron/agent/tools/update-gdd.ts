import { tool, zodSchema } from 'ai';
import { z } from 'zod';
import { updateGddSection, writeGdd, readGdd } from '../../project/gdd';
import { getActiveProject } from '../../project/state';

const inputSchema = zodSchema(
  z.object({
    section: z.enum([
      'full',
      'Meta',
      'Core Loop',
      'Entities',
      'Scenes',
      'Controls',
      'Difficulty',
      'Assets',
      'UI Layout',
      'Latest Patch',
    ]).describe('Which GDD section to update. Use "full" to write the complete initial GDD.'),
    content: z.string().describe('The markdown content for this section'),
  })
);

export const updateGddTool = tool({
  description: 'Write or update a section of the Game Design Document (GDD). Call this to record design decisions before sending to the Coder Agent.',
  inputSchema,
  execute: async (input) => {
    const projectPath = getActiveProject();
    console.log('[update_gdd] Section: %s, Content length: %d', input.section, input.content.length);
    if (!projectPath) {
      return {
        success: false,
        section: input.section,
        message: 'No active project. Call create_project first.',
      };
    }

    try {
      if (input.section === 'full') {
        writeGdd(projectPath, input.content);
      } else {
        updateGddSection(projectPath, input.section, input.content);
      }

      return {
        success: true,
        section: input.section,
        message: `GDD section "${input.section}" updated successfully.`,
      };
    } catch (err: any) {
      return {
        success: false,
        section: input.section,
        message: `Failed to update GDD: ${err.message}`,
      };
    }
  },
});
