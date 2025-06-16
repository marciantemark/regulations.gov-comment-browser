import { Command } from "commander";
import { loadCommentsCommand } from "./load-comments";
import { condenseCommand } from "./condense";
import { discoverThemesCommand } from "./discover-themes";
import { scoreThemesCommand } from "./score-themes";
import { discoverEntitiesCommand } from "./discover-entities";
import { buildWebsiteCommand } from "../website-build-script";

export const pipelineCommand = new Command("pipeline")
  .description("Run the complete analysis pipeline: load, condense, discover themes, score themes, discover entities, and build website")
  .argument("<document-id>", "Document ID (e.g., CMS-2025-0050-0031)")
  .option("-s, --skip-attachments", "Skip downloading attachments")
  .option("-d, --debug", "Enable debug mode for all steps")
  .option("-o, --output <dir>", "Output directory for website files", "dist/data")
  .action(async (documentId: string, options: any) => {
    console.log(`🚀 Starting complete pipeline for ${documentId}\n`);
    
    try {
      // 1. Load comments
      console.log("📥 Step 1/6: Loading comments...");
      await loadCommentsCommand.parseAsync([
        'bun', 'cli.ts', 
        documentId,
        ...(options.skipAttachments ? ['--skip-attachments'] : []),
        ...(options.debug ? ['--debug'] : [])
      ]);
      
      // 2. Condense comments
      console.log("\n📝 Step 2/6: Condensing comments...");
      await condenseCommand.parseAsync([
        'bun', 'cli.ts', 
        documentId,
        ...(options.debug ? ['--debug'] : [])
      ]);
      
      // 3. Discover themes
      console.log("\n🔍 Step 3/6: Discovering themes...");
      await discoverThemesCommand.parseAsync([
        'bun', 'cli.ts', 
        documentId,
        ...(options.debug ? ['--debug'] : [])
      ]);
      
      // 4. Score themes
      console.log("\n📊 Step 4/6: Scoring themes...");
      await scoreThemesCommand.parseAsync([
        'bun', 'cli.ts', 
        documentId,
        ...(options.debug ? ['--debug'] : [])
      ]);
      
      // 5. Discover entities
      console.log("\n🏷️  Step 5/6: Discovering entities...");
      await discoverEntitiesCommand.parseAsync([
        'bun', 'cli.ts', 
        documentId,
        ...(options.debug ? ['--debug'] : [])
      ]);
      
      // 6. Build website
      console.log("\n🏗️  Step 6/6: Building website files...");
      await buildWebsiteCommand.parseAsync([
        'bun', 'cli.ts', 
        documentId,
        '--output', options.output
      ]);
      
      console.log("\n✅ Pipeline completed successfully!");
      console.log(`📁 Website files are in: ${options.output}`);
      console.log(`🌐 Copy to dashboard/public/data/ and run the dashboard`);
      
    } catch (error) {
      console.error("\n❌ Pipeline failed:", error);
      process.exit(1);
    }
  }); 